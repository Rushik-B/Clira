import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local') });

import { logger } from '@/lib/logger';
import redisConnection from '@/lib/services/utils/redis';
import {
  getGmailIngestionMode,
  getGmailPullRuntimeConfig,
} from '@/lib/email/gmailIngestionConfig';
import { GmailPullWorker } from '@/lib/email/gmailPullWorker';
import { writeGmailPullWorkerHeartbeat } from '@/lib/email/gmailPullWorkerHeartbeat';

const HEARTBEAT_INTERVAL_MS = 30_000;

let worker: GmailPullWorker | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function start(): Promise<void> {
  const mode = getGmailIngestionMode();
  if (mode !== 'pull') {
    logger.info('[GmailPullWorker] Ingestion mode is not pull; exiting process', { mode });
    process.exit(0);
  }

  const pullConfig = getGmailPullRuntimeConfig();
  worker = new GmailPullWorker({
    subscriptionName: pullConfig.subscription,
    maxMessages: pullConfig.maxMessages,
    maxBytes: pullConfig.maxBytes,
  });

  worker.start();
  await writeGmailPullWorkerHeartbeat();

  heartbeatInterval = setInterval(() => {
    void writeGmailPullWorkerHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  logger.info('[GmailPullWorker] Runtime started', {
    mode,
    subscription: pullConfig.subscription,
    maxMessages: pullConfig.maxMessages,
    maxBytes: pullConfig.maxBytes,
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('[GmailPullWorker] Shutdown requested', { signal });

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  const shutdownTimeoutMs = getGmailPullRuntimeConfig().shutdownTimeoutMs;

  try {
    if (worker) {
      const result = await worker.stop(shutdownTimeoutMs);
      logger.info('[GmailPullWorker] Stop completed', result);
    }
  } catch (error) {
    logger.error('[GmailPullWorker] Stop failed', error);
  }

  try {
    await redisConnection.quit();
  } catch (error) {
    logger.warn('[GmailPullWorker] Redis quit failed', error);
  }

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error('[GmailPullWorker] uncaughtException', error);
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  logger.error('[GmailPullWorker] unhandledRejection', error);
  void shutdown('unhandledRejection');
});

void start().catch((error) => {
  logger.error('[GmailPullWorker] Startup failed', error);
  process.exit(1);
});
