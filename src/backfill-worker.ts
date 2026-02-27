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

console.log('📚 Inbox backfill worker process started...');
console.log(`  - NODE_ENV: ${process.env.NODE_ENV}`);

const workers: Worker[] = [];

const inboxBackfillWorker = new Worker<InboxBackfillJobData>(
  'inbox-backfill',
  async (job: Job<InboxBackfillJobData>) => processInboxBackfillJob(job),
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 20 * 60 * 1000,
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
    console.log(`✅ [${workerName}] Job ${job?.id} completed`);
  });

  worker.on('failed', (job, error) => {
    console.error(`❌ [${workerName}] Job ${job?.id} failed:`, error);
  });

  worker.on('error', (error) => {
    console.error(`🚨 [${workerName}] Worker error:`, error);
  });
});

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, starting backfill worker shutdown...`);

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await redisConnection.quit();
    console.log('✅ Backfill worker shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during backfill worker shutdown', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error('🚨 Backfill worker unhandled promise rejection:', error);
  void gracefulShutdown('unhandledRejection');
});
