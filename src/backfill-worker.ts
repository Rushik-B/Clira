import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local') });

import { Job, Worker } from 'bullmq';
import { logger } from './lib/logger';
import {
  processInboxBackfillJob,
  processInboxEmbedRetryJob,
} from './lib/services/inbox-search/worker-handlers';
import type {
  InboxBackfillJobData,
  InboxEmbedRetryJobData,
} from './lib/services/utils/queues';
import redisConnection from './lib/services/utils/redis';

logger.info('[BackfillWorker] process started', {
  nodeEnv: process.env.NODE_ENV,
});

const workers: Worker[] = [];

const inboxBackfillWorker = new Worker<InboxBackfillJobData>(
  'inbox-backfill',
  async (job: Job<InboxBackfillJobData>) => processInboxBackfillJob(job),
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 2 * 60 * 60 * 1000, // 2 hours — a full 6-month backfill can exceed 20 min
    autorun: true,
  },
);

const inboxEmbedRetryWorker = new Worker<InboxEmbedRetryJobData>(
  'inbox-embed-retry',
  async (job: Job<InboxEmbedRetryJobData>) => processInboxEmbedRetryJob(job),
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

workers.push(inboxBackfillWorker, inboxEmbedRetryWorker);

workers.forEach((worker, index) => {
  const workerNames = ['inboxBackfill', 'inboxEmbedRetry'];
  const workerName = workerNames[index] ?? `worker-${index}`;

  worker.on('completed', (job) => {
    logger.info(`[BackfillWorker:${workerName}] job completed`, {
      jobId: job?.id,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error(`[BackfillWorker:${workerName}] job failed`, {
      jobId: job?.id,
      error,
    });
  });

  worker.on('error', (error) => {
    logger.error(`[BackfillWorker:${workerName}] worker error`, { error });
  });
});

async function gracefulShutdown(signal: string) {
  logger.info(`[BackfillWorker] received ${signal}, shutting down...`);

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await redisConnection.quit();
    logger.info('[BackfillWorker] shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('[BackfillWorker] error during shutdown', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  logger.error('[BackfillWorker] unhandled promise rejection', { error });
  void gracefulShutdown('unhandledRejection');
});
