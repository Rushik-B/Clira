import { z } from 'zod';
import type {
  InboxSearchAction,
  InboxSearchFilters,
  InboxSearchGroupBy,
  InboxSearchOptions,
  InboxSearchQueryMode,
  InboxSearchToolArgs,
} from '@/lib/services/inbox-search/types';

const inboxSearchActionValues = ['find', 'summarize_range', 'count', 'aggregate'] as const;
const inboxSearchModeValues = ['quick', 'deep'] as const;
const inboxSearchRelativeWindowValues = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'all_time',
] as const;
const inboxSearchSortValues = ['relevance', 'newest', 'oldest'] as const;
const inboxSearchGroupByValues = ['sender', 'day', 'thread', 'mailbox'] as const;

const MAX_KEYWORDS = 8;
const DEFAULT_LIMIT_BY_ACTION: Record<InboxSearchAction, number> = {
  find: 8,
  summarize_range: 12,
  count: 10,
  aggregate: 10,
};
const MAX_LIMIT_BY_ACTION: Record<InboxSearchAction, number> = {
  find: 24,
  summarize_range: 24,
  count: 50,
  aggregate: 50,
};

const isoDateLikeRegex =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const filtersSchema = z.object({
  sender: z.string().trim().min(1).optional(),
  recipient: z.string().trim().min(1).optional(),
  subjectContains: z.string().trim().min(1).optional(),
  bodyContains: z.string().trim().min(1).optional(),
  keywords: z.array(z.string().trim().min(1)).max(MAX_KEYWORDS).optional(),
  hasAttachment: z.boolean().optional(),
  startDate: z.string().trim().min(1).optional(),
  endDate: z.string().trim().min(1).optional(),
  relativeWindow: z.enum(inboxSearchRelativeWindowValues).optional(),
  threadId: z.string().trim().min(1).optional(),
  messageId: z.string().trim().min(1).optional(),
  includeDeleted: z.boolean().optional(),
});

const optionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  sortBy: z.enum(inboxSearchSortValues).optional(),
  includeQuotes: z.boolean().optional(),
  includeSnippets: z.boolean().optional(),
  semantic: z.boolean().optional(),
  groupBy: z.enum(inboxSearchGroupByValues).optional(),
  timezone: z.string().trim().min(1).optional(),
});

export const searchInboxContextArgsSchema = z.object({
  action: z.enum(inboxSearchActionValues),
  mode: z.enum(inboxSearchModeValues).optional(),
  mailboxId: z.string().trim().min(1).optional(),
  mailboxEmail: z.string().trim().email().optional(),
  queryText: z.string().trim().min(1).max(500).optional(),
  filters: filtersSchema.optional(),
  options: optionsSchema.optional(),
});

export const searchInboxContextProviderSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: [...inboxSearchActionValues],
      description: 'Retrieval mode: find matches, summarize a constrained range, count matches, or aggregate buckets.',
    },
    mode: {
      type: 'string',
      enum: [...inboxSearchModeValues],
      description: 'Use deep for broader retrieval or evidence compression. Default: quick.',
    },
    mailboxId: {
      type: 'string',
      description: 'Optional mailbox ID to search within one connected mailbox.',
    },
    mailboxEmail: {
      type: 'string',
      description: 'Optional mailbox email to search within one connected mailbox.',
    },
    queryText: {
      type: 'string',
      description: 'Optional free-text search term. Use only for actual text to search, not date or mailbox instructions.',
    },
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sender: { type: 'string' },
        recipient: { type: 'string' },
        subjectContains: { type: 'string' },
        bodyContains: { type: 'string' },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_KEYWORDS,
        },
        hasAttachment: { type: 'boolean' },
        startDate: { type: 'string', description: 'ISO date or datetime string.' },
        endDate: { type: 'string', description: 'ISO date or datetime string.' },
        relativeWindow: {
          type: 'string',
          enum: [...inboxSearchRelativeWindowValues],
        },
        threadId: { type: 'string' },
        messageId: { type: 'string' },
        includeDeleted: { type: 'boolean' },
      },
    },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        sortBy: {
          type: 'string',
          enum: [...inboxSearchSortValues],
        },
        includeQuotes: { type: 'boolean' },
        includeSnippets: { type: 'boolean' },
        semantic: { type: 'boolean' },
        groupBy: {
          type: 'string',
          enum: [...inboxSearchGroupByValues],
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone used to expand relative windows like today or last_7_days.',
        },
      },
    },
  },
  required: ['action'],
} as const;

type NormalizedSearchInboxContextArgs = InboxSearchToolArgs & {
  mode: InboxSearchQueryMode;
  filters: InboxSearchFilters;
  options: Required<Pick<InboxSearchOptions, 'limit' | 'sortBy' | 'includeQuotes' | 'includeSnippets' | 'semantic'>> &
    Pick<InboxSearchOptions, 'groupBy' | 'timezone'>;
};

