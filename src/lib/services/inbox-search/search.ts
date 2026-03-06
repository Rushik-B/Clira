import { InboxBackfillState, Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { embedInboxQueryText, serializeVectorLiteral } from '@/lib/services/inbox-search/embeddings';
import { getInboxRetrievalFeatureFlags } from '@/lib/services/inbox-search/feature-flags';
import {
  analyzeInboxQueryIntent,
  type InboxSearchQueryIntent,
} from '@/lib/services/inbox-search/query-intent';
import {
  addDaysToDateOnly,
  getDateOnlyInTimezone,
  startOfDayInTimezone,
} from '@/lib/utils/timezone';
import {
  buildInboxWhyRelevant,
  calculateInboxRecencyBoost,
  collectInboxMatchedTerms,
  hasInboxExactSenderMatch,
  hasInboxExactSubjectMatch,
  roundInboxScore,
} from '@/lib/services/inbox-search/scoring';
import { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';
import type {
  InboxSearchAction,
  InboxSearchAggregate,
  InboxSearchCandidate,
  InboxSearchCoverage,
  InboxSearchFreshness,
  InboxSearchFilters,
  InboxSearchGroupBy,
  InboxSearchOptions,
  InboxSearchRetrievalProfile,
  InboxSearchSearchRequest,
  InboxSearchSearchResult,
  InboxSearchSortBy,
} from '@/lib/services/inbox-search/types';

const PROMOTIONAL_SENDER_REGEX =
  /(?:^|[<\s"])(?:no-?reply|noreply|news|newsletter|marketing|updates?|digest|announcements?|notifications?|hello|team)@/i;
const EARLY_EXIT_BUFFER_MS = 3_000;
const FRESH_INDEX_LAG_MINUTES = 10;
const LAGGING_INDEX_LAG_MINUTES = 120;
const RRF_K = 60;

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

type InboxSearchPlan = {
  action: InboxSearchAction;
  queryIntent: InboxSearchQueryIntent;
  lexicalQuery: string | null;
  semanticQueryText: string | null;
  matchTerms: string[];
  literalPriorityTerms: string[];
  preferLiteralMatches: boolean;
  suppressSemanticOnlyWeakMatches: boolean;
  semanticSimilarityFloor: number;
  semanticCandidateLimit: number;
  exactSenderTerms: string[];
  exactSubjectTerms: string[];
  appliedFilters: string[];
  groupBy: InboxSearchGroupBy | null;
  sortBy: InboxSearchSortBy;
  limit: number;
  resultShape: 'matches' | 'summary' | 'count' | 'aggregates';
  timeWindowLabel: string;
  notes: string[];
  startDate: Date | null;
  endDateExclusive: Date | null;
  filterOnly: boolean;
};

type InboxSearchLexicalRow = {
  documentId: string;
  threadId: string;
  messageId: string;
  mailboxId: string;
  mailboxEmail: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string | null;
  bodyText: string;
  sentAt: Date;
  lexicalScore: number;
  headline: string | null;
};

type InboxSearchSemanticRow = {
  documentId: string;
  threadId: string;
  messageId: string;
  mailboxId: string;
  mailboxEmail: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string | null;
  bodyText: string;
  sentAt: Date;
  semanticScore: number;
  semanticDistance: number;
  semanticChunkText: string | null;
};

type InboxSearchCheckpointRow = {
  mailboxId: string;
  lastIndexedAt: Date | null;
  lagEstimate: number | null;
  backfillState: InboxBackfillState;
};

type InboxSearchRuntimeDependencies = {
  fetchLexicalCandidatesAndCheckpoints: typeof fetchLexicalCandidatesAndCheckpoints;
  fetchSemanticCandidates: typeof fetchSemanticCandidates;
  fetchDocumentCount: typeof fetchDocumentCount;
  fetchAggregateBuckets: typeof fetchAggregateBuckets;
  embedInboxQueryText: typeof embedInboxQueryText;
  now: () => Date;
  isVectorEnabled: () => boolean;
};

function isTimeLow(deadlineAt?: number, bufferMs = EARLY_EXIT_BUFFER_MS): boolean {
  return typeof deadlineAt === 'number' && deadlineAt - Date.now() < bufferMs;
}

function reciprocalRank(rank: number): number {
  return 1 / (RRF_K + rank);
}

function normalizeComparableValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function countLiteralMatches(value: string, terms: string[]): number {
  if (!value || terms.length === 0) {
    return 0;
  }

  const normalizedValue = normalizeComparableValue(value);
  let matches = 0;
  for (const term of terms) {
    const normalizedTerm = normalizeComparableValue(term);
    if (!normalizedTerm) {
      continue;
    }

    if (normalizedValue.includes(normalizedTerm)) {
      matches += 1;
    }
  }

  return matches;
}

function isLikelyDirectCorrespondence(params: {
  baseRow: Pick<InboxSearchLexicalRow | InboxSearchSemanticRow, 'from' | 'to' | 'cc' | 'mailboxEmail'>;
  senderLooksPromotional: boolean;
}): boolean {
  if (params.senderLooksPromotional) {
    return false;
  }

  const normalizedMailbox = normalizeComparableValue(params.baseRow.mailboxEmail);
  const normalizedFrom = normalizeComparableValue(params.baseRow.from);
  const participantCount = [params.baseRow.from, ...(params.baseRow.to ?? []), ...(params.baseRow.cc ?? [])]
    .filter(Boolean).length;
  const recipients = [...(params.baseRow.to ?? []), ...(params.baseRow.cc ?? [])].map((value) =>
    normalizeComparableValue(value),
  );

  if (participantCount > 6) {
    return false;
  }

  return normalizedFrom.includes(normalizedMailbox) || recipients.some((value) => value.includes(normalizedMailbox));
}

function parseDateInput(value?: string): { date: Date | null; isDateOnly: boolean } {
  if (!value) {
    return { date: null, isDateOnly: false };
  }

  const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnlyMatch) {
    return {
      date: new Date(`${dateOnlyMatch[1]}T00:00:00.000Z`),
      isDateOnly: true,
    };
  }

  const parsed = new Date(value);
  return {
    date: Number.isNaN(parsed.getTime()) ? null : parsed,
    isDateOnly: false,
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function resolveRelativeWindow(params: {
  filters?: InboxSearchFilters;
  now?: Date;
  timezone?: string;
}): Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive' | 'timeWindowLabel'> | null {
  const relativeWindow = params.filters?.relativeWindow;
  if (!relativeWindow) {
    return null;
  }

  if (relativeWindow === 'all_time') {
    return {
      startDate: null,
      endDateExclusive: null,
      timeWindowLabel: 'all time',
    };
  }

  const now = params.now ?? new Date();
  const timezone = params.timezone ?? 'UTC';
  const today = getDateOnlyInTimezone(now, timezone);

  switch (relativeWindow) {
    case 'today':
      return {
        startDate: startOfDayInTimezone(today, timezone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timezone),
        timeWindowLabel: `today (${today})`,
      };
    case 'yesterday': {
      const yesterday = addDaysToDateOnly(today, -1);
      return {
        startDate: startOfDayInTimezone(yesterday, timezone),
        endDateExclusive: startOfDayInTimezone(today, timezone),
        timeWindowLabel: `yesterday (${yesterday})`,
      };
    }
    case 'last_7_days':
      return {
        startDate: startOfDayInTimezone(addDaysToDateOnly(today, -6), timezone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timezone),
        timeWindowLabel: 'last 7 days',
      };
    case 'last_30_days':
      return {
        startDate: startOfDayInTimezone(addDaysToDateOnly(today, -29), timezone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timezone),
        timeWindowLabel: 'last 30 days',
      };
    case 'last_90_days':
      return {
        startDate: startOfDayInTimezone(addDaysToDateOnly(today, -89), timezone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timezone),
        timeWindowLabel: 'last 90 days',
      };
    default:
      return null;
  }
}

function resolveTimeWindow(params: {
  action: InboxSearchAction;
  filters?: InboxSearchFilters;
  options?: InboxSearchOptions;
  mode: InboxSearchSearchRequest['mode'];
  profile: InboxSearchRetrievalProfile;
  now?: Date;
}): Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive' | 'timeWindowLabel'> {
  const now = params.now ?? new Date();
  const explicitStartDate = parseDateInput(params.filters?.startDate);
  const explicitEndDate = parseDateInput(params.filters?.endDate);
  const explicitEndDateExclusive =
    params.filters?.endDate && explicitEndDate.date
      ? explicitEndDate.isDateOnly
        ? addDays(explicitEndDate.date, 1)
        : explicitEndDate.date
      : null;

  if (explicitStartDate.date || explicitEndDateExclusive) {
    return {
      startDate: explicitStartDate.date,
      endDateExclusive: explicitEndDateExclusive,
      timeWindowLabel: `${params.filters?.startDate ?? '...'} to ${params.filters?.endDate ?? '...'}`,
    };
  }

  const relativeWindow = resolveRelativeWindow({
    filters: params.filters,
    now,
    timezone: params.options?.timezone,
  });
  if (relativeWindow) {
    return relativeWindow;
  }

  if (params.action !== 'find') {
    return {
      startDate: null,
      endDateExclusive: null,
      timeWindowLabel: 'all time',
    };
  }

  if (params.mode === 'deep') {
    return {
      startDate: null,
      endDateExclusive: null,
      timeWindowLabel: 'all time',
    };
  }

  if (params.profile === 'messaging') {
    return {
      startDate: addDays(now, -90),
      endDateExclusive: null,
      timeWindowLabel: 'last 90 days',
    };
  }

  return {
    startDate: addDays(now, -180),
    endDateExclusive: null,
    timeWindowLabel: 'last 180 days',
  };
}

function buildLexicalQuery(terms: string[]): string | null {
  const cleanedTerms = terms
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) =>
      term.includes(' ')
        ? `"${term.replace(/"/g, '')}"`
        : term.replace(/"/g, ''),
    );

  if (cleanedTerms.length === 0) {
    return null;
  }

  return cleanedTerms.join(' ');
}

function buildSemanticQueryText(params: {
  queryText?: string;
  keywords: string[];
  semanticRequested: boolean;
}): string | null {
  if (!params.semanticRequested) {
    return null;
  }

  const parts = [
    params.queryText?.trim() ?? '',
    params.keywords.length > 0 ? `Keywords: ${params.keywords.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  return parts.length >= 3 ? parts : null;
}

function hasStructuredFilterSignal(filters?: InboxSearchFilters): boolean {
  return Boolean(
    filters?.sender ||
      filters?.recipient ||
      filters?.subjectContains ||
      filters?.bodyContains ||
      (filters?.keywords?.length ?? 0) > 0 ||
      typeof filters?.hasAttachment === 'boolean' ||
      filters?.startDate ||
      filters?.endDate ||
      filters?.relativeWindow ||
      filters?.threadId ||
      filters?.messageId,
  );
}

function collectAppliedFilters(filters?: InboxSearchFilters): string[] {
  if (!filters) {
    return [];
  }

  const applied: string[] = [];
  if (filters.sender) applied.push('sender');
  if (filters.recipient) applied.push('recipient');
  if (filters.subjectContains) applied.push('subjectContains');
  if (filters.bodyContains) applied.push('bodyContains');
  if ((filters.keywords?.length ?? 0) > 0) applied.push('keywords');
  if (typeof filters.hasAttachment === 'boolean') applied.push('hasAttachment');
  if (filters.startDate) applied.push('startDate');
  if (filters.endDate) applied.push('endDate');
  if (filters.relativeWindow) applied.push('relativeWindow');
  if (filters.threadId) applied.push('threadId');
  if (filters.messageId) applied.push('messageId');
  if (filters.includeDeleted) applied.push('includeDeleted');
  return applied;
}

export function buildInboxSearchPlan(params: {
  action: InboxSearchAction;
  queryText?: string;
  filters?: InboxSearchFilters;
  options?: InboxSearchOptions;
  mode: InboxSearchSearchRequest['mode'];
  profile: InboxSearchRetrievalProfile;
  maxCandidates: number;
  now?: Date;
}): InboxSearchPlan {
  const notes: string[] = [];
  const queryText = params.queryText?.trim() ?? '';
  const intent = analyzeInboxQueryIntent({
    queryText,
    filters: params.filters,
  });
  const quotedPhrases = intent.quotedPhrases;
  const queryEmails = intent.queryEmails;
  const queryKeywords = intent.queryKeywords;
  const constraintKeywords = (params.filters?.keywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 6);
  const subjectContains = params.filters?.subjectContains?.trim() ?? '';
  const bodyContains = params.filters?.bodyContains?.trim() ?? '';
  const senderHint = params.filters?.sender?.trim() ?? '';
  const recipientHint = params.filters?.recipient?.trim() ?? '';

  const lexicalTerms = Array.from(new Set([...quotedPhrases, ...queryKeywords, ...constraintKeywords]));
  const lexicalQuery = buildLexicalQuery(lexicalTerms);
  const filterOnly = !lexicalQuery;
  const semanticRequested = Boolean((params.options?.semantic ?? Boolean(queryText)) && queryText);

  if (!lexicalQuery && !hasStructuredFilterSignal(params.filters)) {
    notes.push('No query text or narrowing filters were provided.');
  } else if (!lexicalQuery) {
    notes.push('Running a local filter-only search because no lexical query terms were provided.');
  }
  if (intent.note) {
    notes.push(intent.note);
  }

  const appliedFilters = collectAppliedFilters(params.filters);

  const matchTerms = Array.from(
    new Set([
      ...quotedPhrases,
      ...constraintKeywords,
      ...queryKeywords,
      ...(subjectContains ? [subjectContains] : []),
      ...(bodyContains ? [bodyContains] : []),
      ...(senderHint ? [senderHint] : []),
      ...(recipientHint ? [recipientHint] : []),
      ...queryEmails,
    ]),
  );

  const exactSenderTerms = Array.from(
    new Set([...(senderHint ? [senderHint] : []), ...intent.exactSenderTerms]),
  );
  const exactSubjectTerms = Array.from(
    new Set([...(subjectContains ? [subjectContains] : []), ...intent.exactSubjectTerms]),
  );

  const timeWindow = resolveTimeWindow({
    action: params.action,
    filters: params.filters,
    options: params.options,
    mode: params.mode,
    profile: params.profile,
    now: params.now,
  });
  const sortBy = params.options?.sortBy ?? (params.action === 'find' ? 'relevance' : 'newest');
  const limit = Math.min(params.options?.limit ?? params.maxCandidates, params.maxCandidates);

  return {
    action: params.action,
    queryIntent: intent.intent,
    lexicalQuery,
    semanticQueryText: buildSemanticQueryText({
      queryText,
      keywords: constraintKeywords,
      semanticRequested,
    }),
    matchTerms,
    literalPriorityTerms: intent.literalPriorityTerms,
    preferLiteralMatches: intent.preferLiteralMatches,
    suppressSemanticOnlyWeakMatches: intent.suppressSemanticOnlyWeakMatches,
    semanticSimilarityFloor: intent.semanticSimilarityFloor,
    semanticCandidateLimit: intent.semanticCandidateLimit,
    exactSenderTerms,
    exactSubjectTerms,
    appliedFilters,
    groupBy: params.options?.groupBy ?? null,
    sortBy,
    limit,
    resultShape:
      params.action === 'find'
        ? 'matches'
        : params.action === 'summarize_range'
          ? 'summary'
          : params.action === 'count'
            ? 'count'
            : 'aggregates',
    timeWindowLabel: timeWindow.timeWindowLabel,
    notes,
    startDate: timeWindow.startDate,
    endDateExclusive: timeWindow.endDateExclusive,
    filterOnly,
  };
}

function buildSnippet(params: {
  headline: string | null;
  from: string;
  subject: string;
  snippet: string | null;
  bodyText: string;
  semanticChunkText?: string | null;
  matchedTerms: string[];
  maxChars: number;
}): string {
  const headline = params.headline?.replace(/<<|>>/g, '').trim();
  if (headline) {
    return headline.length > params.maxChars
      ? `${headline.slice(0, params.maxChars - 3)}...`
      : headline;
  }

  const senderAndSubject = `From: ${params.from} Subject: ${params.subject}`.trim();
  const lowerSenderAndSubject = senderAndSubject.toLowerCase();
  const senderOrSubjectMatch = params.matchedTerms.find((term) =>
    lowerSenderAndSubject.includes(term.toLowerCase()),
  );
  if (senderOrSubjectMatch) {
    return senderAndSubject.length > params.maxChars
      ? `${senderAndSubject.slice(0, params.maxChars - 3)}...`
      : senderAndSubject;
  }

  const bodySource = (
    params.bodyText ??
    params.snippet ??
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  const semanticSource = (params.semanticChunkText ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const lowerBodySource = bodySource.toLowerCase();
  const lowerSemanticSource = semanticSource.toLowerCase();
  const preferredMatchedTerm = params.matchedTerms.find((term) => {
    const normalized = term.toLowerCase();
    return lowerBodySource.includes(normalized) || lowerSemanticSource.includes(normalized);
  });
  const source =
    preferredMatchedTerm && lowerBodySource.includes(preferredMatchedTerm.toLowerCase())
      ? bodySource
      : preferredMatchedTerm && lowerSemanticSource.includes(preferredMatchedTerm.toLowerCase())
        ? semanticSource
        : bodySource || semanticSource;

  if (!source) {
    return '';
  }

  const lowerSource = source.toLowerCase();
  const matchedTerm = params.matchedTerms.find((term) =>
    lowerSource.includes(term.toLowerCase()),
  );

  if (!matchedTerm) {
    return source.length > params.maxChars
      ? `${source.slice(0, params.maxChars - 3)}...`
      : source;
  }

  const termIndex = lowerSource.indexOf(matchedTerm.toLowerCase());
  const start = Math.max(0, termIndex - Math.floor(params.maxChars / 3));
  const end = Math.min(source.length, start + params.maxChars);
  const excerpt = source.slice(start, end).trim();

  if (start === 0 && end >= source.length) {
    return excerpt;
  }
  if (start === 0) {
    return `${excerpt}...`;
  }
  if (end >= source.length) {
    return `...${excerpt}`;
  }
  return `...${excerpt}...`;
}

function buildWhereClause(clauses: Prisma.Sql[]): Prisma.Sql {
  if (clauses.length === 0) {
    return Prisma.sql`TRUE`;
  }

  return clauses
    .slice(1)
    .reduce(
      (combined, clause) => Prisma.sql`${combined} AND ${clause}`,
      clauses[0]!,
    );
}

function buildInboxSearchWhereClauses(params: {
  userId: string;
  scopedMailboxIds: string[];
  filters?: InboxSearchFilters;
  plan: Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive'>;
}): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`d."userId" = ${params.userId}`,
    Prisma.sql`m."userId" = ${params.userId}`,
  ];

  if (!params.filters?.includeDeleted) {
    clauses.push(Prisma.sql`d."isDeleted" = false`);
  }

  if (params.scopedMailboxIds.length > 0) {
    clauses.push(Prisma.sql`d."mailboxId" IN (${Prisma.join(params.scopedMailboxIds)})`);
  }

  const senderFilter = params.filters?.sender?.trim();
  if (senderFilter) {
    const escaped = escapeLikePattern(senderFilter.toLowerCase());
    clauses.push(
      Prisma.sql`LOWER(d."from") LIKE ${`%${escaped}%`}`,
    );
  }

  const recipientFilter = params.filters?.recipient?.trim();
  if (recipientFilter) {
    const escaped = escapeLikePattern(recipientFilter.toLowerCase());
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM unnest(array_cat(d."to", d."cc")) AS recipient
        WHERE LOWER(recipient) LIKE ${`%${escaped}%`}
      )
    `);
  }

  const subjectContains = params.filters?.subjectContains?.trim();
  if (subjectContains) {
    const escaped = escapeLikePattern(subjectContains.toLowerCase());
    clauses.push(Prisma.sql`LOWER(COALESCE(d."subject", '')) LIKE ${`%${escaped}%`}`);
  }

  const bodyContains = params.filters?.bodyContains?.trim();
  if (bodyContains) {
    const escaped = escapeLikePattern(bodyContains.toLowerCase());
    clauses.push(Prisma.sql`LOWER(COALESCE(d."bodyText", '')) LIKE ${`%${escaped}%`}`);
  }

  if ((params.filters?.keywords?.length ?? 0) > 0) {
    for (const keyword of params.filters?.keywords ?? []) {
      const escaped = escapeLikePattern(keyword.toLowerCase());
      clauses.push(Prisma.sql`
        (
          LOWER(COALESCE(d."subject", '')) LIKE ${`%${escaped}%`}
          OR LOWER(COALESCE(d."bodyText", '')) LIKE ${`%${escaped}%`}
        )
      `);
    }
  }

  if (params.filters?.hasAttachment === true) {
    clauses.push(Prisma.sql`d."hasAttachment" = true`);
  } else if (params.filters?.hasAttachment === false) {
    clauses.push(Prisma.sql`d."hasAttachment" = false`);
  }

  if (params.plan.startDate) {
    clauses.push(Prisma.sql`d."sentAt" >= ${params.plan.startDate}`);
  }

  if (params.plan.endDateExclusive) {
    clauses.push(Prisma.sql`d."sentAt" < ${params.plan.endDateExclusive}`);
  }

  if (params.filters?.threadId) {
    clauses.push(Prisma.sql`d."threadId" = ${params.filters.threadId}`);
  }

  if (params.filters?.messageId) {
    clauses.push(Prisma.sql`d."messageId" = ${params.filters.messageId}`);
  }

  return clauses;
}

async function fetchLexicalCandidatesAndCheckpoints(params: {
  userId: string;
  lexicalQuery: string | null;
  scopedMailboxIds: string[];
  filters?: InboxSearchFilters;
  plan: Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive'>;
  limit: number;
}): Promise<{
  rows: InboxSearchLexicalRow[];
  checkpoints: InboxSearchCheckpointRow[];
}> {
  return runInboxSearchTransaction(params.userId, async (tx) => {
    const whereClauses = buildInboxSearchWhereClauses({
      userId: params.userId,
      scopedMailboxIds: params.scopedMailboxIds,
      filters: params.filters,
      plan: params.plan,
    });

    const lexicalSource = Prisma.sql`
      COALESCE(d."subject", '') || ' ' ||
      COALESCE(d."from", '') || ' ' ||
      array_to_string(COALESCE(d."to", ARRAY[]::text[]), ' ') || ' ' ||
      array_to_string(COALESCE(d."cc", ARRAY[]::text[]), ' ') || ' ' ||
      COALESCE(d."bodyText", '')
    `;
    const lexicalVector = Prisma.sql`
      to_tsvector('english', ${lexicalSource})
    `;

    if (params.lexicalQuery) {
      whereClauses.push(Prisma.sql`
        ${lexicalVector} @@ websearch_to_tsquery('english', ${params.lexicalQuery})
      `);
    }

    const rows = await tx.$queryRaw<InboxSearchLexicalRow[]>(Prisma.sql`
      SELECT
        d."id" AS "documentId",
        d."threadId" AS "threadId",
        d."messageId" AS "messageId",
        d."mailboxId" AS "mailboxId",
        m."emailAddress" AS "mailboxEmail",
        d."from" AS "from",
        d."to" AS "to",
        d."cc" AS "cc",
        d."subject" AS "subject",
        d."snippet" AS "snippet",
        d."bodyText" AS "bodyText",
        d."sentAt" AS "sentAt",
        ${
          params.lexicalQuery
            ? Prisma.sql`
              ts_rank_cd(
                ${lexicalVector},
                websearch_to_tsquery('english', ${params.lexicalQuery})
              )::double precision
            `
            : Prisma.sql`0::double precision`
        } AS "lexicalScore",
        ${
          params.lexicalQuery
            ? Prisma.sql`
              ts_headline(
                'english',
                ${lexicalSource},
                websearch_to_tsquery('english', ${params.lexicalQuery}),
                'MaxFragments=2, MaxWords=20, MinWords=6, StartSel=<<, StopSel=>>'
              )
            `
            : Prisma.sql`COALESCE(d."snippet", '')`
        } AS "headline"
      FROM "InboxSearchDocument" d
      INNER JOIN "Mailbox" m
        ON m."id" = d."mailboxId"
      WHERE ${buildWhereClause(whereClauses)}
      ORDER BY
        ${
          params.lexicalQuery
            ? Prisma.sql`"lexicalScore" DESC, `
            : Prisma.sql``
        }
        d."sentAt" DESC
      LIMIT ${params.limit}
    `);

    const checkpoints = await tx.inboxSearchCheckpoint.findMany({
      where: {
        userId: params.userId,
        mailboxId: {
          in: params.scopedMailboxIds,
        },
      },
      select: {
        mailboxId: true,
        lastIndexedAt: true,
        lagEstimate: true,
        backfillState: true,
      },
    });

    return { rows, checkpoints };
  });
}

async function fetchSemanticCandidates(params: {
  userId: string;
  queryEmbedding: number[];
  scopedMailboxIds: string[];
  filters?: InboxSearchFilters;
  plan: Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive'>;
  limit: number;
}): Promise<InboxSearchSemanticRow[]> {
  return runInboxSearchTransaction(params.userId, async (tx) => {
    const whereClauses = buildInboxSearchWhereClauses({
      userId: params.userId,
      scopedMailboxIds: params.scopedMailboxIds,
      filters: params.filters,
      plan: params.plan,
    });

    whereClauses.push(Prisma.sql`c."embedding" IS NOT NULL`);
    whereClauses.push(Prisma.sql`c."chunkText" <> ''`);

    const vectorLiteral = serializeVectorLiteral(params.queryEmbedding);

    return tx.$queryRaw<InboxSearchSemanticRow[]>(Prisma.sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON (d."id")
          d."id" AS "documentId",
          d."threadId" AS "threadId",
          d."messageId" AS "messageId",
          d."mailboxId" AS "mailboxId",
          m."emailAddress" AS "mailboxEmail",
          d."from" AS "from",
          d."to" AS "to",
          d."cc" AS "cc",
          d."subject" AS "subject",
          d."snippet" AS "snippet",
          d."bodyText" AS "bodyText",
          d."sentAt" AS "sentAt",
          (1 - (c."embedding" <=> ${vectorLiteral}::vector))::double precision AS "semanticScore",
          (c."embedding" <=> ${vectorLiteral}::vector)::double precision AS "semanticDistance",
          c."chunkText" AS "semanticChunkText"
        FROM "InboxSearchChunk" c
        INNER JOIN "InboxSearchDocument" d
          ON d."id" = c."documentId"
        INNER JOIN "Mailbox" m
          ON m."id" = d."mailboxId"
        WHERE ${buildWhereClause(whereClauses)}
        ORDER BY d."id", "semanticDistance" ASC, d."sentAt" DESC
      ) semantic_docs
      ORDER BY "semanticDistance" ASC, "sentAt" DESC
      LIMIT ${params.limit}
    `);
  });
}

function collapseSemanticRows(rows: InboxSearchSemanticRow[]): InboxSearchSemanticRow[] {
  const bestRowByDocumentId = new Map<string, InboxSearchSemanticRow>();

  for (const row of rows) {
    const existing = bestRowByDocumentId.get(row.documentId);
    if (!existing) {
      bestRowByDocumentId.set(row.documentId, row);
      continue;
    }

    if (row.semanticDistance < existing.semanticDistance) {
      bestRowByDocumentId.set(row.documentId, row);
      continue;
    }

    if (
      row.semanticDistance === existing.semanticDistance &&
      row.sentAt.getTime() > existing.sentAt.getTime()
    ) {
      bestRowByDocumentId.set(row.documentId, row);
    }
  }

  return Array.from(bestRowByDocumentId.values()).sort((left, right) => {
    if (left.semanticDistance !== right.semanticDistance) {
      return left.semanticDistance - right.semanticDistance;
    }

    return right.sentAt.getTime() - left.sentAt.getTime();
  });
}

function classifyInboxIndexFreshness(params: {
  checkpoints: InboxSearchCheckpointRow[];
  scopedMailboxIds: string[];
  now?: Date;
}): { freshness: InboxSearchFreshness; indexLag: number | null; notes: string[] } {
  const now = params.now ?? new Date();

  if (params.scopedMailboxIds.length === 0) {
    return {
      freshness: 'unknown',
      indexLag: null,
      notes: ['No scoped mailboxes were available for local retrieval.'],
    };
  }

  if (params.checkpoints.length < params.scopedMailboxIds.length) {
    return {
      freshness: 'unknown',
      indexLag: null,
      notes: ['At least one scoped mailbox has not created an inbox-search checkpoint yet.'],
    };
  }

  const lagMinutes = params.checkpoints
    .map((checkpoint) => {
      if (typeof checkpoint.lagEstimate === 'number' && checkpoint.lagEstimate >= 0) {
        return checkpoint.lagEstimate;
      }

      if (!checkpoint.lastIndexedAt) {
        return null;
      }

      const elapsedMs = Math.max(
        0,
        now.getTime() - checkpoint.lastIndexedAt.getTime(),
      );
      return Math.round(elapsedMs / 60_000);
    })
    .filter((value): value is number => value !== null);

  if (lagMinutes.length !== params.checkpoints.length) {
    return {
      freshness: 'unknown',
      indexLag: null,
      notes: ['At least one scoped mailbox has never finished indexing.'],
    };
  }

  const worstLagMinutes = Math.max(...lagMinutes);
  const backfillStates = new Set(
    params.checkpoints.map((checkpoint) => checkpoint.backfillState),
  );
  const notes: string[] = [];

  if (backfillStates.has(InboxBackfillState.PAUSED_AUTH_REVOKED)) {
    notes.push('At least one mailbox paused indexing because Gmail auth was revoked.');
    return {
      freshness: 'stale',
      indexLag: worstLagMinutes,
      notes,
    };
  }

  if (backfillStates.has(InboxBackfillState.PENDING)) {
    notes.push('At least one mailbox has not started inbox backfill yet.');
    return {
      freshness: 'stale',
      indexLag: worstLagMinutes,
      notes,
    };
  }

  if (
    worstLagMinutes <= FRESH_INDEX_LAG_MINUTES &&
    Array.from(backfillStates).every(
      (state) => state === InboxBackfillState.COMPLETE,
    )
  ) {
    return {
      freshness: 'fresh',
      indexLag: worstLagMinutes,
      notes,
    };
  }

  if (worstLagMinutes <= LAGGING_INDEX_LAG_MINUTES) {
    if (
      backfillStates.has(InboxBackfillState.SEEDING) ||
      backfillStates.has(InboxBackfillState.BACKFILLING)
    ) {
      notes.push('Backfill is still in progress for at least one mailbox.');
    }

    return {
      freshness: 'lagging',
      indexLag: worstLagMinutes,
      notes,
    };
  }

  notes.push('Inbox index lag exceeds the freshness threshold.');
  return {
    freshness: 'stale',
    indexLag: worstLagMinutes,
    notes,
  };
}

function buildAggregationBucketExpression(
  groupBy: InboxSearchGroupBy,
  timezone: string,
): Prisma.Sql {
  switch (groupBy) {
    case 'sender':
      return Prisma.sql`COALESCE(NULLIF(TRIM(d."from"), ''), '(unknown sender)')`;
    case 'day':
      return Prisma.sql`to_char(d."sentAt" AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`;
    case 'thread':
      return Prisma.sql`d."threadId"`;
    case 'mailbox':
      return Prisma.sql`m."emailAddress"`;
    default:
      return Prisma.sql`'(unknown)'`;
  }
}

async function fetchAggregateBuckets(params: {
  userId: string;
  scopedMailboxIds: string[];
  filters?: InboxSearchFilters;
  plan: Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive'>;
  groupBy: InboxSearchGroupBy;
  limit: number;
  timezone?: string;
}): Promise<InboxSearchAggregate[]> {
  return runInboxSearchTransaction(params.userId, async (tx) => {
    const whereClauses = buildInboxSearchWhereClauses({
      userId: params.userId,
      scopedMailboxIds: params.scopedMailboxIds,
      filters: params.filters,
      plan: params.plan,
    });
    const bucketExpression = buildAggregationBucketExpression(
      params.groupBy,
      params.timezone ?? 'UTC',
    );

    return tx.$queryRaw<InboxSearchAggregate[]>(Prisma.sql`
      SELECT
        ${bucketExpression} AS "key",
        COUNT(*)::integer AS "count"
      FROM "InboxSearchDocument" d
      INNER JOIN "Mailbox" m
        ON m."id" = d."mailboxId"
      WHERE ${buildWhereClause(whereClauses)}
      GROUP BY 1
      ORDER BY "count" DESC, "key" ASC
      LIMIT ${params.limit}
    `);
  });
}

async function fetchDocumentCount(params: {
  userId: string;
  scopedMailboxIds: string[];
  filters?: InboxSearchFilters;
  plan: Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive'>;
}): Promise<number> {
  return runInboxSearchTransaction(params.userId, async (tx) => {
    const whereClauses = buildInboxSearchWhereClauses({
      userId: params.userId,
      scopedMailboxIds: params.scopedMailboxIds,
      filters: params.filters,
      plan: params.plan,
    });

    const rows = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::integer AS "count"
      FROM "InboxSearchDocument" d
      INNER JOIN "Mailbox" m
        ON m."id" = d."mailboxId"
      WHERE ${buildWhereClause(whereClauses)}
    `);

    return rows[0]?.count ?? 0;
  });
}

function buildSearchSummary(params: {
  action: InboxSearchAction;
  lexicalQuery: string | null;
  semanticQueryText: string | null;
  filters?: InboxSearchFilters;
  mailboxEmails: string[];
  groupBy: InboxSearchGroupBy | null;
  sortBy: InboxSearchSortBy;
  filterOnly: boolean;
  timeWindowLabel: string;
}): string {
  const parts: string[] = [
    `action=${params.action}`,
    `local time window=${params.timeWindowLabel}`,
    `filterOnly=${params.filterOnly}`,
    `sortBy=${params.sortBy}`,
  ];

  if (params.lexicalQuery) {
    parts.push(`fts=${params.lexicalQuery}`);
  } else {
    parts.push('fts=filters-only');
  }

  if (params.semanticQueryText) {
    parts.push('semantic=query-embedded');
  }

  if (params.filters?.sender) {
    parts.push(`sender=${params.filters.sender}`);
  }
  if (params.filters?.recipient) {
    parts.push(`recipient=${params.filters.recipient}`);
  }
  if (params.filters?.subjectContains) {
    parts.push(`subjectContains=${params.filters.subjectContains}`);
  }
  if (params.filters?.bodyContains) {
    parts.push(`bodyContains=${params.filters.bodyContains}`);
  }
  if (typeof params.filters?.hasAttachment === 'boolean') {
    parts.push(`hasAttachment=${params.filters.hasAttachment}`);
  }
  if (params.filters?.threadId) {
    parts.push(`threadId=${params.filters.threadId}`);
  }
  if (params.filters?.messageId) {
    parts.push(`messageId=${params.filters.messageId}`);
  }
  if (params.groupBy) {
    parts.push(`groupBy=${params.groupBy}`);
  }

  parts.push(`mailboxes=${params.mailboxEmails.join(', ')}`);
  return parts.join(' | ');
}

function sortCandidates(
  candidates: InboxSearchCandidate[],
  sortBy: InboxSearchSortBy,
): InboxSearchCandidate[] {
  return [...candidates].sort((left, right) => {
    if (sortBy === 'newest') {
      return new Date(right.date).getTime() - new Date(left.date).getTime();
    }

    if (sortBy === 'oldest') {
      return new Date(left.date).getTime() - new Date(right.date).getTime();
    }

    if (right.totalScore !== left.totalScore) {
      return right.totalScore - left.totalScore;
    }

    return new Date(right.date).getTime() - new Date(left.date).getTime();
  });
}

const DEFAULT_INBOX_SEARCH_RUNTIME_DEPENDENCIES: InboxSearchRuntimeDependencies = {
  fetchLexicalCandidatesAndCheckpoints,
  fetchSemanticCandidates,
  fetchDocumentCount,
  fetchAggregateBuckets,
  embedInboxQueryText,
  now: () => new Date(),
  isVectorEnabled: () => getInboxRetrievalFeatureFlags().vectorEnabled,
};

export async function searchInboxDocuments(
  params: InboxSearchSearchRequest,
  dependencies: Partial<InboxSearchRuntimeDependencies> = {},
): Promise<InboxSearchSearchResult> {
  const runtime: InboxSearchRuntimeDependencies = {
    ...DEFAULT_INBOX_SEARCH_RUNTIME_DEPENDENCIES,
    ...dependencies,
  };
  const startedAt = runtime.now().getTime();
  const vectorEnabled = runtime.isVectorEnabled();
  const plan = buildInboxSearchPlan({
    action: params.action,
    queryText: params.queryText,
    filters: params.filters,
    options: params.options,
    mode: params.mode,
    profile: params.profile,
    maxCandidates: params.maxCandidates,
  });
  const scopedMailboxIds = params.mailboxes.map((mailbox) => mailbox.id);
  const scopedMailboxEmails = params.mailboxes.map((mailbox) => mailbox.emailAddress);
  const initialCoverage: InboxSearchCoverage = {
    action: params.action,
    queriesTried: [
      buildSearchSummary({
        action: plan.action,
        lexicalQuery: plan.lexicalQuery,
        semanticQueryText: plan.semanticQueryText,
        filters: params.filters,
        mailboxEmails: scopedMailboxEmails,
        groupBy: plan.groupBy,
        sortBy: plan.sortBy,
        filterOnly: plan.filterOnly,
        timeWindowLabel: plan.timeWindowLabel,
      }),
    ],
    threadsScanned: 0,
    messagesScanned: 0,
    timeWindow: plan.timeWindowLabel,
    pagesFetched: 0,
    truncated: false,
    filterOnly: plan.filterOnly,
    appliedFilters: plan.appliedFilters,
    budgetNotes: [...plan.notes],
    engineVersion: 'inbox-search-v2-hybrid',
    indexFreshness: 'unknown',
    retrievalLatencyMs: 0,
    lexicalCandidates: 0,
    semanticCandidates: 0,
    fusionMethod: 'rrf_k60',
    indexLag: null,
    semanticUnavailable: false,
  };

  logger.info('[InboxSearchSearch] retrieval stage start', {
    userId: params.userId,
    action: params.action,
    mode: params.mode,
    profile: params.profile,
    mailboxCount: scopedMailboxIds.length,
    mailboxScope: scopedMailboxEmails,
    filters: params.filters ?? {},
    queryTextPresent: Boolean(params.queryText),
    lexicalQueryPresent: Boolean(plan.lexicalQuery),
    semanticRequested: Boolean(plan.semanticQueryText),
    groupBy: plan.groupBy,
    sortBy: plan.sortBy,
    limit: plan.limit,
    filterOnly: plan.filterOnly,
    timeWindowLabel: plan.timeWindowLabel,
    vectorEnabled,
  });

  if (!plan.lexicalQuery && !hasStructuredFilterSignal(params.filters)) {
    return {
      action: params.action,
      candidates: [],
      coverage: {
        ...initialCoverage,
        retrievalLatencyMs: runtime.now().getTime() - startedAt,
      },
      count: params.action === 'count' ? 0 : undefined,
      aggregates: params.action === 'aggregate' ? [] : undefined,
      groupBy: plan.groupBy ?? undefined,
    };
  }

  if (isTimeLow(params.deadlineAt)) {
    return {
      action: params.action,
      candidates: [],
      coverage: {
        ...initialCoverage,
        truncated: true,
        retrievalLatencyMs: runtime.now().getTime() - startedAt,
        semanticUnavailable: true,
        fusionMethod: 'lexical-only',
        budgetNotes: [
          ...initialCoverage.budgetNotes,
          'Time budget low before local retrieval began.',
        ],
      },
      count: params.action === 'count' ? 0 : undefined,
      aggregates: params.action === 'aggregate' ? [] : undefined,
      groupBy: plan.groupBy ?? undefined,
    };
  }

  const freshnessPromise = runtime.fetchLexicalCandidatesAndCheckpoints({
    userId: params.userId,
    lexicalQuery: plan.lexicalQuery,
    scopedMailboxIds,
    filters: params.filters,
    plan,
    limit:
      params.action === 'find' || params.action === 'summarize_range'
        ? Math.max(plan.limit * 2, params.mode === 'deep' ? 80 : 40)
        : 1,
  });

  if (params.action === 'count' || params.action === 'aggregate') {
    const [{ checkpoints }, count, aggregates] = await Promise.all([
      freshnessPromise,
      runtime.fetchDocumentCount({
        userId: params.userId,
        scopedMailboxIds,
        filters: params.filters,
        plan,
      }),
      plan.groupBy
        ? runtime.fetchAggregateBuckets({
            userId: params.userId,
            scopedMailboxIds,
            filters: params.filters,
            plan,
            groupBy: plan.groupBy,
            limit: plan.limit,
            timezone: params.options?.timezone,
          })
        : Promise.resolve(undefined),
    ]);

    const freshness = classifyInboxIndexFreshness({
      checkpoints,
      scopedMailboxIds,
      now: runtime.now(),
    });
    const retrievalLatencyMs = runtime.now().getTime() - startedAt;

    logger.info('[InboxSearchSearch] aggregate stage complete', {
      userId: params.userId,
      action: params.action,
      count,
      aggregateBuckets: aggregates?.length ?? 0,
      groupBy: plan.groupBy,
      retrievalLatencyMs,
    });

    return {
      action: params.action,
      candidates: [],
      coverage: {
        ...initialCoverage,
        budgetNotes: [...initialCoverage.budgetNotes, ...freshness.notes],
        indexFreshness: freshness.freshness,
        retrievalLatencyMs,
        indexLag: freshness.indexLag,
        semanticUnavailable: true,
        fusionMethod: 'lexical-only',
      },
      count,
      aggregates,
      groupBy: plan.groupBy ?? undefined,
    };
  }

  const lexicalLimit = Math.max(
    plan.limit * 2,
    params.mode === 'deep' ? 80 : 40,
  );
  const semanticLimit = Math.max(
    plan.limit,
    params.mode === 'deep' ? plan.semanticCandidateLimit : Math.ceil(plan.semanticCandidateLimit / 2),
  );

  const lexicalPromise = freshnessPromise.then(({ rows, checkpoints }) => ({
    rows,
    checkpoints,
  }));
  const semanticQueryText = plan.semanticQueryText;

  const semanticQueryPromise =
    semanticQueryText && vectorEnabled && !isTimeLow(params.deadlineAt, 1_500)
      ? (async () => {
          const embeddingStartedAt = runtime.now().getTime();

          try {
            const embedding = await runtime.embedInboxQueryText({
              text: semanticQueryText,
            });
            const latencyMs = runtime.now().getTime() - embeddingStartedAt;
            logger.info('[InboxSearchSearch] query embedding complete', {
              userId: params.userId,
              mode: params.mode,
              latencyMs,
            });
            return {
              embedding,
              errorMessage: null,
            };
          } catch (error) {
            const latencyMs = runtime.now().getTime() - embeddingStartedAt;
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown query embedding error';

            logger.warn('[InboxSearchSearch] query embedding failed', {
              userId: params.userId,
              mode: params.mode,
              latencyMs,
              errorMessage,
            });

            return {
              embedding: null,
              errorMessage,
            };
          }
        })()
      : Promise.resolve<{ embedding: number[] | null; errorMessage: string | null }>({
          embedding: null,
          errorMessage: null,
        });

  const [{ rows: lexicalRows, checkpoints }, semanticQueryResult] =
    await Promise.all([lexicalPromise, semanticQueryPromise]);

  let semanticRows: InboxSearchSemanticRow[] = [];
  let semanticUnavailable = false;
  const budgetNotes = [...initialCoverage.budgetNotes];

  if (semanticQueryText && !vectorEnabled) {
    semanticUnavailable = true;
    budgetNotes.push('Semantic retrieval disabled by INBOX_VECTOR_ENABLED=false.');
  } else if (semanticQueryText && semanticQueryResult.embedding) {
    try {
      semanticRows = collapseSemanticRows(
        await runtime.fetchSemanticCandidates({
          userId: params.userId,
          queryEmbedding: semanticQueryResult.embedding,
          scopedMailboxIds,
          filters: params.filters,
          plan,
          limit: semanticLimit,
        }),
      );
    } catch (error) {
      semanticUnavailable = true;
      const message = error instanceof Error ? error.message : 'Unknown semantic retrieval error';
      budgetNotes.push(`Semantic retrieval failed; used lexical-only fallback (${message}).`);
      logger.warn('[InboxSearchSearch] semantic candidate retrieval failed', {
        userId: params.userId,
        mode: params.mode,
        errorMessage: message,
      });
    }
  } else if (semanticQueryText && !semanticQueryResult.embedding) {
    semanticUnavailable = true;
    budgetNotes.push(
      semanticQueryResult.errorMessage
        ? `Semantic retrieval failed; used lexical-only fallback (${semanticQueryResult.errorMessage}).`
        : 'Skipped semantic retrieval because query embedding was unavailable.',
    );
  } else {
    budgetNotes.push('Skipped semantic retrieval because the query lacked semantic signal.');
  }

  const freshness = classifyInboxIndexFreshness({
    checkpoints,
    scopedMailboxIds,
    now: runtime.now(),
  });

  const lexicalRankByDocumentId = new Map<string, number>();
  const lexicalByDocumentId = new Map<string, InboxSearchLexicalRow>();
  lexicalRows.forEach((row, index) => {
    lexicalRankByDocumentId.set(row.documentId, index + 1);
    lexicalByDocumentId.set(row.documentId, row);
  });

  const semanticRankByDocumentId = new Map<string, number>();
  const semanticByDocumentId = new Map<string, InboxSearchSemanticRow>();
  semanticRows.forEach((row, index) => {
    semanticRankByDocumentId.set(row.documentId, index + 1);
    semanticByDocumentId.set(row.documentId, row);
  });

  const documentIds = Array.from(
    new Set([
      ...lexicalRows.map((row) => row.documentId),
      ...semanticRows.map((row) => row.documentId),
    ]),
  );
  const rankingNow = runtime.now();
  let lowSimilaritySemanticDrops = 0;
  let weakSemanticOnlyDrops = 0;

  const candidates: InboxSearchCandidate[] = documentIds
    .map((documentId) => {
      const lexicalRow = lexicalByDocumentId.get(documentId);
      const semanticRow = semanticByDocumentId.get(documentId);
      const baseRow = lexicalRow ?? semanticRow;

      if (!baseRow) {
        return null;
      }

      const matchedTerms = collectInboxMatchedTerms(
        [
          baseRow.subject,
          semanticRow?.semanticChunkText ?? baseRow.bodyText,
          baseRow.from,
          ...(baseRow.to ?? []),
          ...(baseRow.cc ?? []),
        ],
        plan.matchTerms,
      );
      const exactSenderMatch = hasInboxExactSenderMatch(
        baseRow.from,
        plan.exactSenderTerms,
      );
      const exactSubjectMatch = hasInboxExactSubjectMatch(
        baseRow.subject,
        plan.exactSubjectTerms,
      );
      const lexicalRank = lexicalRankByDocumentId.get(documentId) ?? 0;
      const semanticRank = semanticRankByDocumentId.get(documentId) ?? null;
      const lexicalScore = lexicalRow ? roundInboxScore(lexicalRow.lexicalScore) : null;
      const semanticScore = semanticRow
        ? roundInboxScore(semanticRow.semanticScore)
        : null;
      const senderLooksPromotional = PROMOTIONAL_SENDER_REGEX.test(baseRow.from);
      const literalSenderMatches = countLiteralMatches(
        baseRow.from,
        plan.literalPriorityTerms,
      );
      const literalParticipantMatches = countLiteralMatches(
        [...(baseRow.to ?? []), ...(baseRow.cc ?? [])].join(' '),
        plan.literalPriorityTerms,
      );
      const literalSubjectMatches = countLiteralMatches(
        baseRow.subject,
        plan.literalPriorityTerms,
      );
      const literalBodyMatches = countLiteralMatches(
        [baseRow.snippet ?? '', semanticRow?.semanticChunkText ?? '', baseRow.bodyText]
          .filter(Boolean)
          .join(' '),
        plan.literalPriorityTerms,
      );
      const literalFieldHits =
        (literalSenderMatches > 0 ? 1 : 0) +
        (literalParticipantMatches > 0 ? 1 : 0) +
        (literalSubjectMatches > 0 ? 1 : 0) +
        (literalBodyMatches > 0 ? 1 : 0);
      const hasLiteralMatch = literalFieldHits > 0;
      const directCorrespondence = isLikelyDirectCorrespondence({
        baseRow,
        senderLooksPromotional,
      });

      if (
        plan.suppressSemanticOnlyWeakMatches &&
        lexicalRows.length >= 3 &&
        lexicalRank === 0 &&
        !hasLiteralMatch
      ) {
        weakSemanticOnlyDrops += 1;
        return null;
      }

      if (
        lexicalRank === 0 &&
        typeof semanticScore === 'number' &&
        semanticScore < plan.semanticSimilarityFloor
      ) {
        lowSimilaritySemanticDrops += 1;
        return null;
      }

      const recencyBoostRaw = calculateInboxRecencyBoost(baseRow.sentAt, rankingNow);
      const recencyBoost = roundInboxScore(
        recencyBoostRaw *
          (exactSenderMatch || exactSubjectMatch || literalFieldHits >= 2
            ? 0.15
            : lexicalRank > 0 || hasLiteralMatch
              ? 0.08
              : 0.02),
      );
      const exactSenderBoost = exactSenderMatch ? 2.5 : 0;
      const exactSubjectBoost = exactSubjectMatch ? 1.75 : 0;
      const literalBoost = roundInboxScore(
        literalSenderMatches * 1.5 +
          literalParticipantMatches * 0.8 +
          literalSubjectMatches * 1.2 +
          Math.min(literalBodyMatches, 2) * 0.35 +
          (literalFieldHits >= 2 ? 0.6 : 0),
      );
      const lexicalEvidenceBoost = lexicalScore
        ? roundInboxScore(Math.min(lexicalScore, 1.5) * 0.5)
        : 0;
      const semanticEvidenceBoost =
        semanticScore && (lexicalRank > 0 || hasLiteralMatch)
          ? roundInboxScore(Math.max(semanticScore - plan.semanticSimilarityFloor, 0) * 0.45)
          : 0;
      const directCorrespondenceBoost =
        directCorrespondence &&
        (hasLiteralMatch || lexicalRank > 0)
          ? 0.5
          : 0;
      const rrfScore = roundInboxScore(
        (lexicalRank ? reciprocalRank(lexicalRank) : 0) +
          (semanticRank ? reciprocalRank(semanticRank) : 0),
      );
      const weakSemanticOnlyPenalty =
        lexicalRank === 0
          ? !hasLiteralMatch
            ? plan.preferLiteralMatches
              ? 2.2
              : 0.8
            : plan.preferLiteralMatches
              ? 0.45
              : 0.15
          : 0;
      const promotionalPenalty =
        senderLooksPromotional &&
        !exactSenderMatch &&
        !exactSubjectMatch &&
        literalSenderMatches === 0 &&
        literalParticipantMatches === 0 &&
        literalSubjectMatches === 0 &&
        literalBodyMatches <= 1
          ? plan.preferLiteralMatches
            ? 1.0
            : 0.35
          : 0;
      const totalScore = roundInboxScore(
        rrfScore +
          recencyBoost +
          exactSenderBoost +
          exactSubjectBoost +
          literalBoost +
          lexicalEvidenceBoost +
          semanticEvidenceBoost +
          directCorrespondenceBoost -
          weakSemanticOnlyPenalty -
          promotionalPenalty,
      );

      return {
        documentId,
        threadId: baseRow.threadId,
        messageId: baseRow.messageId,
        mailboxId: baseRow.mailboxId,
        mailboxEmail: baseRow.mailboxEmail,
        date: baseRow.sentAt.toISOString(),
        from: baseRow.from,
        subject: baseRow.subject || '(no subject)',
        snippet: buildSnippet({
          headline: lexicalRow?.headline ?? null,
          from: baseRow.from,
          subject: baseRow.subject || '(no subject)',
          snippet: baseRow.snippet,
          bodyText: baseRow.bodyText,
          semanticChunkText: semanticRow?.semanticChunkText ?? null,
          matchedTerms,
          maxChars: params.snippetChars,
        }),
        matchedTerms,
        whyRelevant: buildInboxWhyRelevant({
          matchedTerms,
          exactSenderMatch,
          exactSubjectMatch,
          literalSenderMatch: literalSenderMatches > 0,
          literalParticipantMatch: literalParticipantMatches > 0,
          literalSubjectMatch: literalSubjectMatches > 0,
          literalBodyMatch: literalBodyMatches > 0,
          directCorrespondence,
          lexicalScore: lexicalScore ?? 0,
          semanticScore,
        }),
        lexicalRank,
        lexicalScore,
        semanticScore,
        semanticRank,
        rrfScore,
        recencyBoost,
        exactSenderBoost,
        exactSubjectBoost,
        totalScore,
        semanticUnavailable,
      };
    })
    .filter((candidate): candidate is InboxSearchCandidate => candidate !== null)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }

      return new Date(right.date).getTime() - new Date(left.date).getTime();
    })
    .slice(0, params.maxCandidates);

  if (lowSimilaritySemanticDrops > 0) {
    budgetNotes.push(
      `Dropped ${lowSimilaritySemanticDrops} low-similarity semantic candidate${lowSimilaritySemanticDrops === 1 ? '' : 's'} for the ${plan.queryIntent} query.`,
    );
  }
  if (weakSemanticOnlyDrops > 0) {
    budgetNotes.push(
      `Dropped ${weakSemanticOnlyDrops} weak semantic-only candidate${weakSemanticOnlyDrops === 1 ? '' : 's'} because the query needed stronger literal evidence.`,
    );
  }
  if (
    plan.preferLiteralMatches &&
    candidates.length > 0 &&
    candidates.slice(0, Math.min(3, candidates.length)).every((candidate) => candidate.exactSenderBoost === 0 && candidate.exactSubjectBoost === 0 && candidate.matchedTerms.length === 0)
  ) {
    budgetNotes.push(
      `Top results for the ${plan.queryIntent} query relied on weak literal evidence; confidence should stay conservative.`,
    );
  }

  const uniqueThreadIds = new Set(candidates.map((candidate) => candidate.threadId));
  const fusionMethod: InboxSearchCoverage['fusionMethod'] =
    semanticUnavailable || semanticRows.length === 0 ? 'lexical-only' : 'rrf_k60';
  const retrievalLatencyMs = runtime.now().getTime() - startedAt;

  logger.info('[InboxSearchSearch] retrieval stage complete', {
    userId: params.userId,
    action: params.action,
    mode: params.mode,
    lexicalCandidates: lexicalRows.length,
    semanticCandidates: semanticRows.length,
    fusionMethod,
    semanticUnavailable,
    retrievalLatencyMs,
  });

  return {
    action: params.action,
    candidates: sortCandidates(candidates, plan.sortBy).slice(0, plan.limit),
    coverage: {
      ...initialCoverage,
      threadsScanned: uniqueThreadIds.size,
      messagesScanned: lexicalRows.length,
      truncated:
        lexicalRows.length >= lexicalLimit ||
        semanticRows.length >= semanticLimit ||
        isTimeLow(params.deadlineAt, 1_500),
      budgetNotes: [...budgetNotes, ...freshness.notes],
      indexFreshness: freshness.freshness,
      retrievalLatencyMs,
      lexicalCandidates: lexicalRows.length,
      semanticCandidates: semanticRows.length,
      fusionMethod,
      indexLag: freshness.indexLag,
      semanticUnavailable,
    },
    groupBy: plan.groupBy ?? undefined,
  };
}
