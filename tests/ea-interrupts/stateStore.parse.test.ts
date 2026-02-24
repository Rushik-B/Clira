import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseBurstState,
} from '@/lib/services/messaging-orchestration/stateStore';

test('parseBurstState back-compat fills steering defaults when missing', () => {
  const raw = JSON.stringify({
    burstId: 'burst-1',
    activeRunId: null,
    activeRevision: null,
    revision: 12,
    windowEndsAt: 0,
    pendingCount: 0,
    droppedSummary: [],
    latestIntentText: 'hello',
    classifierDecision: null,
    queuedIntentText: null,
    queuedRevision: null,
    updatedAt: 0,
  });

  const parsed = parseBurstState(raw);
  assert.equal(parsed.burstId, 'burst-1');
  assert.equal(parsed.activeRunPhase, 'running');
  assert.equal(parsed.steerSeq, 0);
  assert.deepEqual(parsed.steerMailbox, []);
  assert.deepEqual(parsed.steerDroppedSummary, []);
});

test('parseBurstState filters malformed steer mailbox entries', () => {
  const raw = JSON.stringify({
    burstId: 'burst-2',
    activeRunId: 'run-1',
    activeRevision: 5,
    activeRunPhase: 'running',
    revision: 6,
    windowEndsAt: 0,
    pendingCount: 0,
    droppedSummary: [],
    latestIntentText: 'hello',
    classifierDecision: 'ambiguous',
    queuedIntentText: null,
    queuedRevision: null,
    steerSeq: 2,
    steerMailbox: [
      {
        seq: 1,
        revision: 6,
        receivedAt: 123,
        text: 'ok',
        decision: 'ambiguous',
        confidence: 0.7,
      },
      { seq: 'bad' },
      null,
    ],
    steerDroppedSummary: ['dropped'],
    updatedAt: 0,
  });

  const parsed = parseBurstState(raw);
  assert.equal(parsed.steerMailbox.length, 1);
  assert.equal(parsed.steerMailbox[0]?.seq, 1);
  assert.equal(parsed.steerDroppedSummary.length, 1);
});

