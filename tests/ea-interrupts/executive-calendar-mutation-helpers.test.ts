import { describe, expect, test } from 'vitest';
import { parsePendingCalendarChangeRecord } from '@/lib/ai/agents/executiveCalendarMutationHelpers';

describe('pending calendar change parsing', () => {
  test('coerces legacy single-action update plans into bundle plans', () => {
    const parsed = parsePendingCalendarChangeRecord({
      plan: {
        action: 'update',
        confidence: 90,
        requiresConfirmation: true,
        sendUpdates: 'none',
        createMeetLink: false,
        calendarId: 'primary',
        target: {
          lookupQuery: 'Team sync',
        },
        eventDraft: {
          location: 'Zoom',
        },
        userPreviewText: 'preview',
      },
      resolvedTarget: {
        calendarId: 'work-cal',
        eventId: 'evt-1',
      },
      userTimezone: 'America/Vancouver',
      userRequest: 'move the sync to zoom',
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.plan.action).toBe('bundle');
    if (!parsed || parsed.plan.action !== 'bundle') {
      throw new Error('Expected bundle plan');
    }
    expect(parsed.plan.ops).toEqual([
      {
        kind: 'update',
        target: {
          calendarId: 'work-cal',
          eventId: 'evt-1',
        },
        eventDraft: {
          location: 'Zoom',
        },
        destinationCalendarId: undefined,
        createMeetLink: false,
      },
    ]);
  });
});
