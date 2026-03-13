import { z } from 'zod';
import type {
  ListInboxEmailsFilters,
  ListInboxEmailsOptions,
  ListInboxEmailsToolArgs,
} from '@/lib/services/inbox-search/types';

const inboxSearchRelativeWindowValues = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'all_time',
] as const;
const listInboxEmailsSortValues = ['newest', 'oldest'] as const;

const DEFAULT_LIST_INBOX_EMAILS_LIMIT = 20;
const MAX_LIST_INBOX_EMAILS_LIMIT = 50;
const MAX_LIST_INBOX_EMAILS_WITH_BODY_LIMIT = 20;

const isoDateLikeRegex =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const filtersSchema = z.object({
  sender: z.string().trim().min(1).optional(),
  recipient: z.string().trim().min(1).optional(),
  subjectContains: z.string().trim().min(1).optional(),
  startDate: z.string().trim().min(1).optional(),
  endDate: z.string().trim().min(1).optional(),
  relativeWindow: z.enum(inboxSearchRelativeWindowValues).optional(),
  threadId: z.string().trim().min(1).optional(),
  messageId: z.string().trim().min(1).optional(),
  hasAttachment: z.boolean().optional(),
  includeDeleted: z.boolean().optional(),
});

const optionsSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIST_INBOX_EMAILS_LIMIT).optional(),
  sortBy: z.enum(listInboxEmailsSortValues).optional(),
  includeBody: z.boolean().optional(),
});

export const listInboxEmailsArgsSchema = z.object({
  mailboxId: z.string().trim().min(1).optional(),
  mailboxEmail: z.string().trim().email().optional(),
  filters: filtersSchema.optional(),
  options: optionsSchema.optional(),
});

export const listInboxEmailsProviderSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mailboxId: {
      type: 'string',
      description: 'Optional mailbox ID to list from one connected mailbox.',
    },
    mailboxEmail: {
      type: 'string',
      description: 'Optional mailbox email to list from one connected mailbox.',
    },
    filters: {
      type: 'object',
      description:
        'Exact narrowing only. Use this tool when you need the complete filtered set, not ranked search.',
      additionalProperties: false,
      properties: {
        sender: { type: 'string' },
        recipient: { type: 'string' },
        subjectContains: { type: 'string' },
        startDate: { type: 'string', description: 'ISO date or datetime string.' },
        endDate: { type: 'string', description: 'ISO date or datetime string.' },
        relativeWindow: {
          type: 'string',
          enum: [...inboxSearchRelativeWindowValues],
        },
        threadId: { type: 'string' },
        messageId: { type: 'string' },
        hasAttachment: { type: 'boolean' },
        includeDeleted: { type: 'boolean' },
      },
    },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIST_INBOX_EMAILS_LIMIT,
        },
        sortBy: {
          type: 'string',
          enum: [...listInboxEmailsSortValues],
        },
        includeBody: {
          type: 'boolean',
        },
      },
    },
  },
} as const;

type NormalizedListInboxEmailsArgs = ListInboxEmailsToolArgs & {
  filters: ListInboxEmailsFilters;
  options: Required<Pick<ListInboxEmailsOptions, 'limit' | 'sortBy' | 'includeBody'>> &
    Pick<ListInboxEmailsOptions, 'timezone'>;
};

function isIsoDateLike(value: string | undefined): boolean {
  return typeof value === 'string' && isoDateLikeRegex.test(value.trim());
}

function hasIdentityConstraint(filters: ListInboxEmailsFilters): boolean {
  return Boolean(filters.sender || filters.recipient || filters.subjectContains);
}

function hasScopeConstraint(args: {
  filters: ListInboxEmailsFilters;
  mailboxId?: string;
  mailboxEmail?: string;
}): boolean {
  return Boolean(
    args.mailboxId ||
      args.mailboxEmail ||
      args.filters.startDate ||
      args.filters.endDate ||
      args.filters.relativeWindow,
  );
}

export function normalizeListInboxEmailsArgs(
  rawArgs: unknown,
  options?: { defaultTimezone?: string },
): NormalizedListInboxEmailsArgs {
  const parsed = listInboxEmailsArgsSchema.parse(rawArgs);
  const filters: ListInboxEmailsFilters = {
    ...parsed.filters,
    includeDeleted: parsed.filters?.includeDeleted ?? false,
  };
  const includeBody = parsed.options?.includeBody ?? false;
  const requestedLimit = parsed.options?.limit ?? DEFAULT_LIST_INBOX_EMAILS_LIMIT;
  const maxLimit = includeBody
    ? MAX_LIST_INBOX_EMAILS_WITH_BODY_LIMIT
    : MAX_LIST_INBOX_EMAILS_LIMIT;

  const normalized: NormalizedListInboxEmailsArgs = {
    mailboxId: parsed.mailboxId,
    mailboxEmail: parsed.mailboxEmail,
    filters,
    options: {
      limit: Math.min(requestedLimit, maxLimit),
      sortBy: parsed.options?.sortBy ?? 'newest',
      includeBody,
      timezone: options?.defaultTimezone,
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

  const hasExactMessageConstraint = Boolean(filters.threadId || filters.messageId);
  if (!hasExactMessageConstraint && (!hasIdentityConstraint(filters) || !hasScopeConstraint(normalized))) {
    throw new Error(
      'list_inbox_emails requires threadId or messageId, or at least one identity/content constraint (sender, recipient, or subjectContains) plus one scope constraint (mailbox scope or date range).',
    );
  }

  return normalized;
}

export type ListInboxEmailsNormalizedArgs = NormalizedListInboxEmailsArgs;
