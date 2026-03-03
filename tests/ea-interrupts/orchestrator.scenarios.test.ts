import { describe, expect, test } from 'vitest';
import {
  EA_MICRO_BUFFER_MS,
  EA_QUEUE_CAP,
  type OrchestrationDecision,
  type RunSkip,
  type RunStart,
} from '@/lib/services/messaging-orchestration/types';
import { createOrchestratorHarness, withEnv } from '../helpers/orchestrator-harness';

function expectStart(decision: OrchestrationDecision): RunStart {
  expect(decision.kind).toBe('start');
  return decision as RunStart;
}

function expectSkip(decision: OrchestrationDecision): RunSkip {
  expect(decision.kind).toBe('skip');
  return decision as RunSkip;
}

describe('MessagingOrchestrator scenarios', () => {
  test('scenario 1: single start uses micro-buffer and starts run', async () => {
    const harness = createOrchestratorHarness();

    const decision = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-1',
      userRequest: 'Draft an update for leadership',
    }));

    expect(harness.sleepCalls).toEqual([EA_MICRO_BUFFER_MS]);
    expect(await decision.runContext.isRunCurrent()).toBe(true);
  });

  test('scenario 2: supersede correction replaces in-flight run', async () => {
    const harness = createOrchestratorHarness({
      classify: ({ incomingText }) => ({
        decision: incomingText.startsWith('no') ? 'supersede' : 'followup',
        confidence: 0.95,
        explanation: 'correction',
        latestIntentText: incomingText,
      }),
    });

    const first = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-2',
      userRequest: 'Draft to Alex',
    }));

    const second = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-2',
      userRequest: 'no, send to Jordan instead',
    }));

    expect(second.runContext.runId).not.toBe(first.runContext.runId);
    expect(await first.runContext.isRunCurrent()).toBe(false);
    expect(await second.runContext.isRunCurrent()).toBe(true);
  });

  test('scenario 3: explicit separate-task followup queues until finalize', async () => {
    const harness = createOrchestratorHarness({
      classify: ({ incomingText }) => ({
        decision: 'followup',
        confidence: 0.9,
        explanation: 'separate request',
        latestIntentText: incomingText,
      }),
    });

    const first = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-3',
      userRequest: 'Summarize my inbox',
    }));

    const queued = expectSkip(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-3',
      userRequest: 'Separate task: after this, check calendar conflicts',
    }));

    expect(queued.reason).toBe('queued_followup');

    const finalized = await harness.orchestrator.finalizeRun({ runContext: first.runContext });
    expect(finalized.nextRun).toBeTruthy();
    expect(finalized.nextRun?.userRequest).toBe('Separate task: after this, check calendar conflicts');
  });

  test('scenario 4: command bypass supersedes active run immediately', async () => {
    const harness = createOrchestratorHarness();

    const first = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-4',
      userRequest: 'Write a draft to finance',
    }));

    const commandRun = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-4',
      userRequest: 'send',
      isCommand: true,
    }));

    expect(await first.runContext.isRunCurrent()).toBe(false);
    expect(await commandRun.runContext.isRunCurrent()).toBe(true);
  });

  test('scenario 5: media text + correction stay in same burst', async () => {
    const harness = createOrchestratorHarness({
      classify: ({ incomingText }) => ({
        decision: incomingText.includes('actually') ? 'supersede' : 'followup',
        confidence: 0.96,
        explanation: 'latest message corrects media intent',
        latestIntentText: incomingText,
      }),
    });

    const mediaRun = expectStart(await harness.orchestrator.prepareRun({
      channel: 'whatsapp',
      conversationId: 'conv-5',
      userRequest: 'User sent an image on WhatsApp. Detailed image description: meeting notes.',
    }));

    const correctionRun = expectStart(await harness.orchestrator.prepareRun({
      channel: 'whatsapp',
      conversationId: 'conv-5',
      userRequest: 'actually email only the action items',
    }));

    expect(correctionRun.runContext.burstId).toBe(mediaRun.runContext.burstId);
    expect(await mediaRun.runContext.isRunCurrent()).toBe(false);
  });

  test('scenario 6: queue cap summarizes overflow beyond configured cap', async () => {
    const harness = createOrchestratorHarness({
      classify: ({ incomingText }) => ({
        decision: 'followup',
        confidence: 0.85,
        explanation: 'queue followup',
        latestIntentText: incomingText,
      }),
    });

    const first = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-6',
      userRequest: 'initial request',
    }));

    const extraMessages = EA_QUEUE_CAP + 3;
    for (let i = 1; i <= extraMessages; i += 1) {
      const decision = expectSkip(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-6',
        userRequest: `overflow message ${i}`,
      }));
    }

    const state = harness.getState('twilio', 'conv-6');
    expect(state.pendingCount).toBe(EA_QUEUE_CAP);
    expect(state.droppedSummary).toHaveLength(3);
    expect(state.droppedSummary.every((entry) => entry.startsWith('overflow message'))).toBe(true);
  });
});

