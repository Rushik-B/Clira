import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessagingOrchestrator } from '@/lib/services/messaging-orchestration/orchestrator';
import {
  EA_MICRO_BUFFER_MS,
  EA_QUEUE_CAP,
  type BurstState,
  type OrchestrationChannel,
  type RelevanceClassification,
} from '@/lib/services/messaging-orchestration/types';

type ClassifierInput = {
  activeIntentText: string;
  incomingText: string;
};

type Harness = {
  orchestrator: MessagingOrchestrator;
  sleepCalls: number[];
  getState: (channel: OrchestrationChannel, conversationId: string) => BurstState;
};

function createHarness(params?: {
  classify?: (input: ClassifierInput) => RelevanceClassification;
}): Harness {
  let now = 10_000;
  let idCounter = 0;
  const sleepCalls: number[] = [];
  const states = new Map<string, BurstState>();

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
    revision: 0,
    windowEndsAt: 0,
    pendingCount: 0,
    droppedSummary: [],
    latestIntentText: '',
    classifierDecision: null,
    queuedIntentText: null,
    queuedRevision: null,
    updatedAt: now,
  });

  const getOrInitState = (conversationKey: string): BurstState => {
    const existing = states.get(conversationKey);
    if (existing) {
      return existing;
    }

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
      const previous = structuredClone(getOrInitState(conversationKey));
      const current = {
        ...updater(structuredClone(previous)),
        updatedAt: now,
      };
      states.set(conversationKey, current);
      return { previous, current };
    },
    classify: async (input: ClassifierInput) => classify(input),
    emitEvent: () => {},
  });

  return {
    orchestrator,
    sleepCalls,
    getState: (channel: OrchestrationChannel, conversationId: string) =>
      structuredClone(getOrInitState(`${channel}:${conversationId}`)),
  };
}

test('scenario 1: single start uses micro-buffer and starts run', async () => {
  const harness = createHarness();

  const decision = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-1',
    userRequest: 'Draft an update for leadership',
  });

  assert.equal(decision.kind, 'start');
  assert.deepEqual(harness.sleepCalls, [EA_MICRO_BUFFER_MS]);
  assert.equal(await decision.runContext.isRunCurrent(), true);
});

test('scenario 2: supersede correction replaces in-flight run', async () => {
  const harness = createHarness({
    classify: ({ incomingText }) => ({
      decision: incomingText.startsWith('no') ? 'supersede' : 'followup',
      confidence: 0.95,
      explanation: 'correction',
      latestIntentText: incomingText,
    }),
  });

  const first = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-2',
    userRequest: 'Draft to Alex',
  });
  assert.equal(first.kind, 'start');

  const second = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-2',
    userRequest: 'no, send to Jordan instead',
  });

  assert.equal(second.kind, 'start');
  assert.notEqual(second.runContext.runId, first.runContext.runId);
  assert.equal(await first.runContext.isRunCurrent(), false);
  assert.equal(await second.runContext.isRunCurrent(), true);
});

test('scenario 3: unrelated followup queues until finalize', async () => {
  const harness = createHarness({
    classify: ({ incomingText }) => ({
      decision: 'followup',
      confidence: 0.9,
      explanation: 'separate request',
      latestIntentText: incomingText,
    }),
  });

  const first = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-3',
    userRequest: 'Summarize my inbox',
  });
  assert.equal(first.kind, 'start');

  const queued = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-3',
    userRequest: 'Also check calendar conflicts',
  });

  assert.equal(queued.kind, 'skip');
  assert.equal(queued.reason, 'queued_followup');

  const finalized = await harness.orchestrator.finalizeRun({ runContext: first.runContext });
  assert.ok(finalized.nextRun);
  assert.equal(finalized.nextRun?.userRequest, 'Also check calendar conflicts');
});

test('scenario 4: command bypass supersedes active run immediately', async () => {
  const harness = createHarness();

  const first = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-4',
    userRequest: 'Write a draft to finance',
  });
  assert.equal(first.kind, 'start');

  const commandRun = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-4',
    userRequest: 'send',
    isCommand: true,
  });

  assert.equal(commandRun.kind, 'start');
  assert.equal(await first.runContext.isRunCurrent(), false);
  assert.equal(await commandRun.runContext.isRunCurrent(), true);
});

test('scenario 5: media text + correction stay in same burst', async () => {
  const harness = createHarness({
    classify: ({ incomingText }) => ({
      decision: incomingText.includes('actually') ? 'supersede' : 'followup',
      confidence: 0.96,
      explanation: 'latest message corrects media intent',
      latestIntentText: incomingText,
    }),
  });

  const mediaRun = await harness.orchestrator.prepareRun({
    channel: 'whatsapp',
    conversationId: 'conv-5',
    userRequest: 'User sent an image on WhatsApp. Detailed image description: meeting notes.',
  });
  assert.equal(mediaRun.kind, 'start');

  const correctionRun = await harness.orchestrator.prepareRun({
    channel: 'whatsapp',
    conversationId: 'conv-5',
    userRequest: 'actually email only the action items',
  });

  assert.equal(correctionRun.kind, 'start');
  assert.equal(correctionRun.runContext.burstId, mediaRun.runContext.burstId);
  assert.equal(await mediaRun.runContext.isRunCurrent(), false);
});

test('scenario 6: queue cap summarizes overflow beyond configured cap', async () => {
  const harness = createHarness({
    classify: ({ incomingText }) => ({
      decision: 'followup',
      confidence: 0.85,
      explanation: 'queue followup',
      latestIntentText: incomingText,
    }),
  });

  const first = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-6',
    userRequest: 'initial request',
  });
  assert.equal(first.kind, 'start');

  const extraMessages = EA_QUEUE_CAP + 3;
  for (let i = 1; i <= extraMessages; i += 1) {
    const decision = await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-6',
      userRequest: `overflow message ${i}`,
    });
    assert.equal(decision.kind, 'skip');
  }

  const state = harness.getState('twilio', 'conv-6');
  assert.equal(state.pendingCount, EA_QUEUE_CAP);
  assert.equal(state.droppedSummary.length, 3);
  assert.ok(state.droppedSummary.every((entry) => entry.startsWith('overflow message')));
});

test('scenario 10: telegram adapter path matches burst-steering behavior', async () => {
  const harness = createHarness({
    classify: ({ incomingText }) => ({
      decision: incomingText.startsWith('wait') ? 'supersede' : 'followup',
      confidence: 0.94,
      explanation: 'telegram correction',
      latestIntentText: incomingText,
    }),
  });

  const adapter = {
    channel: 'telegram' as const,
    conversationId: () => 'conv-10',
  };

  const first = await harness.orchestrator.prepareRunWithAdapter({
    adapter,
    userRequest: 'Draft this update for the team',
  });
  assert.equal(first.kind, 'start');

  const correction = await harness.orchestrator.prepareRunWithAdapter({
    adapter,
    userRequest: 'wait, include the deadline update',
  });

  assert.equal(correction.kind, 'start');
  assert.equal(await first.runContext.isRunCurrent(), false);
  assert.equal(correction.runContext.channel, 'telegram');
});
