import redisConnection from '@/lib/services/utils/redis';
import { logger } from '@/lib/logger';

export const GMAIL_PULL_WORKER_HEARTBEAT_KEY = 'gmail-pull-worker:heartbeat';
export const GMAIL_PULL_WORKER_HEARTBEAT_TTL_SECONDS = 90;

export async function writeGmailPullWorkerHeartbeat(nowMs: number = Date.now()): Promise<void> {
  try {
    await redisConnection.set(
      GMAIL_PULL_WORKER_HEARTBEAT_KEY,
      String(nowMs),
      'EX',
      GMAIL_PULL_WORKER_HEARTBEAT_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn('[GmailPullWorker] Failed to write heartbeat', error);
  }
}

export async function readGmailPullWorkerHeartbeat(): Promise<
  | {
      lastSeenAtMs: number;
      ageMs: number;
    }
  | null
> {
  try {
    const value = await redisConnection.get(GMAIL_PULL_WORKER_HEARTBEAT_KEY);
    if (!value) return null;

    const lastSeenAtMs = Number(value);
    if (!Number.isFinite(lastSeenAtMs)) return null;

    return { lastSeenAtMs, ageMs: Date.now() - lastSeenAtMs };
  } catch (error) {
    logger.warn('[GmailPullWorker] Failed to read heartbeat', error);
    return null;
  }
}
