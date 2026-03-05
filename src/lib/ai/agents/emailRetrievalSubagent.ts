import { callObject } from '@/lib/ai/callLlm';
import { z } from 'zod';
import { models } from '@/lib/ai/models';
import {
  EmailEvidencePackSchema,
  type EmailEvidenceExpansionDTO,
  type EmailEvidenceMetadataDTO,
  type EmailEvidencePackDTO,
  type ExpandedInboxThreadDTO,
} from '@/lib/ai/schemas/emailRetrievalSchemas';
import { logger } from '@/lib/logger';
import { readPromptFile } from '@/lib/prompts';
import {
  fetchInboxThreadSlice,
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
  userRequestText?: string;
  selectedPack?: string;
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

type ExpansionBudgets = {
  candidatePoolSize: number;
  maxThreads: number;
  maxMessagesPerThread: number;
  maxMessageChars: number;
  maxExpandedChars: number;
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
const COMPACT_MATCH_LIMIT = 5;
const COMPACT_QUOTE_LIMIT = 2;
const EXPANSION_EARLY_EXIT_BUFFER_MS = 4_000;

const EXPANSION_BUDGETS_BY_MODE: Record<EmailRetrievalMode, ExpansionBudgets> = {
  quick: {
    candidatePoolSize: 8,
    maxThreads: 1,
    maxMessagesPerThread: 4,
    maxMessageChars: 3000,
    maxExpandedChars: 9000,
  },
  deep: {
    candidatePoolSize: 16,
    maxThreads: 2,
    maxMessagesPerThread: 6,
    maxMessageChars: 5000,
    maxExpandedChars: 24000,
  },
};

const EmailExpansionDecisionSchema = z.object({
  shouldExpand: z.boolean(),
  reasons: z.array(z.string()).min(1).max(4),
  preferredAnchorRanks: z.array(z.number().int().min(1)).max(4).optional(),
});

type EmailExpansionDecisionDTO = z.infer<typeof EmailExpansionDecisionSchema>;

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
    summary: coverage.budgetNotes?.[0] ?? 'No matching email evidence found.',
    followUpQuestions,
  };
}

