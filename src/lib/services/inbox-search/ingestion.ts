import type { EmailData } from '@/lib/email/gmail';
import { indexInboxSearchEmail } from '@/lib/services/inbox-search/indexer';
import { touchInboxSearchRealtimeCheckpoint } from '@/lib/services/inbox-search/checkpoint';
import type { InboxSearchIndexInput, InboxSearchIndexResult } from '@/lib/services/inbox-search/types';
import { prisma } from '@/lib/prisma';

export type InboxSearchStoredEmailIndexResult =
  | InboxSearchIndexResult
  | {
      status: 'skipped_missing';
      documentId: null;
      chunkCount: 0;
      contentHash: null;
    };

export function buildInboxSearchInputFromParsedEmail(params: {
  userId: string;
  mailboxId: string;
  threadId: string;
  email: Pick<
    EmailData,
    'messageId' | 'from' | 'to' | 'cc' | 'subject' | 'snippet' | 'body' | 'date' | 'hasAttachments'
  >;
}): InboxSearchIndexInput {
  const { userId, mailboxId, threadId, email } = params;

  return {
    userId,
    mailboxId,
    threadId,
    messageId: email.messageId,
    from: email.from,
    to: email.to,
    cc: email.cc ?? [],
    subject: email.subject,
    snippet: email.snippet ?? null,
    body: email.body,
    sentAt: new Date(email.date),
    hasAttachment: email.hasAttachments,
  };
}

export async function indexStoredInboxEmail(params: {
  userId: string;
  mailboxId: string;
  messageId: string;
}): Promise<InboxSearchStoredEmailIndexResult> {
  const { userId, mailboxId, messageId } = params;

  // Email table does not have RLS; ownership is verified in application code below.
  const emailRecord = await prisma.email.findUnique({
    where: {
      mailboxId_messageId: {
        mailboxId,
        messageId,
      },
    },
    include: {
      thread: {
        select: {
          id: true,
          userId: true,
        },
      },
      mailbox: {
        select: {
          gmailHistoryId: true,
        },
      },
    },
  });

  if (!emailRecord) {
    return {
      status: 'skipped_missing',
      documentId: null,
      chunkCount: 0,
      contentHash: null,
    };
  }

  if (emailRecord.thread.userId !== userId) {
    throw new Error(
      `Email ${messageId} in mailbox ${mailboxId} does not belong to user ${userId}`,
    );
  }

  // Email.createdAt is set from emailData.date (the actual Gmail send date) at
  // creation time in gmailPushService, so it reflects the real send timestamp —
  // not the DB insertion time. This is the best date available on the Email model
  // since it lacks a dedicated sentAt column.
  const result = await indexInboxSearchEmail({
    userId,
    mailboxId,
    threadId: emailRecord.gmailThreadId || emailRecord.threadId,
    messageId: emailRecord.messageId,
    from: emailRecord.from,
    to: emailRecord.to,
    cc: emailRecord.cc ?? [],
    subject: emailRecord.subject,
    snippet: emailRecord.snippet ?? null,
    body: emailRecord.body,
    sentAt: emailRecord.createdAt,
    // TODO: Email model does not store attachment metadata. The backfill path
    // derives hasAttachment from EmailData.hasAttachments (Gmail payload), but
    // the real-time path cannot detect attachments from the stored record alone.
    // A future migration should add a hasAttachments column to the Email model.
    hasAttachment: false,
  });

  await touchInboxSearchRealtimeCheckpoint({
    userId,
    mailboxId,
    lastIndexedAt: new Date(),
    lastHistoryIdIndexed: emailRecord.mailbox?.gmailHistoryId ?? null,
  });

  return result;
}