describe('Cooperative steering scenarios', () => {
  test('scenario 7: cooperative steering enqueues in-run steer event (ambiguous >= threshold)', async () => {
    await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
      const harness = createOrchestratorHarness({
        classify: ({ incomingText }) => ({
          decision: 'ambiguous',
          confidence: 0.7,
          explanation: 'likely correction',
          latestIntentText: incomingText,
        }),
      });

      const first = expectStart(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-7',
        userRequest: 'Draft to Alex',
      }));

      const steer = expectSkip(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-7',
        userRequest: 'actually, keep it shorter',
      }));

      expect(steer.reason).toBe('steered_in_run');
      expect(await first.runContext.isRunCurrent()).toBe(true);

      const consumed = await first.runContext.consumeSteerEvents(0);
      expect(consumed.events).toHaveLength(1);
      expect(consumed.events[0]?.text).toBe('actually, keep it shorter');
      expect(consumed.nextSeq).toBe(consumed.events[0]?.seq);
      expect(await first.runContext.hasPendingSteer(0)).toBe(false);

      const enqueued = harness.filterEvents('orchestrator.steer.enqueued');
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]?.payload.runId).toBe(first.runContext.runId);
    });
  });

  test('scenario 14: followup constraint steers in-run by default', async () => {
    await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
      const harness = createOrchestratorHarness({
        classify: ({ incomingText }) => ({
          decision: 'followup',
          confidence: 0.9,
          explanation: 'constraint refinement',
          latestIntentText: incomingText,
        }),
      });

      const first = expectStart(await harness.orchestrator.prepareRun({
        channel: 'telegram',
        conversationId: 'conv-14',
        userRequest: 'Check my calendar for next Friday and Saturday.',
      }));

      const steer = expectSkip(await harness.orchestrator.prepareRun({
        channel: 'telegram',
        conversationId: 'conv-14',
        userRequest: 'Also keep the response under 4 bullets and include timezone.',
      }));

      expect(steer.reason).toBe('steered_in_run');

      const state = harness.getState('telegram', 'conv-14');
      expect(state.queuedIntentText).toBeNull();
      expect(state.steerMailbox).toHaveLength(1);
      expect(state.steerMailbox[0]?.text).toBe(
        'Also keep the response under 4 bullets and include timezone.',
      );
    });
  });

  test('scenario 8: commit-boundary blocks steering and forces supersede restart', async () => {
    await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
      const harness = createOrchestratorHarness({
        classify: ({ incomingText }) => ({
          decision: 'ambiguous',
          confidence: 0.7,
          explanation: 'likely correction',
          latestIntentText: incomingText,
        }),
      });

      const first = expectStart(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-8',
        userRequest: 'Draft to Alex',
      }));

      await first.runContext.markRunPhase('commit_boundary');

      const incoming = expectStart(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-8',
        userRequest: 'actually, add a line about the deadline',
      }));

      expect(incoming.runContext.runId).not.toBe(first.runContext.runId);
      expect(await first.runContext.isRunCurrent()).toBe(false);
      expect(await incoming.runContext.isRunCurrent()).toBe(true);

      const blocked = harness.filterEvents('orchestrator.steer.blocked_commit_boundary');
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.payload.runId).toBe(first.runContext.runId);
      expect(blocked[0]?.payload.runPhase).toBe('commit_boundary');
    });
  });

  test('scenario 13: steering enqueue race recovers to queued followup instead of steered in-run', async () => {
    await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
      const harness = createOrchestratorHarness({
        classify: ({ incomingText }) => ({
          decision: 'ambiguous',
          confidence: 0.7,
          explanation: 'likely correction',
          latestIntentText: incomingText,
        }),
        beforeUpdate: ({ callCount, state }) => {
          // Simulate another worker replacing the run right before steer append.
          // Call #4 is the steer append update for the second inbound.
          if (callCount !== 4) return;
          return {
            ...state,
            activeRunId: 'run-replaced-by-peer',
            activeRevision: state.revision,
            activeRunPhase: 'running',
          };
        },
      });

      const first = expectStart(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-13',
        userRequest: 'Draft to Alex',
      }));

      const incoming = expectSkip(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-13',
        userRequest: 'actually, keep this very short',
      }));

      expect(incoming.reason).toBe('queued_followup');

      const state = harness.getState('twilio', 'conv-13');
      expect(state.queuedIntentText).toBe('actually, keep this very short');
      expect(state.steerMailbox).toHaveLength(0);

      const enqueued = harness.filterEvents('orchestrator.steer.enqueued');
      expect(enqueued).toHaveLength(0);
    });
  });

  test('scenario 9: steer mailbox caps and summarizes overflow deterministically', async () => {
    await withEnv({ EA_STEER_COOPERATIVE: 'true', EA_STEER_MAILBOX_CAP: '2' }, async () => {
      const harness = createOrchestratorHarness({
        classify: ({ incomingText }) => ({
          decision: 'ambiguous',
          confidence: 0.7,
          explanation: 'likely correction',
          latestIntentText: incomingText,
        }),
      });

      const first = expectStart(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-9',
        userRequest: 'Draft to Alex',
      }));

      for (const msg of ['msg-1', 'msg-2', 'msg-3', 'msg-4']) {
        const decision = expectSkip(await harness.orchestrator.prepareRun({
          channel: 'twilio',
          conversationId: 'conv-9',
          userRequest: msg,
        }));
        expect(decision.reason).toBe('steered_in_run');
      }

      const state = harness.getState('twilio', 'conv-9');
      expect(state.steerSeq).toBe(4);
      expect(state.steerMailbox).toHaveLength(2);
      expect(state.steerDroppedSummary).toHaveLength(2);
      expect(state.steerMailbox.map((e) => e.text)).toEqual(['msg-3', 'msg-4']);

      const consumed = await first.runContext.consumeSteerEvents(0);
      expect(consumed.events).toHaveLength(2);
      expect(consumed.droppedSummary).toHaveLength(2);
    });
  });
});

