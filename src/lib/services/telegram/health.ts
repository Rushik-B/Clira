import { prisma } from '@/lib/prisma';
import {
  TELEGRAM_POLLER_WORKER_KEY,
  isTelegramConfigured,
  isTelegramEnabled,
} from './telegramClient';
import { readTelegramWorkerHeartbeat } from './workerHeartbeat';

export interface TelegramHealthSnapshot {
  configured: boolean;
  enabled: boolean;
  workerConnected: boolean;
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  lastUpdateId: number | null;
  lastUpdateAt: string | null;
}

export async function getTelegramHealthSnapshot(): Promise<TelegramHealthSnapshot> {
  const [heartbeat, pollerState] = await Promise.all([
    readTelegramWorkerHeartbeat(),
    prisma.telegramPollerState.findUnique({
      where: { workerKey: TELEGRAM_POLLER_WORKER_KEY },
      select: {
        lastUpdateId: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    configured: isTelegramConfigured(),
    enabled: isTelegramEnabled(),
    workerConnected: Boolean(heartbeat),
    lastHeartbeatAt: heartbeat ? new Date(heartbeat.lastSeenAtMs).toISOString() : null,
    heartbeatAgeMs: heartbeat?.ageMs ?? null,
    lastUpdateId: pollerState?.lastUpdateId ?? null,
    lastUpdateAt: pollerState?.updatedAt?.toISOString() ?? null,
  };
}
