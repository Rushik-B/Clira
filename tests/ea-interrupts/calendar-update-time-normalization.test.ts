import { describe, expect, test } from 'vitest';
import {
  normalizeUpdateDraftTimesForPatch,
  validateEventDraftTimes,
} from '@/lib/ai/agents/executive-agent/helpers';
import type { CalendarEventDraftDTO } from '@/lib/ai/schemas/calendarCreatorSchemas';

describe('calendar update time normalization', () => {
  test('accepts an end-only timed update when the new end is after the current start in the event timezone', () => {
    const draft: CalendarEventDraftDTO = {
      end: {
        dateTime: '2026-03-14T18:40:00',
        timeZone: 'America/Los_Angeles',
      },
    };

    const result = normalizeUpdateDraftTimesForPatch({
      draft,
      currentEvent: {
        start: {
          dateTime: '2026-03-14T15:30:00Z',
          timeZone: 'America/Los_Angeles',
        },
        end: {
          dateTime: '2026-03-14T20:00:00Z',
          timeZone: 'America/Los_Angeles',
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      patch: draft,
    });
  });

  test('validates timed drafts using their explicit timezone instead of server-local parsing', () => {
    const validation = validateEventDraftTimes(
      {
        start: {
          dateTime: '2026-03-14T15:30:00',
          timeZone: 'America/Los_Angeles',
        },
        end: {
          dateTime: '2026-03-14T18:40:00',
          timeZone: 'America/Los_Angeles',
        },
      },
      'update',
    );

    expect(validation).toEqual({ ok: true });
  });

  test('preserves duration for start-only timed updates using timezone-aware instants', () => {
    const result = normalizeUpdateDraftTimesForPatch({
      draft: {
        start: {
          dateTime: '2026-03-14T16:00:00',
          timeZone: 'America/Los_Angeles',
        },
      },
      currentEvent: {
        start: {
          dateTime: '2026-03-14T15:30:00-07:00',
          timeZone: 'America/Los_Angeles',
        },
        end: {
          dateTime: '2026-03-14T20:00:00-07:00',
          timeZone: 'America/Los_Angeles',
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.patch).toEqual({
      start: {
        dateTime: '2026-03-14T16:00:00',
        timeZone: 'America/Los_Angeles',
      },
      end: {
        dateTime: '2026-03-15T03:30:00.000Z',
        timeZone: 'America/Los_Angeles',
      },
    });
  });
});