describe('Steering lifecycle events', () => {
  test('scenario 11: consuming mailbox emits steer.applied lifecycle event', async () => {
    await withEnv({ EA_STEER_COOPERATIVE: 'true' }, async () => {
      const harness = createOrchestratorHarness({
        classify: ({ incomingText }) => ({
          decision: 'ambiguous',
          confidence: 0.7,
          explanation: 'likely correction',
          latestIntentText: incomingText,
        }),
      });

      const first = expectStart(await harness.orchestrator.prepareRun({
        channel: 'twilio',
        conversationId: 'conv-11',
        userRequest: 'Draft to Alex',
      }));

      for (const msg of ['make it shorter', 'mention timeline']) {
        const decision = expectSkip(await harness.orchestrator.prepareRun({
          channel: 'twilio',
          conversationId: 'conv-11',
          userRequest: msg,
        }));
        expect(decision.reason).toBe('steered_in_run');
      }

      const consumed = await first.runContext.consumeSteerEvents(0);
      expect(consumed.events).toHaveLength(2);

      const applied = harness.filterEvents('orchestrator.steer.applied');
      expect(applied).toHaveLength(1);
      expect(applied[0]?.payload.runId).toBe(first.runContext.runId);
      expect(applied[0]?.payload.fromSeq).toBe(0);
      expect(applied[0]?.payload.toSeq).toBe(2);
      expect(applied[0]?.payload.appliedEvents).toBe(2);
      expect(applied[0]?.payload.appliedDroppedSummary).toBe(0);
    });
  });

  test('scenario 12: run phase transitions emit lifecycle events', async () => {
    const harness = createOrchestratorHarness();

    const first = expectStart(await harness.orchestrator.prepareRun({
      channel: 'twilio',
      conversationId: 'conv-12',
      userRequest: 'Draft to Alex',
    }));

    await first.runContext.markRunPhase('commit_boundary');
    await harness.orchestrator.finalizeRun({ runContext: first.runContext });

    const phaseEvents = harness.filterEvents('orchestrator.run.phase.changed');
    expect(phaseEvents).toHaveLength(2);

    expect(phaseEvents[0]?.payload.runId).toBe(first.runContext.runId);
    expect(phaseEvents[0]?.payload.fromPhase).toBe('running');
    expect(phaseEvents[0]?.payload.toPhase).toBe('commit_boundary');
    expect(phaseEvents[0]?.payload.reason).toBe('mark_run_phase');

    expect(phaseEvents[1]?.payload.runId).toBe(first.runContext.runId);
    expect(phaseEvents[1]?.payload.fromPhase).toBe('commit_boundary');
    expect(phaseEvents[1]?.payload.toPhase).toBe('completed');
    expect(phaseEvents[1]?.payload.reason).toBe('finalize_run');
  });
});

describe('Channel adapter parity', () => {
  test('scenario 10: telegram adapter path matches burst-steering behavior', async () => {
    const harness = createOrchestratorHarness({
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

    const first = expectStart(await harness.orchestrator.prepareRunWithAdapter({
      adapter,
      userRequest: 'Draft this update for the team',
    }));

    const correction = expectStart(await harness.orchestrator.prepareRunWithAdapter({
      adapter,
      userRequest: 'wait, include the deadline update',
    }));

    expect(await first.runContext.isRunCurrent()).toBe(false);
    expect(correction.runContext.channel).toBe('telegram');
  });
});
