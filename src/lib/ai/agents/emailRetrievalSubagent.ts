import { readPromptFile } from '@/lib/prompts';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { getMailboxesForUser } from '@/lib/services/mailbox';
import { addDaysToDateOnly } from '@/lib/utils/timezone';
import {
  EmailEvidencePackSchema,
  type EmailEvidencePackDTO,
} from '@/lib/ai/schemas/emailRetrievalSchemas';
import type { EmailData } from '@/lib/email/gmail';
import { normalizeWhitespace, stripHtml } from '@/lib/email/text';

// ─────────────────────────────────────────────────────────────────────────────
// Email Retrieval Subagent
//
// A specialized retrieval + compression pipeline that searches Gmail using a
// multi-query plan, enforces budgets, and compresses results into a compact
// EmailEvidencePack for the Executive Agent.
// ─────────────────────────────────────────────────────────────────────────────

export type EmailRetrievalMode = 'quick' | 'deep';
export type EmailRetrievalProfile = 'default' | 'messaging' | 'whatsapp' | 'telegram';

export type EmailRetrievalConstraints = {
  sender?: string;
  recipient?: string;
  keywords?: string[];
  subject?: string;
  timeWindow?: 'recent' | 'last_month' | 'last_year' | 'all_time';
  startDate?: string;
  endDate?: string;
  hasAttachment?: boolean;
};

export type EmailRetrievalRequest = {
  intent: string;
  mode?: EmailRetrievalMode;
  constraints?: EmailRetrievalConstraints;
  profile?: EmailRetrievalProfile;
  mailboxId?: string;
  mailboxEmail?: string;
};

type EmailRetrievalDependencies = {
  userId: string;
  abortSignal?: AbortSignal;
  deadlineAt?: number;
};

type RetrievalBudgets = {
  maxQueries: number;
  maxPagesPerQuery: number;
  maxThreads: number;
  maxMessages: number;
  maxCandidates: number;
  maxBodyChars: number;
  pageSize: number;
  snippetChars: number;
};

type SearchPlan = {
  queries: string[];
  timeWindowLabel: string;
  matchTerms: string[];
  notes: string[];
};

type EmailRetrievalCandidate = {
  threadId: string;
  messageId: string;
  mailboxId: string;
  mailboxEmail: string;
  date: string;
  from: string;
  subject: string;
  snippet: string;
  matchedTerms: string[];
  matchScore: number;
};

type MailboxSearchContext = {
  mailboxId: string;
  mailboxEmail: string;
  gmail: { searchThreadsPaged: GmailSearchPaged };
};

type RetrievalCoverage = {
  queriesTried: string[];
  threadsScanned: number;
  messagesScanned: number;
  timeWindow: string;
  pagesFetched: number;
  truncated: boolean;
  budgetNotes: string[];
};

type GmailSearchPaged = (query: string, options: { maxResults?: number; pageToken?: string }) => Promise<{
  threads: Array<{ threadId: string; emails: EmailData[] }>;
  nextPageToken?: string;
}>;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'to',
  'from',
  'with',
  'about',
  'into',
  'over',
  'after',
  'before',
  'this',
  'that',
  'these',
  'those',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'on',
  'in',
  'at',
  'by',
  'it',
  'its',
  'i',
  'me',
  'my',
  'we',
  'us',
  'our',
  'you',
  'your',
  'he',
  'she',
  'they',
  'them',
  'their',
  'as',
  'if',
  'then',
  'than',
  'so',
  'not',
  'no',
  'yes',
  'just',
  'can',
  'could',
  'should',
  'would',
]);

type EffectiveEmailRetrievalProfile = 'default' | 'messaging';

const RETRIEVAL_BUDGETS_BY_PROFILE: Record<EffectiveEmailRetrievalProfile, Record<EmailRetrievalMode, RetrievalBudgets>> =
  {
    default: {
      quick: {
        maxQueries: 3,
        maxPagesPerQuery: 1,
        maxThreads: 16,
        maxMessages: 60,
        maxCandidates: 24,
        maxBodyChars: 20000,
        pageSize: 12,
        snippetChars: 220,
      },
      deep: {
        maxQueries: 6,
        maxPagesPerQuery: 4,
        maxThreads: 60,
        maxMessages: 200,
        maxCandidates: 60,
        maxBodyChars: 70000,
        pageSize: 15,
        snippetChars: 240,
      },
    },
    messaging: {
      quick: {
        maxQueries: 2,
        maxPagesPerQuery: 1,
        maxThreads: 12,
        maxMessages: 50,
        maxCandidates: 18,
        maxBodyChars: 15000,
        pageSize: 10,
        snippetChars: 200,
      },
      deep: {
        maxQueries: 3,
        maxPagesPerQuery: 2,
        maxThreads: 35,
        maxMessages: 120,
        maxCandidates: 40,
        maxBodyChars: 45000,
        pageSize: 12,
        snippetChars: 220,
      },
    },
  };

