import redisConnection from '@/lib/services/utils/redis';
import { logger } from '@/lib/logger';

export const TELEGRAM_WORKER_HEARTBEAT_KEY = 'telegram-worker:heartbeat';
export const TELEGRAM_WORKER_HEARTBEAT_TTL_SECONDS = 90;

export async function writeTelegramWorkerHeartbeat(nowMs: number = Date.now()): Promise<void> {
  try {
    await redisConnection.set(
      TELEGRAM_WORKER_HEARTBEAT_KEY,
      String(nowMs),
      'EX',
      TELEGRAM_WORKER_HEARTBEAT_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn('[Telegram] Failed to write worker heartbeat:', error);
  }
}

export async function readTelegramWorkerHeartbeat(): Promise<
  | {
      lastSeenAtMs: number;
      ageMs: number;
    }
  | null
> {
  try {
    const value = await redisConnection.get(TELEGRAM_WORKER_HEARTBEAT_KEY);
    if (!value) return null;

    const lastSeenAtMs = Number(value);
    if (!Number.isFinite(lastSeenAtMs)) return null;

    return { lastSeenAtMs, ageMs: Date.now() - lastSeenAtMs };
  } catch (error) {
    logger.warn('[Telegram] Failed to read worker heartbeat:', error);
    return null;
  }
}
