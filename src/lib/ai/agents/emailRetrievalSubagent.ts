import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import {
  EmailEvidencePackSchema,
  type EmailEvidenceCoverageDTO,
  type EmailEvidencePackDTO,
} from '@/lib/ai/schemas/emailRetrievalSchemas';
import { logger } from '@/lib/logger';
import { readPromptFile } from '@/lib/prompts';
import {
  getInboxRetrievalFeatureFlags,
  searchInboxDocuments,
  type InboxSearchCandidate,
  type InboxSearchQueryConstraints,
  type InboxSearchQueryMode,
  type InboxSearchRetrievalProfile,
  type InboxSearchScopedMailbox,
} from '@/lib/services/inbox-search';
import { inferInboxSearchConfidence } from '@/lib/services/inbox-search/scoring';
import { getMailboxesForUser } from '@/lib/services/mailbox';

// Email Retrieval Subagent
//
// Phase 3 replaces the Gmail live search hot path with local-only retrieval over
// inbox projection tables. Quick mode is deterministic; deep mode may optionally
// use the LLM over already-ranked local candidates.

export type EmailRetrievalMode = InboxSearchQueryMode;
export type EmailRetrievalProfile =
  | 'default'
  | 'messaging'
  | 'whatsapp'
  | 'telegram';
export type EmailRetrievalConstraints = InboxSearchQueryConstraints;

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
  maxCandidates: number;
  snippetChars: number;
};

type RetrievalCoverage = EmailEvidenceCoverageDTO;

const RETRIEVAL_BUDGETS_BY_PROFILE: Record<
  InboxSearchRetrievalProfile,
  Record<EmailRetrievalMode, RetrievalBudgets>
> = {
  default: {
    quick: {
      maxCandidates: 24,
      snippetChars: 220,
    },
    deep: {
      maxCandidates: 60,
      snippetChars: 240,
    },
  },
  messaging: {
    quick: {
      maxCandidates: 18,
      snippetChars: 200,
    },
    deep: {
      maxCandidates: 40,
      snippetChars: 220,
    },
  },
};

const EARLY_EXIT_BUFFER_MS = 3_000;

function normalizeRetrievalProfile(
  profile: EmailRetrievalProfile | undefined,
): InboxSearchRetrievalProfile {
  if (!profile || profile === 'default') {
    return 'default';
  }

  return 'messaging';
}

function isTimeLow(deadlineAt?: number, bufferMs = EARLY_EXIT_BUFFER_MS): boolean {
  return typeof deadlineAt === 'number' && deadlineAt - Date.now() < bufferMs;
}

