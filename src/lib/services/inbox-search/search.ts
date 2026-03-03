import { InboxBackfillState, Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { embedInboxQueryText, serializeVectorLiteral } from '@/lib/services/inbox-search/embeddings';
import { getInboxRetrievalFeatureFlags } from '@/lib/services/inbox-search/feature-flags';
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
  InboxSearchCandidate,
  InboxSearchCoverage,
  InboxSearchFreshness,
  InboxSearchQueryConstraints,
  InboxSearchRetrievalProfile,
  InboxSearchSearchRequest,
  InboxSearchSearchResult,
} from '@/lib/services/inbox-search/types';

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

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const QUOTED_PHRASE_REGEX = /"([^"]+)"/g;
const EARLY_EXIT_BUFFER_MS = 3_000;
const FRESH_INDEX_LAG_MINUTES = 10;
const LAGGING_INDEX_LAG_MINUTES = 120;
const RRF_K = 60;

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

type InboxSearchPlan = {
  lexicalQuery: string | null;
  semanticQueryText: string | null;
  matchTerms: string[];
  exactSenderTerms: string[];
  exactSubjectTerms: string[];
  timeWindowLabel: string;
  notes: string[];
  startDate: Date | null;
  endDateExclusive: Date | null;
  allowsFilterOnlySearch: boolean;
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

function extractQuotedPhrases(text: string): string[] {
  const phrases: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = QUOTED_PHRASE_REGEX.exec(text)) !== null) {
    const phrase = match[1]?.trim();
    if (phrase) {
      phrases.push(phrase);
    }
    if (phrases.length >= 4) {
      break;
    }
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

  return Array.from(new Set(tokens)).slice(0, limit);
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

function resolveTimeWindow(params: {
  constraints?: InboxSearchQueryConstraints;
  mode: InboxSearchSearchRequest['mode'];
  profile: InboxSearchRetrievalProfile;
  now?: Date;
}): Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive' | 'timeWindowLabel'> {
  const now = params.now ?? new Date();
  const explicitStartDate = parseDateInput(params.constraints?.startDate);
  const explicitEndDate = parseDateInput(params.constraints?.endDate);
  const explicitEndDateExclusive =
    params.constraints?.endDate && explicitEndDate.date
      ? explicitEndDate.isDateOnly
        ? addDays(explicitEndDate.date, 1)
        : explicitEndDate.date
      : null;

  if (explicitStartDate.date || explicitEndDateExclusive) {
    return {
      startDate: explicitStartDate.date,
      endDateExclusive: explicitEndDateExclusive,
      timeWindowLabel: `${params.constraints?.startDate ?? '...'} to ${params.constraints?.endDate ?? '...'}`,
    };
  }

  switch (params.constraints?.timeWindow) {
    case 'recent':
    case 'last_month':
      return {
        startDate: addDays(now, -30),
        endDateExclusive: null,
        timeWindowLabel: 'last 30 days',
      };
    case 'last_year':
      return {
        startDate: addDays(now, -365),
        endDateExclusive: null,
        timeWindowLabel: 'last 365 days',
      };
    case 'all_time':
      return {
        startDate: null,
        endDateExclusive: null,
        timeWindowLabel: 'all time',
      };
    default:
      break;
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
  intent: string;
  subjectHint: string;
  senderHint: string;
  recipientHint: string;
  constraintKeywords: string[];
  allowsFilterOnlySearch: boolean;
}): string | null {
  if (params.allowsFilterOnlySearch && params.constraintKeywords.length === 0) {
    return null;
  }

  const parts = [
    params.intent.trim(),
    params.subjectHint ? `Subject: ${params.subjectHint}` : '',
    params.senderHint ? `Sender: ${params.senderHint}` : '',
    params.recipientHint ? `Recipient: ${params.recipientHint}` : '',
    params.constraintKeywords.length > 0
      ? `Keywords: ${params.constraintKeywords.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  return parts.length >= 3 ? parts : null;
}

export function buildInboxSearchPlan(params: {
  intent: string;
  constraints?: InboxSearchQueryConstraints;
  mode: InboxSearchSearchRequest['mode'];
  profile: InboxSearchRetrievalProfile;
  now?: Date;
}): InboxSearchPlan {
  const notes: string[] = [];
  const quotedPhrases = extractQuotedPhrases(params.intent);
  const intentEmails = extractEmails(params.intent);
  const intentKeywords = extractKeywords(params.intent);
  const constraintKeywords = (params.constraints?.keywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 6);
  const subjectHint = params.constraints?.subject?.trim() ?? '';
  const senderHint = params.constraints?.sender?.trim() ?? '';
  const recipientHint = params.constraints?.recipient?.trim() ?? '';

  const lexicalTerms = Array.from(
    new Set([
      ...quotedPhrases,
      ...constraintKeywords,
      ...intentKeywords,
      ...(subjectHint ? [subjectHint] : []),
    ]),
  );

  const matchTerms = Array.from(
    new Set([
      ...quotedPhrases,
      ...constraintKeywords,
      ...intentKeywords,
      ...(subjectHint ? [subjectHint] : []),
      ...(senderHint ? [senderHint] : []),
      ...(recipientHint ? [recipientHint] : []),
      ...intentEmails,
    ]),
  );

  const exactSenderTerms = Array.from(
    new Set([...(senderHint ? [senderHint] : []), ...intentEmails]),
  );
  const exactSubjectTerms = Array.from(
    new Set([...(subjectHint ? [subjectHint] : []), ...quotedPhrases]),
  );

  const timeWindow = resolveTimeWindow({
    constraints: params.constraints,
    mode: params.mode,
    profile: params.profile,
    now: params.now,
  });

  const allowsFilterOnlySearch = Boolean(
    senderHint ||
      recipientHint ||
      subjectHint ||
      params.constraints?.startDate ||
      params.constraints?.endDate ||
      params.constraints?.timeWindow ||
      params.constraints?.hasAttachment,
  );

  const lexicalQuery = buildLexicalQuery(lexicalTerms);
  if (!lexicalQuery && !allowsFilterOnlySearch) {
    notes.push('No search terms or narrowing constraints were derived from the request.');
  }

  if (!lexicalQuery && allowsFilterOnlySearch) {
    notes.push(
      'Running a local filter-only search because no lexical query terms were available.',
    );
  }

  return {
    lexicalQuery,
    semanticQueryText: buildSemanticQueryText({
      intent: params.intent,
      subjectHint,
      senderHint,
      recipientHint,
      constraintKeywords,
      allowsFilterOnlySearch,
    }),
    matchTerms,
    exactSenderTerms,
    exactSubjectTerms,
    timeWindowLabel: timeWindow.timeWindowLabel,
    notes,
    startDate: timeWindow.startDate,
    endDateExclusive: timeWindow.endDateExclusive,
    allowsFilterOnlySearch,
  };
}

function buildSnippet(params: {
  headline: string | null;
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

  const source = (
    params.semanticChunkText ??
    params.snippet ??
    params.bodyText ??
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();

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
  constraints?: InboxSearchQueryConstraints;
  plan: Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive'>;
}): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`d."isDeleted" = false`,
    Prisma.sql`d."userId" = ${params.userId}`,
    Prisma.sql`m."userId" = ${params.userId}`,
  ];

  if (params.scopedMailboxIds.length > 0) {
    clauses.push(Prisma.sql`d."mailboxId" IN (${Prisma.join(params.scopedMailboxIds)})`);
  }

  const senderFilter = params.constraints?.sender?.trim();
  if (senderFilter) {
    const escaped = escapeLikePattern(senderFilter.toLowerCase());
    clauses.push(
      Prisma.sql`LOWER(d."from") LIKE ${`%${escaped}%`}`,
    );
  }

  const recipientFilter = params.constraints?.recipient?.trim();
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

  if (params.constraints?.hasAttachment === true) {
    clauses.push(Prisma.sql`d."hasAttachment" = true`);
  }

  if (params.plan.startDate) {
    clauses.push(Prisma.sql`d."sentAt" >= ${params.plan.startDate}`);
  }

  if (params.plan.endDateExclusive) {
    clauses.push(Prisma.sql`d."sentAt" < ${params.plan.endDateExclusive}`);
  }

  return clauses;
}

async function fetchLexicalCandidatesAndCheckpoints(params: {
  userId: string;
  lexicalQuery: string | null;
  scopedMailboxIds: string[];
  constraints?: InboxSearchQueryConstraints;
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
      constraints: params.constraints,
      plan: params.plan,
    });

    const lexicalVector = Prisma.sql`
      to_tsvector('english', COALESCE(d."subject", '') || ' ' || COALESCE(d."bodyText", ''))
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
                COALESCE(d."bodyText", ''),
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
  constraints?: InboxSearchQueryConstraints;
  plan: Pick<InboxSearchPlan, 'startDate' | 'endDateExclusive'>;
  limit: number;
}): Promise<InboxSearchSemanticRow[]> {
  return runInboxSearchTransaction(params.userId, async (tx) => {
    const whereClauses = buildInboxSearchWhereClauses({
      userId: params.userId,
      scopedMailboxIds: params.scopedMailboxIds,
      constraints: params.constraints,
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

function buildSearchSummary(params: {
  lexicalQuery: string | null;
  semanticQueryText: string | null;
  constraints?: InboxSearchQueryConstraints;
  mailboxEmails: string[];
  timeWindowLabel: string;
}): string {
  const parts: string[] = [`local time window=${params.timeWindowLabel}`];

  if (params.lexicalQuery) {
    parts.push(`fts=${params.lexicalQuery}`);
  } else {
    parts.push('fts=filters-only');
  }

  if (params.semanticQueryText) {
    parts.push('semantic=query-embedded');
  }

  if (params.constraints?.sender) {
    parts.push(`sender=${params.constraints.sender}`);
  }
  if (params.constraints?.recipient) {
    parts.push(`recipient=${params.constraints.recipient}`);
  }
  if (params.constraints?.subject) {
    parts.push(`subject=${params.constraints.subject}`);
  }
  if (params.constraints?.hasAttachment) {
    parts.push('hasAttachment=true');
  }

  parts.push(`mailboxes=${params.mailboxEmails.join(', ')}`);
  return parts.join(' | ');
}

const DEFAULT_INBOX_SEARCH_RUNTIME_DEPENDENCIES: InboxSearchRuntimeDependencies = {
  fetchLexicalCandidatesAndCheckpoints,
  fetchSemanticCandidates,
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
    intent: params.intent,
    constraints: params.constraints,
    mode: params.mode,
    profile: params.profile,
  });
  const scopedMailboxIds = params.mailboxes.map((mailbox) => mailbox.id);
  const scopedMailboxEmails = params.mailboxes.map((mailbox) => mailbox.emailAddress);
  const initialCoverage: InboxSearchCoverage = {
    queriesTried: [
      buildSearchSummary({
        lexicalQuery: plan.lexicalQuery,
        semanticQueryText: plan.semanticQueryText,
        constraints: params.constraints,
        mailboxEmails: scopedMailboxEmails,
        timeWindowLabel: plan.timeWindowLabel,
      }),
    ],
    threadsScanned: 0,
    messagesScanned: 0,
    timeWindow: plan.timeWindowLabel,
    pagesFetched: 0,
    truncated: false,
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
    mode: params.mode,
    profile: params.profile,
    mailboxCount: scopedMailboxIds.length,
    lexicalQueryPresent: Boolean(plan.lexicalQuery),
    semanticRequested: Boolean(plan.semanticQueryText),
    vectorEnabled,
  });

  if (!plan.lexicalQuery && !plan.allowsFilterOnlySearch) {
    return {
      candidates: [],
      coverage: {
        ...initialCoverage,
        retrievalLatencyMs: runtime.now().getTime() - startedAt,
      },
    };
  }

  if (isTimeLow(params.deadlineAt)) {
    return {
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
    };
  }

  const lexicalLimit = Math.max(
    params.maxCandidates * 2,
    params.mode === 'deep' ? 80 : 40,
  );
  const semanticLimit = Math.max(
    params.maxCandidates * 2,
    params.mode === 'deep' ? 80 : 40,
  );

  const lexicalPromise = runtime.fetchLexicalCandidatesAndCheckpoints({
    userId: params.userId,
    lexicalQuery: plan.lexicalQuery,
    scopedMailboxIds,
    constraints: params.constraints,
    plan,
    limit: lexicalLimit,
  });
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
          constraints: params.constraints,
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
      const recencyBoost = calculateInboxRecencyBoost(baseRow.sentAt, rankingNow);
      const exactSenderBoost = exactSenderMatch ? 3 : 0;
      const exactSubjectBoost = exactSubjectMatch ? 2 : 0;
      const lexicalRank = lexicalRankByDocumentId.get(documentId) ?? 0;
      const semanticRank = semanticRankByDocumentId.get(documentId) ?? null;
      const lexicalScore = lexicalRow ? roundInboxScore(lexicalRow.lexicalScore) : null;
      const semanticScore = semanticRow
        ? roundInboxScore(semanticRow.semanticScore)
        : null;
      const rrfScore = roundInboxScore(
        (lexicalRank ? reciprocalRank(lexicalRank) : 0) +
          (semanticRank ? reciprocalRank(semanticRank) : 0),
      );
      const totalScore = roundInboxScore(
        rrfScore + recencyBoost + exactSenderBoost + exactSubjectBoost,
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
          lexicalScore: lexicalScore ?? 0,
          semanticScore,
        }),
        lexicalRank,
        lexicalScore,
        semanticScore,
        semanticRank,
        rrfScore,
        recencyBoost: roundInboxScore(recencyBoost),
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

  const uniqueThreadIds = new Set(candidates.map((candidate) => candidate.threadId));
  const fusionMethod: InboxSearchCoverage['fusionMethod'] =
    semanticUnavailable || semanticRows.length === 0 ? 'lexical-only' : 'rrf_k60';
  const retrievalLatencyMs = runtime.now().getTime() - startedAt;

  logger.info('[InboxSearchSearch] retrieval stage complete', {
    userId: params.userId,
    mode: params.mode,
    lexicalCandidates: lexicalRows.length,
    semanticCandidates: semanticRows.length,
    fusionMethod,
    semanticUnavailable,
    retrievalLatencyMs,
  });

  return {
    candidates,
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
  };
}
