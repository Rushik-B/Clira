import type { JobsOptions, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';
import {
  inboxBackfillQueue,
  inboxEmbedRetryQueue,
  inboxIndexQueue,
  type InboxBackfillJobData,
  type InboxEmbedRetryJobData,
  type InboxIndexJobData,
} from '@/lib/services/utils/queues';

const ACTIVE_JOB_STATES = new Set(['waiting', 'delayed', 'active', 'prioritized']);
const DEFAULT_EMBEDDING_SWEEP_PAGE_SIZE = 100;

type MissingEmbeddingDocumentRow = {
  documentId: string;
  mailboxId: string;
  messageId: string;
};

async function addStableJob<T>(
  queue: Queue<T, unknown, string>,
  name: string,
  data: T,
  jobId: string,
  options: JobsOptions = {},
): Promise<{ jobId: string; enqueued: boolean }> {
  const existingJob = await queue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (ACTIVE_JOB_STATES.has(state)) {
      return { jobId, enqueued: false };
    }

    try {
      await existingJob.remove();
    } catch (error) {
      logger.warn('[InboxSearchQueue] Failed to clear existing job before re-enqueue', {
        jobId,
        name,
        state,
        error,
      });
      return { jobId, enqueued: false };
    }
  }

  const job = await queue.add(name as never, data as never, {
    jobId,
    ...options,
  });

  return { jobId: job.id ?? jobId, enqueued: true };
}

export async function enqueueInboxIndexJob(
  data: InboxIndexJobData,
): Promise<{ jobId: string; enqueued: boolean }> {
  return addStableJob(
    inboxIndexQueue,
    'index-email',
    data,
    `inbox-index:${data.mailboxId}:${data.messageId}`,
  );
}

export async function enqueueInboxEmbedRetryJob(
  data: InboxEmbedRetryJobData,
): Promise<{ jobId: string; enqueued: boolean }> {
  const stableId =
    data.documentId
      ? `inbox-embed-retry:${data.documentId}`
      : `inbox-embed-retry:${data.mailboxId}:${data.messageId}`;

  return addStableJob(inboxEmbedRetryQueue, 'retry-document-embedding', data, stableId);
}

export async function enqueueInboxEmbeddingBackfillSweepPage(params: {
  userId: string;
  mailboxId: string;
  afterDocumentId?: string | null;
  pageSize?: number;
}): Promise<{
  scannedDocuments: number;
  enqueuedCount: number;
  nextAfterDocumentId: string | null;
  hasMore: boolean;
}> {
  const pageSize = Math.max(1, Math.min(params.pageSize ?? DEFAULT_EMBEDDING_SWEEP_PAGE_SIZE, 500));

  const rows = await runInboxSearchTransaction(params.userId, async (tx) =>
    tx.$queryRaw<MissingEmbeddingDocumentRow[]>(Prisma.sql`
      SELECT
        d."id" AS "documentId",
        d."mailboxId" AS "mailboxId",
        d."messageId" AS "messageId"
      FROM "InboxSearchChunk" c
      INNER JOIN "InboxSearchDocument" d
        ON d."id" = c."documentId"
      WHERE
        d."userId" = ${params.userId}
        AND d."mailboxId" = ${params.mailboxId}
        AND d."isDeleted" = false
        AND c."embedding" IS NULL
        AND c."chunkText" <> ''
        ${
          params.afterDocumentId
            ? Prisma.sql`AND d."id" > ${params.afterDocumentId}`
            : Prisma.sql``
        }
      GROUP BY d."id", d."mailboxId", d."messageId"
      ORDER BY d."id" ASC
      LIMIT ${pageSize}
    `),
  );

  let enqueuedCount = 0;
  for (const row of rows) {
    const result = await enqueueInboxEmbedRetryJob({
      userId: params.userId,
      mailboxId: row.mailboxId,
      messageId: row.messageId,
      documentId: row.documentId,
    });

    if (result.enqueued) {
      enqueuedCount += 1;
    }
  }

  return {
    scannedDocuments: rows.length,
    enqueuedCount,
    nextAfterDocumentId: rows.at(-1)?.documentId ?? null,
    hasMore: rows.length === pageSize,
  };
}