function buildEmailRetrievalPrompt(input: {
  request: EmailRetrievalRequest;
  coverage: RetrievalCoverage;
  candidates: InboxSearchCandidate[];
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

function createEmptyCoverage(
  budgetNotes: string[],
  overrides?: Partial<RetrievalCoverage>,
): RetrievalCoverage {
  return {
    queriesTried: [],
    threadsScanned: 0,
    messagesScanned: 0,
    timeWindow: 'unknown',
    pagesFetched: 0,
    truncated: false,
    budgetNotes,
    engineVersion: 'inbox-search-v2-hybrid',
    indexFreshness: 'unknown',
    retrievalLatencyMs: 0,
    lexicalCandidates: 0,
    semanticCandidates: 0,
    fusionMethod: 'rrf_k60',
    indexLag: null,
    semanticUnavailable: true,
    ...overrides,
  };
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

function createDeterministicEvidencePack(
  candidates: InboxSearchCandidate[],
  coverage: RetrievalCoverage,
  mode: EmailRetrievalMode,
): EmailEvidencePackDTO {
  const topCandidates = candidates.slice(0, 5);
  const confidence = inferInboxSearchConfidence({
    candidateCount: topCandidates.length,
    topScore: topCandidates[0]?.totalScore ?? 0,
    freshness: coverage.indexFreshness ?? 'unknown',
    hasExactBoost: topCandidates.some(
      (candidate) =>
        candidate.exactSenderBoost > 0 || candidate.exactSubjectBoost > 0,
    ),
  });

  return {
    matches: topCandidates.map((candidate) => ({
      threadId: candidate.threadId,
      messageId: candidate.messageId,
      mailboxId: candidate.mailboxId,
      mailboxEmail: candidate.mailboxEmail,
      from: candidate.from,
      subject: candidate.subject,
      date: candidate.date,
      whyRelevant: candidate.whyRelevant,
      quote: candidate.snippet.slice(0, 360),
    })),
    quotes: topCandidates.slice(0, 2).map((candidate) => ({
      threadId: candidate.threadId,
      messageId: candidate.messageId,
      mailboxId: candidate.mailboxId,
      mailboxEmail: candidate.mailboxEmail,
      quote: candidate.snippet.slice(0, 360),
      note: candidate.whyRelevant.slice(0, 200),
    })),
    coverage,
    confidence,
    followUpQuestions:
      confidence === 'low'
        ? [
            mode === 'quick'
              ? 'Want me to search deeper across the local inbox index?'
              : 'Can you share a sender, subject, or date range to narrow this down?',
          ]
        : [],
  };
}

async function resolveMailboxScope(params: {
  userId: string;
  mailboxId?: string;
  mailboxEmail?: string;
}): Promise<InboxSearchScopedMailbox[]> {
  const mailboxes = await getMailboxesForUser({
    userId: params.userId,
  });

  let filtered = mailboxes;
  if (params.mailboxId) {
    filtered = mailboxes.filter((mailbox) => mailbox.id === params.mailboxId);
  } else if (params.mailboxEmail) {
    const normalizedEmail = params.mailboxEmail.toLowerCase();
    filtered = mailboxes.filter(
      (mailbox) => mailbox.emailAddress.toLowerCase() === normalizedEmail,
    );
  }

  return filtered.map((mailbox) => ({
    id: mailbox.id,
    emailAddress: mailbox.emailAddress,
    status: mailbox.status,
    isPrimary: mailbox.isPrimary,
  }));
}

/**
 * Runs the Email Retrieval Subagent.
 *
 * Uses the local inbox projection tables only. Gmail live retrieval is no
 * longer used in the hot path.
 */
export async function runEmailRetrieval(
  request: EmailRetrievalRequest,
  dependencies: EmailRetrievalDependencies,
): Promise<EmailEvidencePackDTO> {
  const mode: EmailRetrievalMode = request.mode ?? 'quick';
  const profile = normalizeRetrievalProfile(request.profile);
  const budgets = RETRIEVAL_BUDGETS_BY_PROFILE[profile][mode];
  const featureFlags = getInboxRetrievalFeatureFlags();

  if (!featureFlags.retrievalV2Enabled) {
    return createEmptyEvidencePack(
      createEmptyCoverage([
        'Local inbox retrieval is disabled by INBOX_RETRIEVAL_V2_ENABLED=false.',
      ], {
        fusionMethod: 'lexical-only',
        semanticUnavailable: true,
      }),
      ['Inbox retrieval is temporarily disabled. Want to retry after rollout is re-enabled?'],
    );
  }

  try {
    logger.info('[emailRetrievalSubagent] retrieval flags', {
      userId: dependencies.userId,
      mode,
      profile,
      retrievalV2Enabled: featureFlags.retrievalV2Enabled,
      vectorEnabled: featureFlags.vectorEnabled,
      llmRerankDeepOnly: featureFlags.llmRerankDeepOnly,
    });

    const scopedMailboxes = await resolveMailboxScope({
      userId: dependencies.userId,
      mailboxId: request.mailboxId,
      mailboxEmail: request.mailboxEmail,
    });

    if (scopedMailboxes.length === 0) {
      const coverage = createEmptyCoverage(
        [
          request.mailboxId || request.mailboxEmail
            ? 'The requested mailbox is not available for local inbox retrieval.'
            : 'No mailboxes are available for local inbox retrieval.',
        ],
      );

      return createEmptyEvidencePack(coverage, [
        request.mailboxId || request.mailboxEmail
          ? 'I cannot find that mailbox locally yet. Want to choose another mailbox?'
          : 'I do not have any indexed mailbox data yet. Want to reconnect or wait for indexing?',
      ]);
    }

    logger.info(
      `[emailRetrievalSubagent] local retrieval profile=${profile} mode=${mode} mailboxes=${scopedMailboxes.length}`,
    );

    const searchResult = await searchInboxDocuments({
      userId: dependencies.userId,
      intent: request.intent,
      mode,
      profile,
      constraints: request.constraints,
      mailboxes: scopedMailboxes,
      maxCandidates: budgets.maxCandidates,
      snippetChars: budgets.snippetChars,
      deadlineAt: dependencies.deadlineAt,
    });

    logger.info(
      `[emailRetrievalSubagent] local candidates=${searchResult.candidates.length} scanned=${searchResult.coverage.messagesScanned} freshness=${searchResult.coverage.indexFreshness}`,
    );

    if (searchResult.candidates.length === 0) {
      return createEmptyEvidencePack(searchResult.coverage, [
        'I did not find a local match yet. Can you share a sender, subject, or timeframe?',
      ]);
    }

    if (mode === 'quick') {
      return createDeterministicEvidencePack(
        searchResult.candidates,
        searchResult.coverage,
        mode,
      );
    }

    if (!featureFlags.llmRerankDeepOnly) {
      return createDeterministicEvidencePack(
        searchResult.candidates,
        {
          ...searchResult.coverage,
          budgetNotes: [
            ...(searchResult.coverage.budgetNotes ?? []),
            'Skipped deep LLM rerank because INBOX_LLM_RERANK_DEEP_ONLY=false.',
          ],
        },
        mode,
      );
    }

    if (isTimeLow(dependencies.deadlineAt, 5_000)) {
      const coverage = {
        ...searchResult.coverage,
        budgetNotes: [
          ...(searchResult.coverage.budgetNotes ?? []),
          'Skipped deep LLM compression because the remaining time budget was low.',
        ],
      };

      return createDeterministicEvidencePack(
        searchResult.candidates,
        coverage,
        mode,
      );
    }

    const prompt = buildEmailRetrievalPrompt({
      request: { ...request, mode },
      coverage: searchResult.coverage,
      candidates: searchResult.candidates,
    });

    const { object } = await callObject<EmailEvidencePackDTO>({
      model: models.emailRetrieval(),
      system:
        'You are an email retrieval specialist. Use only the provided local inbox candidates and return a precise evidence pack. Do not invent details.',
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
      coverage: searchResult.coverage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[emailRetrievalSubagent] Retrieval failed: ${message}`);

    return createEmptyEvidencePack(
      createEmptyCoverage([`Local retrieval error: ${message}`]),
      ['Something went wrong while searching. Want to retry with a sender or timeframe?'],
    );
  }
}
