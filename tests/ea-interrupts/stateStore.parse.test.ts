import { describe, expect, test } from 'vitest';
import { parseBurstState } from '@/lib/services/messaging-orchestration/stateStore';

describe('parseBurstState back-compat', () => {
  test('fills steering defaults when missing', () => {
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
    expect(parsed.burstId).toBe('burst-1');
    expect(parsed.activeRunPhase).toBe('running');
    expect(parsed.steerSeq).toBe(0);
    expect(parsed.steerMailbox).toEqual([]);
    expect(parsed.steerDroppedSummary).toEqual([]);
  });

  test('filters malformed steer mailbox entries', () => {
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
    expect(parsed.steerMailbox).toHaveLength(1);
    expect(parsed.steerMailbox[0]?.seq).toBe(1);
    expect(parsed.steerDroppedSummary).toHaveLength(1);
  });
});