export async function enqueueInboxEmbeddingBackfillSweep(params: {
  userId: string;
  mailboxId: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<{
  scannedDocuments: number;
  enqueuedCount: number;
  hasRemaining: boolean;
  nextAfterDocumentId: string | null;
}> {
  const maxPages = Math.max(1, params.maxPages ?? 5);
  let scannedDocuments = 0;
  let enqueuedCount = 0;
  let hasRemaining = false;
  let afterDocumentId: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await enqueueInboxEmbeddingBackfillSweepPage({
      userId: params.userId,
      mailboxId: params.mailboxId,
      afterDocumentId,
      pageSize: params.pageSize,
    });

    scannedDocuments += pageResult.scannedDocuments;
    enqueuedCount += pageResult.enqueuedCount;
    afterDocumentId = pageResult.nextAfterDocumentId;

    if (!pageResult.hasMore || !pageResult.nextAfterDocumentId) {
      hasRemaining = false;
      break;
    }

    hasRemaining = true;
  }

  return {
    scannedDocuments,
    enqueuedCount,
    hasRemaining,
    nextAfterDocumentId: afterDocumentId,
  };
}

export async function enqueueInboxBackfillJob(
  data: InboxBackfillJobData,
): Promise<{ jobId: string; enqueued: boolean }> {
  return addStableJob(
    inboxBackfillQueue,
    'backfill-mailbox',
    data,
    `inbox-backfill:${data.mailboxId}`,
  );
}

export async function enqueueInboxBackfillForConnectedMailboxes(
  userId: string,
): Promise<{ enqueuedCount: number; mailboxIds: string[]; skippedReason?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, masterPromptGenerated: true },
  });

  if (!user) {
    return { enqueuedCount: 0, mailboxIds: [], skippedReason: 'user-not-found' };
  }

  if (!user.masterPromptGenerated) {
    return { enqueuedCount: 0, mailboxIds: [], skippedReason: 'master-prompt-not-generated' };
  }

  const mailboxes = await prisma.mailbox.findMany({
    where: {
      userId,
      status: 'CONNECTED',
    },
    select: {
      id: true,
    },
  });

  const mailboxIds: string[] = [];

  for (const mailbox of mailboxes) {
    const result = await enqueueInboxBackfillJob({
      userId,
      mailboxId: mailbox.id,
    });

    if (result.enqueued) {
      mailboxIds.push(mailbox.id);
    }
  }

  return {
    enqueuedCount: mailboxIds.length,
    mailboxIds,
    ...(mailboxes.length === 0 ? { skippedReason: 'no-connected-mailboxes' } : {}),
  };
}

export async function enqueueInboxBackfillForMailboxIfReady(params: {
  userId: string;
  mailboxId: string;
}): Promise<{ jobId?: string; enqueued: boolean; skippedReason?: string }> {
  const { userId, mailboxId } = params;

  const [user, mailbox] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { masterPromptGenerated: true },
    }),
    prisma.mailbox.findUnique({
      where: { id: mailboxId },
      select: { id: true, userId: true, status: true },
    }),
  ]);

  if (!user?.masterPromptGenerated) {
    return { enqueued: false, skippedReason: 'master-prompt-not-generated' };
  }

  if (!mailbox || mailbox.userId !== userId) {
    return { enqueued: false, skippedReason: 'mailbox-not-found' };
  }

  if (mailbox.status !== 'CONNECTED') {
    return { enqueued: false, skippedReason: 'mailbox-not-connected' };
  }

  const result = await enqueueInboxBackfillJob({ userId, mailboxId });
  return { jobId: result.jobId, enqueued: result.enqueued };
}
