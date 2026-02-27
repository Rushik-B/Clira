import type { Job } from 'bullmq';
import { logger } from '@/lib/logger';
import { runInboxMailboxBackfill } from '@/lib/services/inbox-search/backfill';
import { retryInboxDocumentEmbeddings } from '@/lib/services/inbox-search/embed-retry';
import { indexStoredInboxEmail } from '@/lib/services/inbox-search/ingestion';
import type {
  InboxBackfillJobData,
  InboxEmbedRetryJobData,
  InboxIndexJobData,
} from '@/lib/services/utils/queues';

export async function processInboxIndexJob(job: Job<InboxIndexJobData>) {
  const { userId, mailboxId, messageId } = job.data;
  logger.info('[InboxSearchWorker] realtime index start', {
    jobId: job.id,
    userId,
    mailboxId,
    messageId,
  });

  const result = await indexStoredInboxEmail({
    userId,
    mailboxId,
    messageId,
  });

  logger.info('[InboxSearchWorker] realtime index complete', {
    jobId: job.id,
    userId,
    mailboxId,
    messageId,
    status: result.status,
    documentId: result.documentId,
    chunkCount: result.chunkCount,
  });

  return result;
}

export async function processInboxBackfillJob(job: Job<InboxBackfillJobData>) {
  const { userId, mailboxId } = job.data;
  logger.info('[InboxSearchBackfillWorker] mailbox backfill start', {
    jobId: job.id,
    userId,
    mailboxId,
  });

  const result = await runInboxMailboxBackfill({ userId, mailboxId });

  logger.info('[InboxSearchBackfillWorker] mailbox backfill complete', {
    jobId: job.id,
    userId,
    mailboxId,
    status: result.status,
    startedFrom: result.startedFrom,
    backfillState: result.backfillState,
    pagesProcessed: result.pagesProcessed,
    emailsSeen: result.emailsSeen,
    indexedCount: result.indexedCount,
    skippedCount: result.skippedCount,
  });

  return result;
}

export async function processInboxEmbedRetryJob(job: Job<InboxEmbedRetryJobData>) {
  logger.info('[InboxSearchBackfillWorker] embedding retry start', {
    jobId: job.id,
    ...job.data,
  });

  const result = await retryInboxDocumentEmbeddings(job.data);

  logger.info('[InboxSearchBackfillWorker] embedding retry complete', {
    jobId: job.id,
    ...job.data,
    status: result.status,
  });

  return result;
}
