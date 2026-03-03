import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import {
  EmailEvidencePackSchema,
  type EmailEvidenceMetadataDTO,
  type EmailEvidencePackDTO,
} from '@/lib/ai/schemas/emailRetrievalSchemas';
import { logger } from '@/lib/logger';
import { readPromptFile } from '@/lib/prompts';
import {
  getInboxRetrievalFeatureFlags,
  searchInboxDocuments,
  type InboxSearchAction,
  type InboxSearchAggregate,
  type InboxSearchCandidate,
  type InboxSearchCoverage,
  type InboxSearchFilters,
  type InboxSearchQueryMode,
  type InboxSearchOptions,
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
export type EmailRetrievalAction = InboxSearchAction;
export type EmailRetrievalFilters = InboxSearchFilters;
export type EmailRetrievalOptions = InboxSearchOptions;

export type EmailRetrievalRequest = {
  action: EmailRetrievalAction;
  mode?: EmailRetrievalMode;
  queryText?: string;
  filters?: EmailRetrievalFilters;
  options?: EmailRetrievalOptions;
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

type RetrievalCoverage = InboxSearchCoverage;
type RetrievalMetadata = EmailEvidenceMetadataDTO;

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
  const filtersJson = input.request.filters
    ? JSON.stringify(input.request.filters, null, 2)
    : '(none)';
  const optionsJson = input.request.options
    ? JSON.stringify(input.request.options, null, 2)
    : '(none)';
  const coverageJson = JSON.stringify(input.coverage, null, 2);
  const candidatesJson =
    input.candidates.length > 0
      ? JSON.stringify(input.candidates, null, 2)
      : '(none)';

  return template
    .replace('{action}', input.request.action)
    .replace('{queryText}', input.request.queryText ?? '(none)')
    .replace('{mode}', input.request.mode ?? 'quick')
    .replace('{filtersJson}', filtersJson)
    .replace('{optionsJson}', optionsJson)
    .replace('{coverageJson}', coverageJson)
    .replace('{candidatesJson}', candidatesJson);
}

function createEmptyCoverage(
  action: EmailRetrievalAction,
  budgetNotes: string[],
  overrides?: Partial<RetrievalCoverage>,
): RetrievalCoverage {
  return {
    action,
    queriesTried: [],
    threadsScanned: 0,
    messagesScanned: 0,
    timeWindow: 'unknown',
    pagesFetched: 0,
    truncated: false,
    filterOnly: true,
    appliedFilters: [],
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
  action: EmailRetrievalAction,
  coverage: RetrievalCoverage,
  followUpQuestions: string[],
  metadata?: RetrievalMetadata,
): EmailEvidencePackDTO {
  return {
    action,
    matches: [],
    quotes: [],
    coverage,
    confidence: 'low',
    metadata,
    followUpQuestions,
  };
}

function createDeterministicSummary(
  action: EmailRetrievalAction,
  candidates: InboxSearchCandidate[],
  coverage: RetrievalCoverage,
): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  if (action === 'summarize_range') {
    const topCandidate = candidates[0]!;
    return `Found ${candidates.length} matching email${candidates.length === 1 ? '' : 's'} across ${coverage.timeWindow}. Top thread: ${topCandidate.subject}.`;
  }

  return undefined;
}

function createDeterministicEvidencePack(params: {
  action: EmailRetrievalAction;
  candidates: InboxSearchCandidate[];
  coverage: RetrievalCoverage;
  mode: EmailRetrievalMode;
  metadata?: RetrievalMetadata;
  includeQuotes?: boolean;
  includeSnippets?: boolean;
  summary?: string;
}): EmailEvidencePackDTO {
  const {
    action,
    candidates,
    coverage,
    mode,
    metadata,
    includeQuotes = true,
    includeSnippets = true,
    summary,
  } = params;
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
    action,
    matches: topCandidates.map((candidate) => ({
      threadId: candidate.threadId,
      messageId: candidate.messageId,
      mailboxId: candidate.mailboxId,
      mailboxEmail: candidate.mailboxEmail,
      from: candidate.from,
      subject: candidate.subject,
      date: candidate.date,
      whyRelevant: candidate.whyRelevant,
      quote: includeSnippets ? candidate.snippet.slice(0, 360) : '',
    })),
    quotes: includeQuotes
      ? topCandidates.slice(0, 2).map((candidate) => ({
          threadId: candidate.threadId,
          messageId: candidate.messageId,
          mailboxId: candidate.mailboxId,
          mailboxEmail: candidate.mailboxEmail,
          quote: candidate.snippet.slice(0, 360),
          note: candidate.whyRelevant.slice(0, 200),
        }))
      : [],
    coverage,
    confidence,
    metadata,
    summary: summary ?? createDeterministicSummary(action, topCandidates, coverage),
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

function createCountOrAggregateEvidencePack(params: {
  action: Extract<EmailRetrievalAction, 'count' | 'aggregate'>;
  coverage: RetrievalCoverage;
  count: number;
  aggregates?: InboxSearchAggregate[];
  groupBy?: EmailRetrievalOptions['groupBy'];
}): EmailEvidencePackDTO {
  const { action, coverage, count, aggregates, groupBy } = params;
  const topBucket = aggregates?.[0];
  const summary =
    action === 'count'
      ? groupBy && topBucket
        ? `Found ${count} matching emails. Top ${groupBy}: ${topBucket.key} (${topBucket.count}).`
        : `Found ${count} matching emails.`
      : topBucket
        ? `Top ${groupBy ?? 'bucket'}: ${topBucket.key} (${topBucket.count}).`
        : `No aggregate buckets matched.`;

  return {
    action,
    matches: [],
    quotes: [],
    coverage,
    confidence: count > 0 ? 'high' : 'low',
    summary,
    count,
    aggregates,
    groupBy,
    followUpQuestions:
      count === 0
        ? ['Want to narrow this with a sender, mailbox, or date range?']
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

function shouldEscalateQuickResult(result: EmailEvidencePackDTO): boolean {
  return result.confidence === 'low' && result.matches.length < 2;
}

function buildQuickEscalationCoverage(coverage: RetrievalCoverage): RetrievalCoverage {
  return {
    ...coverage,
    budgetNotes: [
      ...(coverage.budgetNotes ?? []),
      'Escalated from quick to deep local retrieval because the initial quick result was weak.',
    ],
  };
}

async function runEscalatedQuickSearch(params: {
  request: EmailRetrievalRequest;
  userId: string;
  profile: InboxSearchRetrievalProfile;
  deadlineAt?: number;
}): Promise<{
  result: Awaited<ReturnType<typeof runLocalInboxSearch>>;
  metadata: RetrievalMetadata;
}> {
  logger.info('[emailRetrievalSubagent] escalating weak quick retrieval to deep local search', {
    userId: params.userId,
    action: params.request.action,
    queryText: params.request.queryText ?? null,
    mailboxId: params.request.mailboxId ?? null,
    mailboxEmail: params.request.mailboxEmail ?? null,
  });

  return {
    result: await runLocalInboxSearch({
      request: params.request,
      userId: params.userId,
      profile: params.profile,
      mode: 'deep',
      budgets: RETRIEVAL_BUDGETS_BY_PROFILE[params.profile].deep,
      deadlineAt: params.deadlineAt,
    }),
    metadata: { escalation: 'quick_to_deep' },
  };
}

async function runLocalInboxSearch(params: {
  request: EmailRetrievalRequest;
  userId: string;
  profile: InboxSearchRetrievalProfile;
  mode: EmailRetrievalMode;
  budgets: RetrievalBudgets;
  deadlineAt?: number;
}): Promise<{
  scopedMailboxes: InboxSearchScopedMailbox[];
  searchResult: Awaited<ReturnType<typeof searchInboxDocuments>>;
}> {
  const scopedMailboxes = await resolveMailboxScope({
    userId: params.userId,
    mailboxId: params.request.mailboxId,
    mailboxEmail: params.request.mailboxEmail,
  });

  if (scopedMailboxes.length === 0) {
    return {
      scopedMailboxes,
      searchResult: {
        action: params.request.action,
        candidates: [],
        coverage: createEmptyCoverage(
          params.request.action,
          [
            params.request.mailboxId || params.request.mailboxEmail
              ? 'The requested mailbox is not available for local inbox retrieval.'
              : 'No mailboxes are available for local inbox retrieval.',
          ],
        ),
      },
    };
  }

  const searchResult = await searchInboxDocuments({
    userId: params.userId,
    action: params.request.action,
    mode: params.mode,
    profile: params.profile,
    queryText: params.request.queryText,
    filters: params.request.filters,
    options: params.request.options,
    mailboxes: scopedMailboxes,
    maxCandidates: params.budgets.maxCandidates,
    snippetChars: params.budgets.snippetChars,
    deadlineAt: params.deadlineAt,
  });

  return {
    scopedMailboxes,
    searchResult,
  };
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
  const action = request.action;
  const mode: EmailRetrievalMode = request.mode ?? 'quick';
  const profile = normalizeRetrievalProfile(request.profile);
  const budgets = RETRIEVAL_BUDGETS_BY_PROFILE[profile][mode];
  const featureFlags = getInboxRetrievalFeatureFlags();

  if (!featureFlags.retrievalV2Enabled) {
    return createEmptyEvidencePack(
      action,
      createEmptyCoverage(action, [
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
      action,
      mode,
      profile,
      retrievalV2Enabled: featureFlags.retrievalV2Enabled,
      vectorEnabled: featureFlags.vectorEnabled,
      llmRerankDeepOnly: featureFlags.llmRerankDeepOnly,
    });

    const {
      scopedMailboxes,
      searchResult,
    } = await runLocalInboxSearch({
      request,
      userId: dependencies.userId,
      profile,
      mode,
      budgets,
      deadlineAt: dependencies.deadlineAt,
    });

    if (scopedMailboxes.length === 0) {
      return createEmptyEvidencePack(action, searchResult.coverage, [
        request.mailboxId || request.mailboxEmail
          ? 'I cannot find that mailbox locally yet. Want to choose another mailbox?'
          : 'I do not have any indexed mailbox data yet. Want to reconnect or wait for indexing?',
      ]);
    }

    logger.info(
      `[emailRetrievalSubagent] local retrieval profile=${profile} action=${action} mode=${mode} mailboxes=${scopedMailboxes.length}`,
    );

    logger.info(
      `[emailRetrievalSubagent] local candidates=${searchResult.candidates.length} scanned=${searchResult.coverage.messagesScanned} freshness=${searchResult.coverage.indexFreshness}`,
    );

    if (action === 'count' || action === 'aggregate') {
      return createCountOrAggregateEvidencePack({
        action,
        coverage: searchResult.coverage,
        count: searchResult.count ?? 0,
        aggregates: searchResult.aggregates,
        groupBy: searchResult.groupBy,
      });
    }

    if (mode === 'quick') {
      if (searchResult.candidates.length === 0) {
        if (!isTimeLow(dependencies.deadlineAt, 6_000)) {
          const escalated = await runEscalatedQuickSearch({
            request,
            userId: dependencies.userId,
            profile,
            deadlineAt: dependencies.deadlineAt,
          });

          if (escalated.result.searchResult.candidates.length > 0) {
            return createDeterministicEvidencePack({
              action,
              candidates: escalated.result.searchResult.candidates,
              coverage: buildQuickEscalationCoverage(escalated.result.searchResult.coverage),
              mode: 'deep',
              metadata: escalated.metadata,
              includeQuotes: request.options?.includeQuotes,
              includeSnippets: request.options?.includeSnippets,
            });
          }

          return createEmptyEvidencePack(
            action,
            buildQuickEscalationCoverage(escalated.result.searchResult.coverage),
            ['I did not find a local match yet. Can you share a sender, subject, or timeframe?'],
            escalated.metadata,
          );
        }

        return createEmptyEvidencePack(action, searchResult.coverage, [
          'I did not find a local match yet. Can you share a sender, subject, or timeframe?',
        ]);
      }

      const quickPack = createDeterministicEvidencePack({
        action,
        candidates: searchResult.candidates,
        coverage: searchResult.coverage,
        mode,
        includeQuotes: request.options?.includeQuotes,
        includeSnippets: request.options?.includeSnippets,
      });

      if (
        action === 'find' &&
        shouldEscalateQuickResult(quickPack) &&
        !isTimeLow(dependencies.deadlineAt, 6_000)
      ) {
        const escalated = await runEscalatedQuickSearch({
          request,
          userId: dependencies.userId,
          profile,
          deadlineAt: dependencies.deadlineAt,
        });

        if (escalated.result.searchResult.candidates.length > 0) {
          return createDeterministicEvidencePack({
            action,
            candidates: escalated.result.searchResult.candidates,
            coverage: buildQuickEscalationCoverage(escalated.result.searchResult.coverage),
            mode: 'deep',
            metadata: escalated.metadata,
            includeQuotes: request.options?.includeQuotes,
            includeSnippets: request.options?.includeSnippets,
          });
        }
      }

      return quickPack;
    }

    if (searchResult.candidates.length === 0) {
      return createEmptyEvidencePack(action, searchResult.coverage, [
        'I did not find a local match yet. Can you share a sender, subject, or timeframe?',
      ]);
    }

    const shouldUseLlm =
      action === 'summarize_range' ||
      (action === 'find' && featureFlags.llmRerankDeepOnly);

    if (!shouldUseLlm) {
      return createDeterministicEvidencePack({
        action,
        candidates: searchResult.candidates,
        coverage: {
          ...searchResult.coverage,
          budgetNotes: [
            ...(searchResult.coverage.budgetNotes ?? []),
            action === 'find'
              ? 'Skipped deep LLM rerank because INBOX_LLM_RERANK_DEEP_ONLY=false.'
              : 'Used deterministic summary because LLM compression was not required.',
          ],
        },
        mode,
        includeQuotes: request.options?.includeQuotes,
        includeSnippets: request.options?.includeSnippets,
      });
    }

    if (isTimeLow(dependencies.deadlineAt, 5_000)) {
      const coverage = {
        ...searchResult.coverage,
        budgetNotes: [
          ...(searchResult.coverage.budgetNotes ?? []),
          'Skipped deep LLM compression because the remaining time budget was low.',
        ],
      };

      return createDeterministicEvidencePack({
        action,
        candidates: searchResult.candidates,
        coverage,
        mode,
        includeQuotes: request.options?.includeQuotes,
        includeSnippets: request.options?.includeSnippets,
      });
    }

    const prompt = buildEmailRetrievalPrompt({
      request: { ...request, mode },
      coverage: searchResult.coverage,
      candidates: searchResult.candidates,
    });

    const { object } = await callObject<EmailEvidencePackDTO>({
      model: models.emailRetrieval(),
      system:
        'You are an email retrieval specialist. Use only the provided local inbox candidates and return a precise evidence pack. Do not invent details or new filters.',
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
      action,
      coverage: searchResult.coverage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[emailRetrievalSubagent] Retrieval failed: ${message}`);

    return createEmptyEvidencePack(
      action,
      createEmptyCoverage(action, [`Local retrieval error: ${message}`]),
      ['Something went wrong while searching. Want to retry with a sender or timeframe?'],
    );
  }
}
