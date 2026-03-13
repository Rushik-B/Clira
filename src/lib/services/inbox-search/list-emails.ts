import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { getMailboxesForUser } from '@/lib/services/mailbox/getMailboxesForUser';
import { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';
import type {
  InboxSearchRelativeWindow,
  InboxSearchScopedMailbox,
  ListInboxEmailItem,
  ListInboxEmailsFilters,
  ListInboxEmailsOptions,
  ListInboxEmailsResult,
  ListInboxEmailsToolArgs,
} from '@/lib/services/inbox-search/types';
import {
  addDaysToDateOnly,
  getDateOnlyInTimezone,
  normalizeIsoDateInputToUtc,
  startOfDayInTimezone,
} from '@/lib/utils/timezone';

type ListInboxEmailsRequest = ListInboxEmailsToolArgs & {
  filters: ListInboxEmailsFilters;
  options: Required<Pick<ListInboxEmailsOptions, 'limit' | 'sortBy' | 'includeBody'>> &
    Pick<ListInboxEmailsOptions, 'timezone'>;
};

type ListInboxEmailRow = {
  messageId: string;
  threadId: string;
  mailboxId: string;
  mailboxEmail: string;
  sentAt: Date;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string | null;
  hasAttachment: boolean;
  bodyText: string;
};

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
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

function resolveRelativeWindow(params: {
  relativeWindow?: InboxSearchRelativeWindow;
  timeZone?: string;
  now?: Date;
}): { startDate: Date | null; endDateExclusive: Date | null } {
  const relativeWindow = params.relativeWindow;
  if (!relativeWindow) {
    return {
      startDate: null,
      endDateExclusive: null,
    };
  }

  if (relativeWindow === 'all_time') {
    return {
      startDate: null,
      endDateExclusive: null,
    };
  }

  const timeZone = params.timeZone ?? 'UTC';
  const today = getDateOnlyInTimezone(params.now ?? new Date(), timeZone);

  switch (relativeWindow) {
    case 'today':
      return {
        startDate: startOfDayInTimezone(today, timeZone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timeZone),
      };
    case 'yesterday': {
      const yesterday = addDaysToDateOnly(today, -1);
      return {
        startDate: startOfDayInTimezone(yesterday, timeZone),
        endDateExclusive: startOfDayInTimezone(today, timeZone),
      };
    }
    case 'last_7_days':
      return {
        startDate: startOfDayInTimezone(addDaysToDateOnly(today, -6), timeZone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timeZone),
      };
    case 'last_30_days':
      return {
        startDate: startOfDayInTimezone(addDaysToDateOnly(today, -29), timeZone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timeZone),
      };
    case 'last_90_days':
      return {
        startDate: startOfDayInTimezone(addDaysToDateOnly(today, -89), timeZone),
        endDateExclusive: startOfDayInTimezone(addDaysToDateOnly(today, 1), timeZone),
      };
    default:
      return {
        startDate: null,
        endDateExclusive: null,
      };
  }
}

function resolveTimeWindow(params: {
  filters: ListInboxEmailsFilters;
  options: Pick<ListInboxEmailsOptions, 'timezone'>;
}): { startDate: Date | null; endDateExclusive: Date | null } {
  if (params.filters.startDate || params.filters.endDate) {
    return {
      startDate: params.filters.startDate
        ? normalizeIsoDateInputToUtc(
            params.filters.startDate,
            params.options.timezone ?? 'UTC',
            'start',
          )
        : null,
      endDateExclusive: params.filters.endDate
        ? new Date(
            normalizeIsoDateInputToUtc(
              params.filters.endDate,
              params.options.timezone ?? 'UTC',
              'end',
            ).getTime() + 1,
          )
        : null,
    };
  }

  return resolveRelativeWindow({
    relativeWindow: params.filters.relativeWindow,
    timeZone: params.options.timezone,
  });
}

function buildListInboxWhereClauses(params: {
  userId: string;
  scopedMailboxIds: string[];
  filters: ListInboxEmailsFilters;
  startDate: Date | null;
  endDateExclusive: Date | null;
}): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`d."userId" = ${params.userId}`,
    Prisma.sql`m."userId" = ${params.userId}`,
  ];

  if (!params.filters.includeDeleted) {
    clauses.push(Prisma.sql`d."isDeleted" = false`);
  }

  if (params.scopedMailboxIds.length > 0) {
    clauses.push(Prisma.sql`d."mailboxId" IN (${Prisma.join(params.scopedMailboxIds)})`);
  }

  const sender = params.filters.sender?.trim();
  if (sender) {
    const escaped = escapeLikePattern(sender.toLowerCase());
    clauses.push(Prisma.sql`LOWER(d."from") LIKE ${`%${escaped}%`}`);
  }

  const recipient = params.filters.recipient?.trim();
  if (recipient) {
    const escaped = escapeLikePattern(recipient.toLowerCase());
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM unnest(array_cat(d."to", d."cc")) AS recipient
        WHERE LOWER(recipient) LIKE ${`%${escaped}%`}
      )
    `);
  }

  const subjectContains = params.filters.subjectContains?.trim();
  if (subjectContains) {
    const escaped = escapeLikePattern(subjectContains.toLowerCase());
    clauses.push(Prisma.sql`LOWER(COALESCE(d."subject", '')) LIKE ${`%${escaped}%`}`);
  }

  if (typeof params.filters.hasAttachment === 'boolean') {
    clauses.push(Prisma.sql`d."hasAttachment" = ${params.filters.hasAttachment}`);
  }

  if (params.startDate) {
    clauses.push(Prisma.sql`d."sentAt" >= ${params.startDate}`);
  }

  if (params.endDateExclusive) {
    clauses.push(Prisma.sql`d."sentAt" < ${params.endDateExclusive}`);
  }

  if (params.filters.threadId) {
    clauses.push(Prisma.sql`d."threadId" = ${params.filters.threadId}`);
  }

  if (params.filters.messageId) {
    clauses.push(Prisma.sql`d."messageId" = ${params.filters.messageId}`);
  }

  return clauses;
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

function mapListInboxEmailItem(
  row: ListInboxEmailRow,
  includeBody: boolean,
): ListInboxEmailItem {
  return {
    messageId: row.messageId,
    threadId: row.threadId,
    mailboxId: row.mailboxId,
    mailboxEmail: row.mailboxEmail,
    sentAt: row.sentAt.toISOString(),
    from: row.from,
    to: row.to,
    cc: row.cc,
    subject: row.subject,
    snippet: row.snippet,
    hasAttachment: row.hasAttachment,
    ...(includeBody ? { bodyText: row.bodyText } : {}),
  };
}

export async function listInboxEmails(
  request: ListInboxEmailsRequest,
  dependencies: { userId: string },
): Promise<ListInboxEmailsResult> {
  const scopedMailboxes = await resolveMailboxScope({
    userId: dependencies.userId,
    mailboxId: request.mailboxId,
    mailboxEmail: request.mailboxEmail,
  });

  if (scopedMailboxes.length === 0) {
    return {
      items: [],
      matchedCount: 0,
      returnedCount: 0,
      truncated: false,
    };
  }

  const { startDate, endDateExclusive } = resolveTimeWindow({
    filters: request.filters,
    options: request.options,
  });
  const scopedMailboxIds = scopedMailboxes.map((mailbox) => mailbox.id);
  const whereClauses = buildListInboxWhereClauses({
    userId: dependencies.userId,
    scopedMailboxIds,
    filters: request.filters,
    startDate,
    endDateExclusive,
  });
  const sortDirection =
    request.options.sortBy === 'oldest' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

  const result = await runInboxSearchTransaction(dependencies.userId, async (tx) => {
    const countRows = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::integer AS "count"
      FROM "InboxSearchDocument" d
      INNER JOIN "Mailbox" m
        ON m."id" = d."mailboxId"
      WHERE ${buildWhereClause(whereClauses)}
    `);

    const rows = await tx.$queryRaw<ListInboxEmailRow[]>(Prisma.sql`
      SELECT
        d."messageId" AS "messageId",
        d."threadId" AS "threadId",
        d."mailboxId" AS "mailboxId",
        m."emailAddress" AS "mailboxEmail",
        d."sentAt" AS "sentAt",
        d."from" AS "from",
        d."to" AS "to",
        d."cc" AS "cc",
        d."subject" AS "subject",
        d."snippet" AS "snippet",
        d."hasAttachment" AS "hasAttachment",
        d."bodyText" AS "bodyText"
      FROM "InboxSearchDocument" d
      INNER JOIN "Mailbox" m
        ON m."id" = d."mailboxId"
      WHERE ${buildWhereClause(whereClauses)}
      ORDER BY d."sentAt" ${sortDirection}, d."messageId" ${sortDirection}
      LIMIT ${request.options.limit}
    `);

    return {
      matchedCount: countRows[0]?.count ?? 0,
      rows,
    };
  });

  const items = result.rows.map((row) => mapListInboxEmailItem(row, request.options.includeBody));
  const response = {
    items,
    matchedCount: result.matchedCount,
    returnedCount: items.length,
    truncated: result.matchedCount > items.length,
  };

  logger.info('[listInboxEmails] listed inbox emails deterministically', {
    userId: dependencies.userId,
    mailboxCount: scopedMailboxes.length,
    matchedCount: response.matchedCount,
    returnedCount: response.returnedCount,
    truncated: response.truncated,
    includeBody: request.options.includeBody,
    sortBy: request.options.sortBy,
  });

  return response;
}