function hasNarrowingConstraint(args: {
  filters: InboxSearchFilters;
  mailboxId?: string;
  mailboxEmail?: string;
}): boolean {
  return Boolean(
    args.mailboxId ||
      args.mailboxEmail ||
      args.filters.sender ||
      args.filters.recipient ||
      args.filters.subjectContains ||
      args.filters.bodyContains ||
      (args.filters.keywords?.length ?? 0) > 0 ||
      typeof args.filters.hasAttachment === 'boolean' ||
      args.filters.startDate ||
      args.filters.endDate ||
      args.filters.relativeWindow ||
      args.filters.threadId ||
      args.filters.messageId,
  );
}

function isIsoDateLike(value: string | undefined): boolean {
  return typeof value === 'string' && isoDateLikeRegex.test(value.trim());
}

function resolveDefaultSortBy(action: InboxSearchAction): 'relevance' | 'newest' | 'oldest' {
  switch (action) {
    case 'find':
      return 'relevance';
    case 'summarize_range':
      return 'newest';
    case 'count':
    case 'aggregate':
      return 'newest';
    default:
      return 'relevance';
  }
}

export function getSearchInboxContextLimitCap(action: InboxSearchAction): number {
  return MAX_LIMIT_BY_ACTION[action];
}

export function normalizeSearchInboxContextArgs(
  rawArgs: unknown,
  options?: { defaultTimezone?: string },
): NormalizedSearchInboxContextArgs {
  const parsed = searchInboxContextArgsSchema.parse(rawArgs);
  const action = parsed.action;
  const filters: InboxSearchFilters = {
    ...parsed.filters,
    keywords: parsed.filters?.keywords?.map((keyword) => keyword.trim()).filter(Boolean),
    includeDeleted: parsed.filters?.includeDeleted ?? false,
  };
  const requestedLimit = parsed.options?.limit ?? DEFAULT_LIMIT_BY_ACTION[action];
  const cappedLimit = Math.min(requestedLimit, MAX_LIMIT_BY_ACTION[action]);
  const normalized: NormalizedSearchInboxContextArgs = {
    action,
    mode: parsed.mode ?? 'quick',
    mailboxId: parsed.mailboxId,
    mailboxEmail: parsed.mailboxEmail,
    queryText: parsed.queryText?.trim(),
    filters,
    options: {
      limit: cappedLimit,
      sortBy: parsed.options?.sortBy ?? resolveDefaultSortBy(action),
      includeQuotes: parsed.options?.includeQuotes ?? true,
      includeSnippets: parsed.options?.includeSnippets ?? true,
      semantic: parsed.options?.semantic ?? Boolean(parsed.queryText?.trim()),
      groupBy: parsed.options?.groupBy,
      timezone: parsed.options?.timezone ?? options?.defaultTimezone,
    },
  };

  if (normalized.mailboxId && normalized.mailboxEmail) {
    throw new Error('Provide only one of mailboxId or mailboxEmail.');
  }

  if ((filters.startDate || filters.endDate) && filters.relativeWindow) {
    throw new Error('Use either relativeWindow or startDate/endDate, not both.');
  }

  if (filters.startDate && !isIsoDateLike(filters.startDate)) {
    throw new Error('filters.startDate must be an ISO date or datetime string.');
  }

  if (filters.endDate && !isIsoDateLike(filters.endDate)) {
    throw new Error('filters.endDate must be an ISO date or datetime string.');
  }

  if (normalized.options.semantic && !normalized.queryText) {
    throw new Error('options.semantic can only be true when queryText is provided.');
  }

  if (action === 'aggregate' && !normalized.options.groupBy) {
    throw new Error('aggregate requires options.groupBy.');
  }

  const narrowingConstraintPresent = hasNarrowingConstraint({
    filters,
    mailboxId: normalized.mailboxId,
    mailboxEmail: normalized.mailboxEmail,
  });

  if ((action === 'summarize_range' || action === 'count' || action === 'aggregate') && !narrowingConstraintPresent) {
    throw new Error(
      `${action} requires at least one narrowing filter such as a date range, relative window, sender, recipient, subjectContains, keywords, or mailbox scope.`,
    );
  }

  if (action === 'count' && normalized.options.groupBy && !narrowingConstraintPresent) {
    throw new Error('count with groupBy still requires at least one narrowing filter.');
  }

  return normalized;
}

export type SearchInboxContextNormalizedArgs = NormalizedSearchInboxContextArgs;
export type SearchInboxContextProviderSchema = typeof searchInboxContextProviderSchema;
export type SearchInboxContextGroupBy = InboxSearchGroupBy;
