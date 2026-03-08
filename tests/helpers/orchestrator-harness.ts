/**
 * Shared test harness for MessagingOrchestrator.
 *
 * Creates a fully in-memory orchestrator with injectable classifier,
 * deterministic time control, and event capture. Used across unit tests
 * for orchestration scenarios, steering, and state management.
 */
import { MessagingOrchestrator } from '@/lib/services/messaging-orchestration/orchestrator';
import type {
  BurstState,
  OrchestrationChannel,
  RelevanceClassification,
} from '@/lib/services/messaging-orchestration/types';

type ClassifierInput = {
  activeIntentText: string;
  incomingText: string;
};

type EmittedEvent = { event: string; payload: Record<string, unknown> };

export type OrchestratorHarness = {
  orchestrator: MessagingOrchestrator;
  sleepCalls: number[];
  getState: (channel: OrchestrationChannel, conversationId: string) => BurstState;
  setState: (
    channel: OrchestrationChannel,
    conversationId: string,
    state: BurstState,
  ) => void;
  getEvents: () => EmittedEvent[];
  filterEvents: (name: string) => EmittedEvent[];
};

export function createOrchestratorHarness(params?: {
  classify?: (
    input: ClassifierInput,
  ) => RelevanceClassification | Promise<RelevanceClassification>;
  beforeUpdate?: (args: {
    conversationKey: string;
    callCount: number;
    state: BurstState;
  }) => BurstState | null | void;
}): OrchestratorHarness {
  let now = 10_000;
  let idCounter = 0;
  let updateCallCount = 0;
  const sleepCalls: number[] = [];
  const states = new Map<string, BurstState>();
  const events: EmittedEvent[] = [];

  const createId = () => `id-${++idCounter}`;
  const classify =
    params?.classify ??
    (() => ({
      decision: 'ambiguous' as const,
      confidence: 0.5,
      explanation: 'default',
      latestIntentText: 'default',
    }));

  const defaultState = (): BurstState => ({
    burstId: createId(),
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
  });

  const getOrInitState = (conversationKey: string): BurstState => {
    const existing = states.get(conversationKey);
    if (existing) return existing;
    const created = defaultState();
    states.set(conversationKey, created);
    return created;
  };

  const orchestrator = new MessagingOrchestrator({
    now: () => now,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
      now += ms;
    },
    createId,
    readState: async (conversationKey: string) => structuredClone(getOrInitState(conversationKey)),
    updateState: async (conversationKey: string, updater) => {
      updateCallCount += 1;
      const existing = structuredClone(getOrInitState(conversationKey));
      const maybeReplacement = params?.beforeUpdate?.({
        conversationKey,
        callCount: updateCallCount,
        state: structuredClone(existing),
      });
      const previous =
        maybeReplacement && typeof maybeReplacement === 'object'
          ? structuredClone(maybeReplacement)
          : existing;
      states.set(conversationKey, structuredClone(previous));
      const current = {
        ...updater(structuredClone(previous)),
        updatedAt: now,
      };
      states.set(conversationKey, current);
      return { previous, current };
    },
    classify: async (input: ClassifierInput) => classify(input),
    emitEvent: (event, payload) => {
      events.push({ event, payload: payload as Record<string, unknown> });
    },
  });

  return {
    orchestrator,
    sleepCalls,
    getState: (channel, conversationId) =>
      structuredClone(getOrInitState(`${channel}:${conversationId}`)),
    setState: (channel, conversationId, state) => {
      states.set(`${channel}:${conversationId}`, structuredClone(state));
    },
    getEvents: () => structuredClone(events),
    filterEvents: (name: string) =>
      structuredClone(events.filter((e) => e.event === name)),
  };
}

/**
 * Temporarily sets env vars for the duration of a callback, then restores.
 */
export async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
