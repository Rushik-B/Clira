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
  getEvents: () => Array<{ event: string; payload: Record<string, unknown> }>;
};

function createHarness(params?: {
  classify?: (input: ClassifierInput) => RelevanceClassification;
}): Harness {
  let now = 10_000;
  let idCounter = 0;
  const sleepCalls: number[] = [];
  const states = new Map<string, BurstState>();
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];

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
    emitEvent: (event, payload) => {
      events.push({
        event,
        payload: payload as Record<string, unknown>,
      });
    },
  });

  return {
    orchestrator,
    sleepCalls,
    getState: (channel: OrchestrationChannel, conversationId: string) =>
      structuredClone(getOrInitState(`${channel}:${conversationId}`)),
    getEvents: () => structuredClone(events),
  };
}

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
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

test('scenario 7: cooperative steering enqueues in-run steer event (ambiguous >= 0.65)', async () => {
  await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
    const harness = createHarness({
      classify: ({ incomingText }) => ({
        decision: 'ambiguous',
        confidence: 0.7,
        explanation: 'likely correction',
        latestIntentText: incomingText,
      }),
    });

    const first = await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-7',
      userRequest: 'Draft to Alex',
    });
    assert.equal(first.kind, 'start');

    const steer = await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-7',
      userRequest: 'actually, keep it shorter',
    });

    assert.equal(steer.kind, 'skip');
    assert.equal(steer.reason, 'steered_in_run');
    assert.equal(await first.runContext.isRunCurrent(), true);

    const consumed = await first.runContext.consumeSteerEvents(0);
    assert.equal(consumed.events.length, 1);
    assert.equal(consumed.events[0]?.text, 'actually, keep it shorter');
    assert.equal(consumed.nextSeq, consumed.events[0]?.seq);
    assert.equal(await first.runContext.hasPendingSteer(0), false);

    const enqueued = harness
      .getEvents()
      .filter((entry) => entry.event === 'orchestrator.steer.enqueued');
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0]?.payload.runId, first.runContext.runId);
  });
});

test('scenario 8: commit-boundary blocks steering and queues followup', async () => {
  await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
    const harness = createHarness({
      classify: ({ incomingText }) => ({
        decision: 'ambiguous',
        confidence: 0.7,
        explanation: 'likely correction',
        latestIntentText: incomingText,
      }),
    });

    const first = await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-8',
      userRequest: 'Draft to Alex',
    });
    assert.equal(first.kind, 'start');

    await first.runContext.markRunPhase('commit_boundary');

    const incoming = await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-8',
      userRequest: 'actually, add a line about the deadline',
    });

    assert.equal(incoming.kind, 'skip');
    assert.equal(incoming.reason, 'queued_followup');

    const blocked = harness
      .getEvents()
      .filter((entry) => entry.event === 'orchestrator.steer.blocked_commit_boundary');
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]?.payload.runId, first.runContext.runId);
    assert.equal(blocked[0]?.payload.runPhase, 'commit_boundary');
  });
});

test('scenario 9: steer mailbox caps and summarizes overflow deterministically', async () => {
  await withEnv({ EA_STEER_COOPERATIVE: 'true', EA_STEER_MAILBOX_CAP: '2' }, async () => {
    const harness = createHarness({
      classify: ({ incomingText }) => ({
        decision: 'ambiguous',
        confidence: 0.7,
        explanation: 'likely correction',
        latestIntentText: incomingText,
      }),
    });

    const first = await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-9',
      userRequest: 'Draft to Alex',
    });
    assert.equal(first.kind, 'start');

    for (const msg of ['msg-1', 'msg-2', 'msg-3', 'msg-4']) {
      const decision = await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-9',
        userRequest: msg,
      });
      assert.equal(decision.kind, 'skip');
      assert.equal(decision.reason, 'steered_in_run');
    }

    const state = harness.getState('twilio', 'conv-9');
    assert.equal(state.steerSeq, 4);
    assert.equal(state.steerMailbox.length, 2);
    assert.equal(state.steerDroppedSummary.length, 2);
    assert.deepEqual(
      state.steerMailbox.map((e) => e.text),
      ['msg-3', 'msg-4'],
    );

    const consumed = await first.runContext.consumeSteerEvents(0);
    assert.equal(consumed.events.length, 2);
    assert.equal(consumed.droppedSummary.length, 2);
  });
});

test('scenario 11: consuming mailbox emits steer.applied lifecycle event', async () => {
  await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
    const harness = createHarness({
      classify: ({ incomingText }) => ({
        decision: 'ambiguous',
        confidence: 0.7,
        explanation: 'likely correction',
        latestIntentText: incomingText,
      }),
    });

    const first = await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-11',
      userRequest: 'Draft to Alex',
    });
    assert.equal(first.kind, 'start');

    for (const msg of ['make it shorter', 'mention timeline']) {
      const decision = await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-11',
        userRequest: msg,
      });
      assert.equal(decision.kind, 'skip');
      assert.equal(decision.reason, 'steered_in_run');
    }

    const consumed = await first.runContext.consumeSteerEvents(0);
    assert.equal(consumed.events.length, 2);

    const applied = harness
      .getEvents()
      .filter((entry) => entry.event === 'orchestrator.steer.applied');
    assert.equal(applied.length, 1);
    assert.equal(applied[0]?.payload.runId, first.runContext.runId);
    assert.equal(applied[0]?.payload.fromSeq, 0);
    assert.equal(applied[0]?.payload.toSeq, 2);
    assert.equal(applied[0]?.payload.appliedEvents, 2);
    assert.equal(applied[0]?.payload.appliedDroppedSummary, 0);
  });
});

test('scenario 12: run phase transitions emit lifecycle events', async () => {
  const harness = createHarness();

  const first = await harness.orchestrator.prepareRun({
    channel: 'twilio',
    conversationId: 'conv-12',
    userRequest: 'Draft to Alex',
  });
  assert.equal(first.kind, 'start');

  await first.runContext.markRunPhase('commit_boundary');
  await harness.orchestrator.finalizeRun({ runContext: first.runContext });

  const phaseEvents = harness
    .getEvents()
    .filter((entry) => entry.event === 'orchestrator.run.phase.changed');
  assert.equal(phaseEvents.length, 2);

  assert.equal(phaseEvents[0]?.payload.runId, first.runContext.runId);
  assert.equal(phaseEvents[0]?.payload.fromPhase, 'running');
  assert.equal(phaseEvents[0]?.payload.toPhase, 'commit_boundary');
  assert.equal(phaseEvents[0]?.payload.reason, 'mark_run_phase');

  assert.equal(phaseEvents[1]?.payload.runId, first.runContext.runId);
  assert.equal(phaseEvents[1]?.payload.fromPhase, 'commit_boundary');
  assert.equal(phaseEvents[1]?.payload.toPhase, 'completed');
  assert.equal(phaseEvents[1]?.payload.reason, 'finalize_run');
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