function normalizeRetrievalProfile(profile: EmailRetrievalProfile | undefined): EffectiveEmailRetrievalProfile {
  if (!profile || profile === 'default') return 'default';
  return 'messaging';
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const QUOTED_PHRASE_REGEX = /"([^"]+)"/g;
const GMAIL_SEARCH_TIMEOUT_MS = 8_000;
const EARLY_EXIT_BUFFER_MS = 3_000;

function isTimeLow(deadlineAt?: number, bufferMs = EARLY_EXIT_BUFFER_MS): boolean {
  return typeof deadlineAt === 'number' && deadlineAt - Date.now() < bufferMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ status: 'timeout' }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
  });

  const guardedPromise = promise
    .then((value) => ({ status: 'fulfilled' as const, value }))
    .catch((error) => ({ status: 'rejected' as const, error }));

  const result = await Promise.race([guardedPromise, timeoutPromise]);
  if (timeoutId) clearTimeout(timeoutId);

  if (result.status === 'timeout') {
    throw new Error(`${label} timed out after ${timeoutMs}ms`);
  }
  if (result.status === 'rejected') {
    throw result.error;
  }
  return result.value;
}

function extractQuotedPhrases(text: string): string[] {
  const phrases: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = QUOTED_PHRASE_REGEX.exec(text)) !== null) {
    const phrase = match[1]?.trim();
    if (phrase) phrases.push(phrase);
    if (phrases.length >= 4) break;
  }

  return Array.from(new Set(phrases));
}

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) ?? [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

function extractKeywords(text: string, limit = 6): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token) => !STOPWORDS.has(token));

  const deduped = Array.from(new Set(tokens));
  return deduped.slice(0, limit);
}

