import { Prisma } from '@prisma/client';
import { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';
import type {
  InboxThreadSliceMessage,
  InboxThreadSliceResult,
} from '@/lib/services/inbox-search/types';

type InboxThreadRow = {
  threadId: string;
  mailboxId: string;
  mailboxEmail: string;
  messageId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  sentAt: Date;
};

function truncateBodyText(bodyText: string, maxChars: number): {
  bodyText: string;
  truncatedBody: boolean;
} {
  if (bodyText.length <= maxChars) {
    return {
      bodyText,
      truncatedBody: false,
    };
  }

  return {
    bodyText: bodyText.slice(0, Math.max(0, maxChars)),
    truncatedBody: true,
  };
}

function buildSelectionOrder(totalMessages: number, anchorIndex: number, maxMessages: number): number[] {
  const selected = [anchorIndex];
  let distance = 1;

  while (selected.length < maxMessages) {
    let added = false;
    const beforeIndex = anchorIndex - distance;
    const afterIndex = anchorIndex + distance;

    if (beforeIndex >= 0) {
      selected.push(beforeIndex);
      added = true;
      if (selected.length >= maxMessages) {
        break;
      }
    }

    if (afterIndex < totalMessages) {
      selected.push(afterIndex);
      added = true;
      if (selected.length >= maxMessages) {
        break;
      }
    }

    if (!added) {
      break;
    }

    distance += 1;
  }

  return selected;
}

function buildSelectedMessages(params: {
  rows: InboxThreadRow[];
  anchorIndex: number;
  maxMessages: number;
  maxBodyCharsPerMessage: number;
  maxTotalBodyChars: number;
}): {
  messages: InboxThreadSliceMessage[];
  bodyCharsUsed: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
} {
  const orderedIndexes = buildSelectionOrder(
    params.rows.length,
    params.anchorIndex,
    params.maxMessages,
  );
  const selectedByIndex = new Map<number, InboxThreadSliceMessage>();
  let remainingChars = Math.max(0, params.maxTotalBodyChars);
  let bodyCharsUsed = 0;

  for (const index of orderedIndexes) {
    if (remainingChars <= 0) {
      break;
    }

    const row = params.rows[index];
    if (!row) {
      continue;
    }

    const maxCharsForMessage = Math.min(params.maxBodyCharsPerMessage, remainingChars);
    const truncated = truncateBodyText(row.bodyText ?? '', maxCharsForMessage);
    bodyCharsUsed += truncated.bodyText.length;
    remainingChars -= truncated.bodyText.length;

    selectedByIndex.set(index, {
      messageId: row.messageId,
      date: row.sentAt.toISOString(),
      from: row.from,
      to: row.to ?? [],
      cc: row.cc ?? [],
      subject: row.subject || '(no subject)',
      bodyText: truncated.bodyText,
      isAnchor: index === params.anchorIndex,
      truncatedBody: truncated.truncatedBody,
    });
  }

  const selectedIndexes = Array.from(selectedByIndex.keys()).sort((left, right) => left - right);
  if (selectedIndexes.length === 0) {
    return {
      messages: [],
      bodyCharsUsed: 0,
      hasMoreBefore: params.anchorIndex > 0,
      hasMoreAfter: params.anchorIndex < params.rows.length - 1,
    };
  }

  const earliestIndex = selectedIndexes[0]!;
  const latestIndex = selectedIndexes[selectedIndexes.length - 1]!;

  return {
    messages: selectedIndexes
      .map((index) => selectedByIndex.get(index))
      .filter((message): message is InboxThreadSliceMessage => Boolean(message)),
    bodyCharsUsed,
    hasMoreBefore: earliestIndex > 0,
    hasMoreAfter: latestIndex < params.rows.length - 1,
  };
}

export async function fetchInboxThreadSlice(params: {
  userId: string;
  mailboxId: string;
  threadId: string;
  anchorMessageId: string;
  maxMessages: number;
  maxBodyCharsPerMessage: number;
  maxTotalBodyChars: number;
}): Promise<InboxThreadSliceResult | null> {
  if (params.maxMessages <= 0 || params.maxBodyCharsPerMessage <= 0 || params.maxTotalBodyChars <= 0) {
    return null;
  }

  const rows = await runInboxSearchTransaction(params.userId, async (tx) =>
    tx.$queryRaw<InboxThreadRow[]>(Prisma.sql`
      SELECT
        d."threadId" AS "threadId",
        d."mailboxId" AS "mailboxId",
        m."emailAddress" AS "mailboxEmail",
        d."messageId" AS "messageId",
        d."from" AS "from",
        d."to" AS "to",
        d."cc" AS "cc",
        d."subject" AS "subject",
        d."bodyText" AS "bodyText",
        d."sentAt" AS "sentAt"
      FROM "InboxSearchDocument" d
      INNER JOIN "Mailbox" m
        ON m."id" = d."mailboxId"
      WHERE d."mailboxId" = ${params.mailboxId}
        AND d."threadId" = ${params.threadId}
        AND d."isDeleted" = false
      ORDER BY d."sentAt" ASC, d."messageId" ASC
    `),
  );

  if (rows.length === 0) {
    return null;
  }

  const anchorIndex = rows.findIndex((row) => row.messageId === params.anchorMessageId);
  if (anchorIndex < 0) {
    return null;
  }

  const selected = buildSelectedMessages({
    rows,
    anchorIndex,
    maxMessages: params.maxMessages,
    maxBodyCharsPerMessage: params.maxBodyCharsPerMessage,
    maxTotalBodyChars: params.maxTotalBodyChars,
  });

  return {
    threadId: params.threadId,
    mailboxId: params.mailboxId,
    mailboxEmail: rows[anchorIndex]?.mailboxEmail ?? '',
    anchorMessageId: params.anchorMessageId,
    hasMoreBefore: selected.hasMoreBefore,
    hasMoreAfter: selected.hasMoreAfter,
    messagesReturned: selected.messages.length,
    bodyCharsUsed: selected.bodyCharsUsed,
    messages: selected.messages,
  };
}
