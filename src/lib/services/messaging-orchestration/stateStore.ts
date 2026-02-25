import crypto from 'crypto';
import { logger } from '@/lib/logger';
import redisConnection, { isRedisConnected } from '@/lib/services/utils/redis';
import type {
  BurstState,
  OrchestrationChannel,
  RunPhase,
  SteerEvent,
} from './types';
import {
  EA_STATE_TTL_SECONDS,
} from './types';

const STATE_KEY_PREFIX = 'ea:orchestrator:v2:state';
const MAX_UPDATE_RETRIES = 6;

export class OrchestrationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationStateError';
  }
}

function stateKey(conversationKey: string): string {
  return `${STATE_KEY_PREFIX}:${conversationKey}`;
}

function createDefaultState(): BurstState {
  const now = Date.now();
  return {
    burstId: crypto.randomUUID(),
    activeRunId: null,
    activeRevision: null,
    activeRunPhase: 'running',
    revision: 0,
    windowEndsAt: 0,
    pendingCount: 0,
    droppedSummary: [],
    latestIntentText: '',
    classifierDecision: null,
    queuedIntentText: null,
    queuedRevision: null,
    steerSeq: 0,
    steerMailbox: [],
    steerDroppedSummary: [],
    updatedAt: now,
  };
}

function normalizeRunPhase(value: unknown, fallback: RunPhase): RunPhase {
  if (value === 'running' || value === 'commit_boundary' || value === 'completed') {
    return value;
  }
  return fallback;
}

function parseSteerEvent(value: unknown): SteerEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const seq = typeof record.seq === 'number' ? record.seq : null;
  const revision = typeof record.revision === 'number' ? record.revision : null;
  const receivedAt = typeof record.receivedAt === 'number' ? record.receivedAt : null;
  const text = typeof record.text === 'string' ? record.text : null;
  const decision = record.decision;
  const confidence = typeof record.confidence === 'number' ? record.confidence : null;

  if (
    seq === null ||
    revision === null ||
    receivedAt === null ||
    text === null ||
    confidence === null
  ) {
    return null;
  }

  if (!(decision === 'supersede' || decision === 'followup' || decision === 'ambiguous')) {
    return null;
  }

  return {
    seq,
    revision,
    receivedAt,
    text,
    decision,
    confidence,
  };
}

export function parseBurstState(raw: string | null): BurstState {
  if (!raw) return createDefaultState();

  try {
    const parsed = JSON.parse(raw) as Partial<BurstState>;
    const defaults = createDefaultState();

    return {
      ...defaults,
      ...parsed,
      droppedSummary: Array.isArray(parsed.droppedSummary)
        ? parsed.droppedSummary.filter((item): item is string => typeof item === 'string')
        : defaults.droppedSummary,
      steerDroppedSummary: Array.isArray(parsed.steerDroppedSummary)
        ? parsed.steerDroppedSummary.filter((item): item is string => typeof item === 'string')
        : defaults.steerDroppedSummary,
      classifierDecision:
        parsed.classifierDecision === 'supersede' ||
        parsed.classifierDecision === 'followup' ||
        parsed.classifierDecision === 'ambiguous'
          ? parsed.classifierDecision
          : null,
      activeRunId: typeof parsed.activeRunId === 'string' ? parsed.activeRunId : null,
      activeRevision: typeof parsed.activeRevision === 'number' ? parsed.activeRevision : null,
      activeRunPhase: normalizeRunPhase(parsed.activeRunPhase as unknown, defaults.activeRunPhase),
      queuedIntentText: typeof parsed.queuedIntentText === 'string' ? parsed.queuedIntentText : null,
      queuedRevision: typeof parsed.queuedRevision === 'number' ? parsed.queuedRevision : null,
      latestIntentText: typeof parsed.latestIntentText === 'string' ? parsed.latestIntentText : '',
      steerSeq: typeof parsed.steerSeq === 'number' ? parsed.steerSeq : defaults.steerSeq,
      steerMailbox: Array.isArray(parsed.steerMailbox)
        ? parsed.steerMailbox
            .map(parseSteerEvent)
            .filter((item): item is SteerEvent => item !== null)
        : defaults.steerMailbox,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : defaults.updatedAt,
    };
  } catch (error) {
    throw new OrchestrationStateError(
      `Failed to parse orchestration state: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function ensureRedisReady(): Promise<void> {
  if (isRedisConnected()) return;

  if (redisConnection.status === 'end' || redisConnection.status === 'close') {
    try {
      await redisConnection.connect();
    } catch (error) {
      throw new OrchestrationStateError(
        `Redis unavailable for orchestration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!isRedisConnected()) {
    throw new OrchestrationStateError(
      `Redis unavailable for orchestration: status=${redisConnection.status}`,
    );
  }
}

export function buildConversationKey(
  channel: OrchestrationChannel,
  conversationId: string,
): string {
  return `${channel}:${conversationId}`;
}

export async function readBurstState(conversationKey: string): Promise<BurstState> {
  await ensureRedisReady();
  const raw = await redisConnection.get(stateKey(conversationKey));
  return parseBurstState(raw);
}

export async function writeBurstState(
  conversationKey: string,
  nextState: BurstState,
): Promise<void> {
  await ensureRedisReady();
  const payload: BurstState = {
    ...nextState,
    updatedAt: Date.now(),
  };

  await redisConnection.set(
    stateKey(conversationKey),
    JSON.stringify(payload),
    'EX',
    EA_STATE_TTL_SECONDS,
  );
}

export async function updateBurstState(
  conversationKey: string,
  updater: (state: BurstState) => BurstState,
): Promise<{ previous: BurstState; current: BurstState }> {
  await ensureRedisReady();
  const key = stateKey(conversationKey);

  for (let attempt = 0; attempt < MAX_UPDATE_RETRIES; attempt += 1) {
    await redisConnection.watch(key);

    try {
      const previous = parseBurstState(await redisConnection.get(key));
      const current = {
        ...updater(previous),
        updatedAt: Date.now(),
      };

      const tx = redisConnection.multi();
      tx.set(key, JSON.stringify(current), 'EX', EA_STATE_TTL_SECONDS);
      const result = await tx.exec();

      if (result !== null) {
        return { previous, current };
      }
    } finally {
      await redisConnection.unwatch();
    }
  }

  logger.error('[messagingOrchestration] Failed to update state after retries', {
    conversationKey,
  });
  throw new OrchestrationStateError('State update conflict; retry required');
}