function appendCoverageBudgetNotes<T extends { budgetNotes?: string[] }>(
  coverage: T,
  notes: string[],
): T {
  if (notes.length === 0) {
    return coverage;
  }

  return {
    ...coverage,
    budgetNotes: [...(coverage.budgetNotes ?? []), ...notes],
  } as T;
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

  if (action === 'find') {
    const topCandidate = candidates[0]!;
    return `Top match: ${topCandidate.subject} from ${topCandidate.from}.`;
  }

  return `Found ${candidates.length} matching email${candidates.length === 1 ? '' : 's'}.`;
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
  const topCandidates = candidates.slice(0, COMPACT_MATCH_LIMIT);
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
      ? topCandidates.slice(0, COMPACT_QUOTE_LIMIT).map((candidate) => ({
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

type ExpansionAnchorCandidate = {
  candidate: InboxSearchCandidate;
  selectionRank: number;
  anchorReason: string;
  score: number;
  promoted: boolean;
};

function normalizeIntentText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function buildCompactExpansionMetadata(reasons: string[]): EmailEvidenceExpansionDTO {
  return {
    applied: false,
    mode: 'compact',
    reasons,
  };
}

function buildExpansionDecisionPrompt(params: {
  request: EmailRetrievalRequest;
  compactPack: EmailEvidencePackDTO;
  candidates: InboxSearchCandidate[];
  requestedMode: EmailRetrievalMode;
}): string {
  const candidateSummary =
    params.candidates.length === 0
      ? '(none)'
      : params.candidates
          .map(
            (candidate, index) =>
              `${index + 1}. subject="${candidate.subject}" from="${candidate.from}" why="${candidate.whyRelevant}"`,
          )
          .join('\n');

  return [
    `User request: ${normalizeIntentText(params.request.userRequestText) || '(none)'}`,
    `Tool query: ${normalizeIntentText(params.request.queryText) || '(none)'}`,
    `Selected pack: ${params.request.selectedPack ?? '(none)'}`,
    `Action: ${params.request.action}`,
    `Mode: ${params.requestedMode}`,
    `Compact confidence: ${params.compactPack.confidence}`,
    `Compact summary: ${params.compactPack.summary ?? '(none)'}`,
    'Ranked candidates:',
    candidateSummary,
    '',
    'Decide whether bounded full-thread expansion would materially improve the final answer.',
    'Return preferredAnchorRanks only for the 1-based candidate ranks that should anchor thread expansion.',
    'Prefer compact=false only when snippets are already sufficient for the user request.',
  ].join('\n');
}

async function runExpansionDecision(params: {
  request: EmailRetrievalRequest;
  compactPack: EmailEvidencePackDTO;
  candidates: InboxSearchCandidate[];
  requestedMode: EmailRetrievalMode;
  abortSignal?: AbortSignal;
}): Promise<EmailExpansionDecisionDTO> {
  const candidatePool = params.candidates.slice(
    0,
    EXPANSION_BUDGETS_BY_MODE[params.requestedMode].candidatePoolSize,
  );

  const { object } = await callObject<EmailExpansionDecisionDTO>({
    model: models.emailRetrieval(),
    system:
      'You decide whether an email retrieval result needs bounded full-thread expansion. Use the user request, compact evidence, and ranked candidates only. Prefer compact results when snippets are already sufficient. Never invent candidate ranks.',
    prompt: buildExpansionDecisionPrompt({
      request: params.request,
      compactPack: params.compactPack,
      candidates: candidatePool,
      requestedMode: params.requestedMode,
    }),
    schema: EmailExpansionDecisionSchema,
    temperature: 0,
    abortSignal: params.abortSignal,
    op: 'email.retrieval.expansion_decision',
    concurrency: { key: 'email.retrieval.expansion_decision', maxConcurrency: 4 },
    retry: { maxAttempts: 2, baseDelayMs: 250 },
  });

  return object;
}

function buildAnchorReason(params: {
  compactMatchIndex: number;
  explicitlyPreferred: boolean;
  promoted: boolean;
}): string {
  if (params.explicitlyPreferred && params.promoted) {
    return 'Selected by the expansion decision and promoted from the ranked candidate pool.';
  }

  if (params.explicitlyPreferred) {
    return 'Selected by the expansion decision for bounded thread context.';
  }

  if (params.compactMatchIndex === 0) {
    return 'Top compact match selected for bounded thread context.';
  }

  if (params.compactMatchIndex >= 0) {
    return 'Compact match selected for bounded thread context.';
  }

  return 'Highest-ranked remaining candidate selected for bounded thread context.';
}

function selectExpansionAnchors(params: {
  compactPack: EmailEvidencePackDTO;
  candidates: InboxSearchCandidate[];
  budgets: ExpansionBudgets;
  decision: EmailExpansionDecisionDTO;
}): ExpansionAnchorCandidate[] {
  const compactMessageIds = new Set(
    params.compactPack.matches.map((match) => match.messageId),
  );
  const compactMatchIndexByMessageId = new Map(
    params.compactPack.matches.map((match, index) => [match.messageId, index] as const),
  );
  const preferredRanks = new Set(params.decision.preferredAnchorRanks ?? []);
  const pool = params.candidates.slice(0, params.budgets.candidatePoolSize);

  return pool
    .map((candidate, index) => {
      const compactMatchIndex = compactMatchIndexByMessageId.get(candidate.messageId) ?? -1;
      const explicitlyPreferred = preferredRanks.has(index + 1);
      const promoted = !compactMessageIds.has(candidate.messageId);
      const score =
        (explicitlyPreferred ? 500 : 0) +
        (params.budgets.candidatePoolSize - index) * 6 +
        Math.round(candidate.totalScore * 10) +
        (compactMatchIndex >= 0 ? 30 - compactMatchIndex * 4 : 0);

      return {
        candidate,
        selectionRank: index + 1,
        anchorReason: buildAnchorReason({
          compactMatchIndex,
          explicitlyPreferred,
          promoted,
        }),
        score,
        promoted,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.selectionRank - right.selectionRank;
    })
    .filter((item, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.candidate.threadId === item.candidate.threadId &&
          candidate.candidate.mailboxId === item.candidate.mailboxId,
      ) === index,
    )
    .slice(0, params.budgets.maxThreads);
}

async function applyAdaptiveExpansion(params: {
  request: EmailRetrievalRequest;
  compactPack: EmailEvidencePackDTO;
  candidates: InboxSearchCandidate[];
  requestedMode: EmailRetrievalMode;
  userId: string;
  deadlineAt?: number;
  abortSignal?: AbortSignal;
}): Promise<EmailEvidencePackDTO> {
  if (params.request.action === 'count' || params.request.action === 'aggregate') {
    return {
      ...params.compactPack,
      expansion: buildCompactExpansionMetadata([
        'Count and aggregate requests stay compact by design.',
      ]),
    };
  }

  if (params.compactPack.matches.length === 0 || params.candidates.length === 0) {
    return {
      ...params.compactPack,
      expansion: buildCompactExpansionMetadata([
        'No ranked matches were available for bounded thread expansion.',
      ]),
    };
  }

  if (params.abortSignal?.aborted) {
    const note = 'Skipped bounded thread expansion because a newer user message superseded this run.';
    return {
      ...params.compactPack,
      coverage: appendCoverageBudgetNotes(params.compactPack.coverage, [note]),
      expansion: buildCompactExpansionMetadata([note]),
    };
  }

  if (isTimeLow(params.deadlineAt, EXPANSION_EARLY_EXIT_BUFFER_MS)) {
    const note = 'Skipped bounded thread expansion because the remaining time budget was low.';
    return {
      ...params.compactPack,
      coverage: appendCoverageBudgetNotes(params.compactPack.coverage, [note]),
      expansion: buildCompactExpansionMetadata([note]),
    };
  }

  let decision: EmailExpansionDecisionDTO;
  try {
    decision = await runExpansionDecision({
      request: params.request,
      compactPack: params.compactPack,
      candidates: params.candidates,
      requestedMode: params.requestedMode,
      abortSignal: params.abortSignal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown expansion decision error';
    const note = `Skipped bounded thread expansion because the expansion decision step failed (${message}).`;
    logger.warn('[emailRetrievalSubagent] expansion decision failed', {
      userId: params.userId,
      action: params.request.action,
      mode: params.requestedMode,
      message,
    });
    return {
      ...params.compactPack,
      coverage: appendCoverageBudgetNotes(params.compactPack.coverage, [note]),
      expansion: buildCompactExpansionMetadata([note]),
    };
  }

  if (!decision.shouldExpand) {
    return {
      ...params.compactPack,
      expansion: buildCompactExpansionMetadata(decision.reasons),
    };
  }

  const budgets = EXPANSION_BUDGETS_BY_MODE[params.requestedMode];
  const anchors = selectExpansionAnchors({
    compactPack: params.compactPack,
    candidates: params.candidates,
    budgets,
    decision,
  });

  if (anchors.length === 0) {
    const note = 'Expansion was requested, but no bounded thread anchor could be selected.';
    return {
      ...params.compactPack,
      coverage: appendCoverageBudgetNotes(params.compactPack.coverage, [note]),
      expansion: buildCompactExpansionMetadata([...decision.reasons, note]),
    };
  }

  const expandedThreads: ExpandedInboxThreadDTO[] = [];
  const promotedCandidateRanks: number[] = [];
  const expansionNotes: string[] = [];
  let remainingChars = budgets.maxExpandedChars;

  for (const anchor of anchors) {
    if (remainingChars <= 0) {
      expansionNotes.push('Expansion caps prevented additional thread slices from being attached.');
      break;
    }

    try {
      const slice = await fetchInboxThreadSlice({
        userId: params.userId,
        mailboxId: anchor.candidate.mailboxId,
        threadId: anchor.candidate.threadId,
        anchorMessageId: anchor.candidate.messageId,
        maxMessages: budgets.maxMessagesPerThread,
        maxBodyCharsPerMessage: budgets.maxMessageChars,
        maxTotalBodyChars: remainingChars,
      });

      if (!slice || slice.messagesReturned === 0) {
        expansionNotes.push(
          `Skipped bounded thread slice for ${anchor.candidate.subject} because no messages fit the current expansion caps.`,
        );
        continue;
      }

      remainingChars -= slice.bodyCharsUsed;
      expandedThreads.push({
        threadId: slice.threadId,
        mailboxId: slice.mailboxId,
        mailboxEmail: slice.mailboxEmail,
        anchorMessageId: slice.anchorMessageId,
        anchorSubject: anchor.candidate.subject,
        selectionRank: anchor.selectionRank,
        anchorReason: anchor.anchorReason,
        hasMoreBefore: slice.hasMoreBefore,
        hasMoreAfter: slice.hasMoreAfter,
        messagesReturned: slice.messagesReturned,
        messages: slice.messages,
      });

      if (anchor.promoted) {
        promotedCandidateRanks.push(anchor.selectionRank);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown thread expansion error';
      expansionNotes.push(
        `Failed to fetch a bounded thread slice for ${anchor.candidate.subject} (${message}).`,
      );
      logger.warn('[emailRetrievalSubagent] bounded thread expansion failed', {
        userId: params.userId,
        threadId: anchor.candidate.threadId,
        mailboxId: anchor.candidate.mailboxId,
        message,
      });
    }
  }

  if (expandedThreads.length === 0) {
    const note =
      expansionNotes[0] ??
      'Expansion was requested, but thread and character caps prevented any bounded slices.';

    return {
      ...params.compactPack,
      coverage: appendCoverageBudgetNotes(params.compactPack.coverage, [note]),
      expansion: buildCompactExpansionMetadata([...decision.reasons, ...expansionNotes]),
    };
  }

  return {
    ...params.compactPack,
    expandedThreads,
    expansion: {
      applied: true,
      mode: 'expanded',
      reasons: [...decision.reasons, ...expansionNotes],
      promotedCandidateRanks:
        promotedCandidateRanks.length > 0 ? promotedCandidateRanks : undefined,
    },
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

  const expandedCandidateLimit =
    params.request.action === 'find' || params.request.action === 'summarize_range'
      ? Math.max(
          params.request.options?.limit ?? 0,
          EXPANSION_BUDGETS_BY_MODE[params.mode].candidatePoolSize,
        )
      : params.request.options?.limit;

  const searchResult = await searchInboxDocuments({
    userId: params.userId,
    action: params.request.action,
    mode: params.mode,
    profile: params.profile,
    queryText: params.request.queryText,
    filters: params.request.filters,
    options: {
      ...params.request.options,
      limit: expandedCandidateLimit,
    },
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

    const localSearch = await runLocalInboxSearch({
      request,
      userId: dependencies.userId,
      profile,
      mode,
      budgets,
      deadlineAt: dependencies.deadlineAt,
    });
    const { scopedMailboxes } = localSearch;
    let activeSearchResult = localSearch.searchResult;
    let activeMetadata: RetrievalMetadata | undefined;

    if (scopedMailboxes.length === 0) {
      return createEmptyEvidencePack(action, activeSearchResult.coverage, [
        request.mailboxId || request.mailboxEmail
          ? 'I cannot find that mailbox locally yet. Want to choose another mailbox?'
          : 'I do not have any indexed mailbox data yet. Want to reconnect or wait for indexing?',
      ]);
    }

    logger.info(
      `[emailRetrievalSubagent] local retrieval profile=${profile} action=${action} mode=${mode} mailboxes=${scopedMailboxes.length}`,
    );

    logger.info(
      `[emailRetrievalSubagent] local candidates=${activeSearchResult.candidates.length} scanned=${activeSearchResult.coverage.messagesScanned} freshness=${activeSearchResult.coverage.indexFreshness}`,
    );

    let compactPack: EmailEvidencePackDTO;

    if (action === 'count' || action === 'aggregate') {
      compactPack = createCountOrAggregateEvidencePack({
        action,
        coverage: activeSearchResult.coverage,
        count: activeSearchResult.count ?? 0,
        aggregates: activeSearchResult.aggregates,
        groupBy: activeSearchResult.groupBy,
      });
    } else if (mode === 'quick') {
      if (activeSearchResult.candidates.length === 0) {
        if (!isTimeLow(dependencies.deadlineAt, 6_000)) {
          const escalated = await runEscalatedQuickSearch({
            request,
            userId: dependencies.userId,
            profile,
            deadlineAt: dependencies.deadlineAt,
          });

          activeSearchResult = escalated.result.searchResult;
          activeMetadata = escalated.metadata;

          if (activeSearchResult.candidates.length === 0) {
            return createEmptyEvidencePack(
              action,
              buildQuickEscalationCoverage(activeSearchResult.coverage),
              ['I did not find a local match yet. Can you share a sender, subject, or timeframe?'],
              activeMetadata,
            );
          }

          compactPack = createDeterministicEvidencePack({
            action,
            candidates: activeSearchResult.candidates,
            coverage: buildQuickEscalationCoverage(activeSearchResult.coverage),
            mode: 'deep',
            metadata: activeMetadata,
            includeQuotes: request.options?.includeQuotes,
            includeSnippets: request.options?.includeSnippets,
          });
        } else {
          return createEmptyEvidencePack(action, activeSearchResult.coverage, [
            'I did not find a local match yet. Can you share a sender, subject, or timeframe?',
          ]);
        }
      } else {
        compactPack = createDeterministicEvidencePack({
          action,
          candidates: activeSearchResult.candidates,
          coverage: activeSearchResult.coverage,
          mode,
          includeQuotes: request.options?.includeQuotes,
          includeSnippets: request.options?.includeSnippets,
        });

        if (
          action === 'find' &&
          shouldEscalateQuickResult(compactPack) &&
          !isTimeLow(dependencies.deadlineAt, 6_000)
        ) {
          const escalated = await runEscalatedQuickSearch({
            request,
            userId: dependencies.userId,
            profile,
            deadlineAt: dependencies.deadlineAt,
          });

          if (escalated.result.searchResult.candidates.length > 0) {
            activeSearchResult = escalated.result.searchResult;
            activeMetadata = escalated.metadata;
            compactPack = createDeterministicEvidencePack({
              action,
              candidates: activeSearchResult.candidates,
              coverage: buildQuickEscalationCoverage(activeSearchResult.coverage),
              mode: 'deep',
              metadata: activeMetadata,
              includeQuotes: request.options?.includeQuotes,
              includeSnippets: request.options?.includeSnippets,
            });
          }
        }
      }
    } else {
      if (activeSearchResult.candidates.length === 0) {
        return createEmptyEvidencePack(action, activeSearchResult.coverage, [
          'I did not find a local match yet. Can you share a sender, subject, or timeframe?',
        ]);
      }

      const shouldUseLlm =
        action === 'summarize_range' ||
        (action === 'find' && featureFlags.llmRerankDeepOnly);

      if (!shouldUseLlm) {
        compactPack = createDeterministicEvidencePack({
          action,
          candidates: activeSearchResult.candidates,
          coverage: appendCoverageBudgetNotes(activeSearchResult.coverage, [
            action === 'find'
              ? 'Skipped deep LLM rerank because INBOX_LLM_RERANK_DEEP_ONLY=false.'
              : 'Used deterministic summary because LLM compression was not required.',
          ]),
          mode,
          includeQuotes: request.options?.includeQuotes,
          includeSnippets: request.options?.includeSnippets,
        });
      } else if (isTimeLow(dependencies.deadlineAt, 5_000)) {
        compactPack = createDeterministicEvidencePack({
          action,
          candidates: activeSearchResult.candidates,
          coverage: appendCoverageBudgetNotes(activeSearchResult.coverage, [
            'Skipped deep LLM compression because the remaining time budget was low.',
          ]),
          mode,
          includeQuotes: request.options?.includeQuotes,
          includeSnippets: request.options?.includeSnippets,
        });
      } else if (dependencies.abortSignal?.aborted) {
        compactPack = createDeterministicEvidencePack({
          action,
          candidates: activeSearchResult.candidates,
          coverage: appendCoverageBudgetNotes(activeSearchResult.coverage, [
            'Skipped deep LLM compression because a newer user message superseded this run.',
          ]),
          mode,
          includeQuotes: request.options?.includeQuotes,
          includeSnippets: request.options?.includeSnippets,
        });
      } else {
        const prompt = buildEmailRetrievalPrompt({
          request: { ...request, mode },
          coverage: activeSearchResult.coverage,
          candidates: activeSearchResult.candidates,
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

        compactPack = {
          ...object,
          action,
          matches: object.matches.slice(0, COMPACT_MATCH_LIMIT),
          quotes: object.quotes.slice(0, COMPACT_QUOTE_LIMIT),
          coverage: activeSearchResult.coverage,
          metadata: activeMetadata
            ? {
                ...(object.metadata ?? {}),
                ...activeMetadata,
              }
            : object.metadata,
          summary:
            object.summary ??
            createDeterministicSummary(
              action,
              activeSearchResult.candidates,
              activeSearchResult.coverage,
            ),
          expandedThreads: undefined,
          expansion: undefined,
        };
      }
    }

    return applyAdaptiveExpansion({
      request: {
        ...request,
        mode,
      },
      compactPack,
      candidates: activeSearchResult.candidates,
      requestedMode: mode,
      userId: dependencies.userId,
      deadlineAt: dependencies.deadlineAt,
      abortSignal: dependencies.abortSignal,
    });
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
