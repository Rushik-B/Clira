import { describe, expect, test } from 'vitest';
import { mapLlmOutputToPlan } from '@/lib/ai/agents/calendar-creator/normalize';

describe('calendar creator normalization', () => {
  test('does not resolve a pre-resolved event outside the user-local lookup day', () => {
    const plan = mapLlmOutputToPlan(
      {
        action: 'update',
        confidence: 90,
        updateItems: [
          {
            target: {
              lookupQuery: 'Work',
              lookupRange: {
                startDate: '2026-03-18',
                endDate: '2026-03-18',
              },
            },
            eventDraft: {
              summary: 'Work',
            },
          },
        ],
      },
      {
        request: 'rename my work event on March 18',
        currentTime: {
          utcNow: '2026-03-17T18:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-17T11:00:00',
          dayOfWeek: 'Tuesday',
        },
        resolvedEvents: [
          {
            eventId: 'evt-1',
            calendarId: 'work-cal',
            name: 'Work',
            start: '2026-03-18T01:00:00Z',
            end: '2026-03-18T02:00:00Z',
          },
        ],
      },
    );

    expect(plan.action).toBe('bundle');
    if (plan.action !== 'bundle') {
      throw new Error('Expected bundle plan');
    }
    expect(plan.ops[0]).toMatchObject({
      kind: 'update',
      target: {
        lookupQuery: 'Work',
        lookupRange: {
          startDate: '2026-03-18',
          endDate: '2026-03-18',
        },
      },
    });
  });
});