function formatDateForGmail(dateString?: string): string | null {
  if (!dateString) return null;
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}/${match[2]}/${match[3]}`;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function wrapQuoted(term: string): string {
  const normalized = term.replace(/"/g, '').trim();
  return normalized.includes(' ') ? `"${normalized}"` : normalized;
}

function buildTimeFilters(
  constraints: EmailRetrievalConstraints | undefined,
  mode: EmailRetrievalMode,
  profile: EffectiveEmailRetrievalProfile,
): { filters: string[]; label: string } {
  const start = formatDateForGmail(constraints?.startDate);
  const end = formatDateForGmail(constraints?.endDate);
  const endExclusive = (() => {
    if (!constraints?.endDate) return null;
    const dateOnly = constraints.endDate.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!dateOnly) return end;
    return formatDateForGmail(addDaysToDateOnly(dateOnly, 1));
  })();

  if (start || endExclusive) {
    const parts: string[] = [];
    if (start) parts.push(`after:${start}`);
    if (endExclusive) parts.push(`before:${endExclusive}`);
    const label = `${start ?? '...'} to ${end ?? '...'}`;
    return { filters: [parts.join(' ')], label };
  }

  const timeWindow = constraints?.timeWindow;
  if (timeWindow && timeWindow !== 'all_time') {
    const days = timeWindow === 'recent' ? 30 : timeWindow === 'last_month' ? 30 : 365;
    return { filters: [`newer_than:${days}d`], label: `last ${days} days` };
  }

  if (timeWindow === 'all_time') {
    return { filters: [''], label: 'all time' };
  }

  if (mode === 'deep') {
    if (profile === 'messaging') {
      return {
        filters: ['newer_than:60d', 'newer_than:180d'],
        label: 'last 60/180 days',
      };
    }
    return {
      filters: ['newer_than:30d', 'newer_than:180d', 'newer_than:365d', ''],
      label: '30d, 180d, 365d, all time',
    };
  }

  if (profile === 'messaging') {
    return { filters: ['newer_than:90d'], label: 'last 90 days' };
  }

  return { filters: ['newer_than:180d'], label: 'last 180 days' };
}

function buildSearchPlan(
  intent: string,
  constraints: EmailRetrievalConstraints | undefined,
  mode: EmailRetrievalMode,
  profile: EffectiveEmailRetrievalProfile,
): SearchPlan {
  const notes: string[] = [];
  const phrases = extractQuotedPhrases(intent);
  const intentEmails = extractEmails(intent);
  const intentKeywords = extractKeywords(intent);

  const constraintKeywords = (constraints?.keywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 6);

  const subjectHint = constraints?.subject?.trim();
  const peopleTerms = new Set<string>();

  if (constraints?.sender) peopleTerms.add(constraints.sender.trim());
  if (constraints?.recipient) peopleTerms.add(constraints.recipient.trim());
  intentEmails.forEach((email) => peopleTerms.add(email));

  const keywordTerms = Array.from(new Set([...constraintKeywords, ...intentKeywords]));

  const { filters, label } = buildTimeFilters(constraints, mode, profile);

  const clauses: string[] = [];

  if (peopleTerms.size > 0) {
    const peopleClause = Array.from(peopleTerms)
      .map((term) => {
        const safeTerm = wrapQuoted(term);
        return `{from:${safeTerm} OR to:${safeTerm}}`;
      })
      .join(' OR ');
    clauses.push(`(${peopleClause})`);
  }

  if (subjectHint) {
    clauses.push(`subject:${wrapQuoted(subjectHint)}`);
  }

  if (phrases.length > 0) {
    clauses.push(`(${phrases.map(wrapQuoted).join(' OR ')})`);
  }

  if (keywordTerms.length > 0) {
    clauses.push(`(${keywordTerms.map(wrapQuoted).join(' OR ')})`);
  }

  if (clauses.length === 0) {
    notes.push('No specific search terms found in intent or constraints.');
    return { queries: [], timeWindowLabel: label, matchTerms: [], notes };
  }

  const combined = clauses.join(' ');
  const baseQueries = clauses.length > 1 ? [combined, ...clauses] : [combined];

  const queries = new Set<string>();
  for (const baseQuery of baseQueries) {
    for (const timeFilter of filters) {
      const parts = [
        baseQuery,
        timeFilter,
        constraints?.hasAttachment ? 'has:attachment' : '',
        '-in:spam -in:trash',
      ].filter(Boolean);
      queries.add(parts.join(' '));
    }
  }

  const matchTerms = Array.from(new Set([...phrases, ...keywordTerms, subjectHint].filter(Boolean) as string[]));

  return {
    queries: Array.from(queries),
    timeWindowLabel: label,
    matchTerms,
    notes,
  };
}

function extractSnippet(text: string, terms: string[], maxChars: number): string {
  const cleanText = stripHtml(text);
  if (terms.length === 0) {
    return cleanText.length > maxChars ? `${cleanText.slice(0, maxChars - 3)}...` : cleanText;
  }

  const lower = cleanText.toLowerCase();
  const term = terms
    .map((t) => t.toLowerCase())
    .find((t) => t && lower.includes(t));

  if (!term) {
    return cleanText.length > maxChars ? `${cleanText.slice(0, maxChars - 3)}...` : cleanText;
  }

  const index = lower.indexOf(term);
  const start = Math.max(0, index - Math.floor(maxChars / 3));
  const end = Math.min(cleanText.length, start + maxChars);
  const snippet = cleanText.slice(start, end).trim();

  if (start === 0 && end >= cleanText.length) return snippet;
  if (start === 0) return `${snippet}...`;
  if (end >= cleanText.length) return `...${snippet}`;
  return `...${snippet}...`;
}

function scoreMatch(subject: string, body: string, terms: string[]): { score: number; matched: string[] } {
  if (terms.length === 0) {
    return { score: 1, matched: [] };
  }

  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  for (const term of terms) {
    const lowerTerm = term.toLowerCase();
    let hit = false;

    if (lowerSubject.includes(lowerTerm)) {
      score += 3;
      hit = true;
    }

    if (lowerBody.includes(lowerTerm)) {
      score += 1;
      hit = true;
    }

    if (hit) matched.push(term);
  }

  return { score, matched };
}

function buildEmailRetrievalPrompt(input: {
  request: EmailRetrievalRequest;
  coverage: RetrievalCoverage;
  candidates: EmailRetrievalCandidate[];
}): string {
  const template = readPromptFile('core-processing/emailRetrievalPrompt.md');
  const constraintsJson = input.request.constraints
    ? JSON.stringify(input.request.constraints, null, 2)
    : '(none)';
  const coverageJson = JSON.stringify(input.coverage, null, 2);
  const candidatesJson =
    input.candidates.length > 0
      ? JSON.stringify(input.candidates, null, 2)
      : '(none)';

  return template
    .replace('{userRequest}', input.request.intent)
    .replace('{mode}', input.request.mode ?? 'quick')
    .replace('{constraintsJson}', constraintsJson)
    .replace('{coverageJson}', coverageJson)
    .replace('{candidatesJson}', candidatesJson);
}

function createEmptyEvidencePack(
  coverage: RetrievalCoverage,
  followUpQuestions: string[],
): EmailEvidencePackDTO {
  return {
    matches: [],
    quotes: [],
    coverage,
    confidence: 'low',
    followUpQuestions,
  };
}

function createQuickEvidencePack(
  candidates: EmailRetrievalCandidate[],
  coverage: RetrievalCoverage,
): EmailEvidencePackDTO {
  const matches = candidates.slice(0, 5).map((candidate) => ({
    threadId: candidate.threadId,
    messageId: candidate.messageId,
    mailboxId: candidate.mailboxId,
    mailboxEmail: candidate.mailboxEmail,
    from: candidate.from,
    subject: candidate.subject,
    date: candidate.date,
    whyRelevant:
      candidate.matchedTerms.length > 0
        ? `Matched terms: ${candidate.matchedTerms.join(', ')}`
        : 'Matched on keyword overlap.',
    quote: candidate.snippet.slice(0, 360),
  }));

  return {
    matches,
    quotes: [],
    coverage: {
      ...coverage,
      truncated: true,
      budgetNotes: [...coverage.budgetNotes, 'Quick pack: time-constrained'],
    },
    confidence: matches.length > 0 ? 'medium' : 'low',
    followUpQuestions: ['Want me to search deeper?'],
  };
}

async function resolveMailboxSearchContexts(params: {
  userId: string;
  mailboxId?: string;
  mailboxEmail?: string;
  purpose: string;
}): Promise<MailboxSearchContext[]> {
  const mailboxes = await getMailboxesForUser({
    userId: params.userId,
    status: 'CONNECTED',
    provider: 'google',
  });

  let filtered = mailboxes;
  if (params.mailboxId) {
    filtered = mailboxes.filter((mailbox) => mailbox.id === params.mailboxId);
  } else if (params.mailboxEmail) {
    const normalized = params.mailboxEmail.toLowerCase();
    filtered = mailboxes.filter(
      (mailbox) => mailbox.emailAddress.toLowerCase() === normalized,
    );
  }

  if (filtered.length === 0) {
    return [];
  }

  const contexts: MailboxSearchContext[] = [];
  for (const mailbox of filtered) {
    const gmailContext = await createGmailServiceForUser({
      userId: params.userId,
      mailboxId: mailbox.id,
      purpose: params.purpose,
      requester: 'emailRetrievalSubagent.resolveMailboxSearchContexts',
    });

    if (!gmailContext) {
      logger.warn(
        `[emailRetrievalSubagent] Gmail credentials missing for mailbox ${mailbox.emailAddress}`,
      );
      continue;
    }

    contexts.push({
      mailboxId: mailbox.id,
      mailboxEmail: mailbox.emailAddress,
      gmail: gmailContext.gmail,
    });
  }

  return contexts;
}

async function collectCandidates(
  mailboxes: MailboxSearchContext[],
  plan: SearchPlan,
  budgets: RetrievalBudgets,
  deadlineAt?: number,
): Promise<{ candidates: EmailRetrievalCandidate[]; coverage: RetrievalCoverage }> {
  const coverage: RetrievalCoverage = {
    queriesTried: [],
    threadsScanned: 0,
    messagesScanned: 0,
    timeWindow: plan.timeWindowLabel,
    pagesFetched: 0,
    truncated: false,
    budgetNotes: [...plan.notes],
  };

  const seenThreadIds = new Set<string>();
  const seenMessageIds = new Set<string>();
  const candidates: EmailRetrievalCandidate[] = [];
  let totalBodyChars = 0;

  if (mailboxes.length > 0) {
    coverage.budgetNotes.push(
      `Mailboxes searched: ${mailboxes.map((m) => m.mailboxEmail).join(', ')}`,
    );
  }

  const maxQueries = Math.min(plan.queries.length, budgets.maxQueries);

  for (let queryIndex = 0; queryIndex < maxQueries; queryIndex += 1) {
    if (isTimeLow(deadlineAt)) {
      coverage.truncated = true;
      coverage.budgetNotes.push('Time budget low, returning partial results.');
      return { candidates, coverage };
    }

    const query = plan.queries[queryIndex];
    for (const mailbox of mailboxes) {
      if (isTimeLow(deadlineAt)) {
        coverage.truncated = true;
        coverage.budgetNotes.push('Time budget low, returning partial results.');
        return { candidates, coverage };
      }

      coverage.queriesTried.push(`${query} (mailbox: ${mailbox.mailboxEmail})`);

      let pageToken: string | undefined = undefined;
      let pagesFetchedForQuery = 0;

      while (pagesFetchedForQuery < budgets.maxPagesPerQuery) {
        if (isTimeLow(deadlineAt)) {
          coverage.truncated = true;
          coverage.budgetNotes.push('Time budget low, returning partial results.');
          return { candidates, coverage };
        }

        let response: Awaited<ReturnType<GmailSearchPaged>>;
        try {
          response = await withTimeout(
            mailbox.gmail.searchThreadsPaged(query, {
              maxResults: budgets.pageSize,
              pageToken,
            }),
            GMAIL_SEARCH_TIMEOUT_MS,
            'Gmail search',
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          coverage.truncated = true;
          coverage.budgetNotes.push(`Gmail search failed (${mailbox.mailboxEmail}): ${message}`);
          break;
        }

        const threads: Array<{ threadId: string; emails: EmailData[] }> = response?.threads ?? [];
        const nextPageToken: string | undefined = response?.nextPageToken ?? undefined;

        coverage.pagesFetched += 1;
        pagesFetchedForQuery += 1;

        for (const thread of threads) {
          if (coverage.threadsScanned >= budgets.maxThreads) {
            coverage.truncated = true;
            coverage.budgetNotes.push('Thread budget reached.');
            return { candidates, coverage };
          }

          const threadKey = `${mailbox.mailboxId}:${thread.threadId}`;
          if (seenThreadIds.has(threadKey)) {
            continue;
          }

          seenThreadIds.add(threadKey);
          coverage.threadsScanned += 1;

          for (const email of thread.emails) {
            if (coverage.messagesScanned >= budgets.maxMessages) {
              coverage.truncated = true;
              coverage.budgetNotes.push('Message budget reached.');
              return { candidates, coverage };
            }

            const messageKey = `${mailbox.mailboxId}:${email.messageId}`;
            if (seenMessageIds.has(messageKey)) {
              continue;
            }

            coverage.messagesScanned += 1;
            const remainingChars = budgets.maxBodyChars - totalBodyChars;
            if (remainingChars <= 0) {
              coverage.truncated = true;
              coverage.budgetNotes.push('Body char budget reached.');
              return { candidates, coverage };
            }

            const body = email.body || email.snippet || '';
            const bodySlice = stripHtml(body.slice(0, remainingChars));
            totalBodyChars += bodySlice.length;

            const { score, matched } = scoreMatch(email.subject || '', bodySlice, plan.matchTerms);
            if (plan.matchTerms.length > 0 && score === 0) {
              seenMessageIds.add(messageKey);
              continue;
            }
            const snippet = extractSnippet(bodySlice, matched, budgets.snippetChars);

            const candidate: EmailRetrievalCandidate = {
              threadId: thread.threadId,
              messageId: email.messageId,
              mailboxId: mailbox.mailboxId,
              mailboxEmail: mailbox.mailboxEmail,
              date: email.date.toISOString(),
              from: email.from,
              subject: email.subject || '(no subject)',
              snippet,
              matchedTerms: matched,
              matchScore: score,
            };

            candidates.push(candidate);
            seenMessageIds.add(messageKey);

            if (candidates.length >= budgets.maxCandidates) {
              coverage.truncated = true;
              coverage.budgetNotes.push('Candidate budget reached.');
              return { candidates, coverage };
            }
          }
        }

        if (!nextPageToken) break;
        if (pagesFetchedForQuery >= budgets.maxPagesPerQuery) {
          coverage.truncated = true;
          coverage.budgetNotes.push('Page budget reached.');
          break;
        }
        pageToken = nextPageToken;
      }
    }
  }

  if (plan.queries.length > budgets.maxQueries) {
    coverage.truncated = true;
    coverage.budgetNotes.push('Query budget reached.');
  }

  return { candidates, coverage };
}

function sortCandidates(candidates: EmailRetrievalCandidate[]): EmailRetrievalCandidate[] {
  return candidates.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

/**
 * Runs the Email Retrieval Subagent.
 *
 * Executes a deterministic Gmail search plan, applies budgets, and compresses
 * results into a compact EmailEvidencePack schema for the Executive Agent.
 */
export async function runEmailRetrieval(
  request: EmailRetrievalRequest,
  dependencies: EmailRetrievalDependencies,
): Promise<EmailEvidencePackDTO> {
  const mode: EmailRetrievalMode = request.mode ?? 'quick';
  const profile: EffectiveEmailRetrievalProfile = normalizeRetrievalProfile(request.profile);
  const budgets = RETRIEVAL_BUDGETS_BY_PROFILE[profile][mode];

  const plan = buildSearchPlan(request.intent, request.constraints, mode, profile);
  if (plan.queries.length === 0) {
    const coverage: RetrievalCoverage = {
      queriesTried: [],
      threadsScanned: 0,
      messagesScanned: 0,
      timeWindow: plan.timeWindowLabel,
      pagesFetched: 0,
      truncated: false,
      budgetNotes: plan.notes,
    };

    return createEmptyEvidencePack(coverage, [
      'Which sender, subject, or exact phrase should I look for?',
    ]);
  }

  const mailboxContexts = await resolveMailboxSearchContexts({
    userId: dependencies.userId,
    mailboxId: request.mailboxId,
    mailboxEmail: request.mailboxEmail,
    purpose: `${profile}:email-retrieval:${mode}`,
  });

  if (mailboxContexts.length === 0) {
    const coverage: RetrievalCoverage = {
      queriesTried: plan.queries.slice(0, budgets.maxQueries),
      threadsScanned: 0,
      messagesScanned: 0,
      timeWindow: plan.timeWindowLabel,
      pagesFetched: 0,
      truncated: false,
      budgetNotes: [
        ...plan.notes,
        request.mailboxId || request.mailboxEmail
          ? 'No Gmail credentials for the requested mailbox.'
          : 'No connected Gmail mailboxes available.',
      ],
    };

    return createEmptyEvidencePack(coverage, [
      request.mailboxId || request.mailboxEmail
        ? 'I cannot access that mailbox right now. Want to reconnect it or choose another mailbox?'
        : 'I cannot access Gmail right now. Want to reconnect your account and retry?',
    ]);
  }

  try {
    logger.info(
      `[emailRetrievalSubagent] profile=${profile} mode=${mode} queries=${plan.queries.length} window=${plan.timeWindowLabel}`,
    );

    const { candidates, coverage } = await collectCandidates(
      mailboxContexts,
      plan,
      budgets,
      dependencies.deadlineAt,
    );

    logger.info(
      `[emailRetrievalSubagent] candidates=${candidates.length} threads=${coverage.threadsScanned} messages=${coverage.messagesScanned} truncated=${coverage.truncated}`,
    );

    if (candidates.length === 0) {
      return createEmptyEvidencePack(coverage, [
        'I did not spot it yet. Can you share a sender, subject, or phrase to tighten the search?',
      ]);
    }

    const rankedCandidates = sortCandidates(candidates).slice(0, budgets.maxCandidates);
    if (isTimeLow(dependencies.deadlineAt, 5_000)) {
      return createQuickEvidencePack(rankedCandidates, coverage);
    }

    const prompt = buildEmailRetrievalPrompt({
      request: { ...request, mode },
      coverage,
      candidates: rankedCandidates,
    });

    const { object } = await callObject<EmailEvidencePackDTO>({
      model: models.emailRetrieval(),
      system:
        'You are an email retrieval specialist. Use only the provided candidate emails and return a precise evidence pack. Do not invent details.',
      prompt,
      schema: EmailEvidencePackSchema,
      temperature: 0.2,
      abortSignal: dependencies.abortSignal,
      op: 'email.retrieval',
      concurrency: { key: 'email.retrieval', maxConcurrency: 4 },
      retry: { maxAttempts: 2, baseDelayMs: 500 },
    });

    return {
      ...object,
      coverage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[emailRetrievalSubagent] Retrieval failed: ${message}`);

    const fallbackCoverage: RetrievalCoverage = {
      queriesTried: plan.queries.slice(0, budgets.maxQueries),
      threadsScanned: 0,
      messagesScanned: 0,
      timeWindow: plan.timeWindowLabel,
      pagesFetched: 0,
      truncated: false,
      budgetNotes: [`Retrieval error: ${message}`],
    };

    return createEmptyEvidencePack(fallbackCoverage, [
      'Something went wrong while searching. Want me to try again with a sender or timeframe?',
    ]);
  }
}
