import redisConnection from '@/lib/services/utils/redis';
import { logger } from '@/lib/logger';

export const SUPERMEMORY_WORKER_HEARTBEAT_KEY = 'supermemory-bootstrap-worker:heartbeat';
export const SUPERMEMORY_WORKER_HEARTBEAT_TTL_SECONDS = 90;

export async function writeSupermemoryWorkerHeartbeat(nowMs: number = Date.now()): Promise<void> {
  try {
    await redisConnection.set(
      SUPERMEMORY_WORKER_HEARTBEAT_KEY,
      String(nowMs),
      'EX',
      SUPERMEMORY_WORKER_HEARTBEAT_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn('[Supermemory] Failed to write bootstrap worker heartbeat:', error);
  }
}

export async function readSupermemoryWorkerHeartbeat(): Promise<
  | {
      lastSeenAtMs: number;
      ageMs: number;
    }
  | null
> {
  try {
    const value = await redisConnection.get(SUPERMEMORY_WORKER_HEARTBEAT_KEY);
    if (!value) return null;

    const lastSeenAtMs = Number(value);
    if (!Number.isFinite(lastSeenAtMs)) return null;

    return { lastSeenAtMs, ageMs: Date.now() - lastSeenAtMs };
  } catch (error) {
    logger.warn('[Supermemory] Failed to read bootstrap worker heartbeat:', error);
    return null;
  }
}
