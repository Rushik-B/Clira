import { InboxBackfillState } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import {
  parseInboxBackfillCursor,
  resolveInboxBackfillResume,
  serializeInboxBackfillCursor,
} from '@/lib/services/inbox-search/checkpoint';

describe('inbox-search checkpoint cursor helpers', () => {
  test('serializes and parses phase-aware cursors', () => {
    const serialized = serializeInboxBackfillCursor('seed', 'page-123');

    expect(serialized).toBe('seed:page-123');
    expect(parseInboxBackfillCursor(serialized)).toEqual({
      phase: 'seed',
      pageToken: 'page-123',
    });
  });

  test('resumes backfill from encoded cursor', () => {
    expect(
      resolveInboxBackfillResume({
        backfillState: InboxBackfillState.BACKFILLING,
        lastBackfillCursor: 'backfill:cursor-9',
      }),
    ).toEqual({
      phase: 'backfill',
      pageToken: 'cursor-9',
    });
  });

  test('defaults to seed when no cursor exists yet', () => {
    expect(
      resolveInboxBackfillResume({
        backfillState: InboxBackfillState.PENDING,
        lastBackfillCursor: null,
      }),
    ).toEqual({
      phase: 'seed',
    });
  });

  test('returns null when backfill is already complete', () => {
    expect(
      resolveInboxBackfillResume({
        backfillState: InboxBackfillState.COMPLETE,
        lastBackfillCursor: null,
      }),
    ).toBeNull();
  });
});
