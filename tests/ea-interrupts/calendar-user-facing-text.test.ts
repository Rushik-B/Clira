import { describe, expect, test } from 'vitest';
import {
  buildCalendarCompletionMessage,
  buildCalendarPreviewMessage,
  describeGoogleCalendarEvent,
  describeResolvedCalendarEvent,
} from '@/lib/ai/calendar-user-facing';

describe('calendar user-facing text', () => {
  test('formats resolved events with date and time for deletion previews', () => {
    const item = describeResolvedCalendarEvent(
      {
        name: 'Work',
        start: '2026-03-16T09:00:00-07:00',
        end: '2026-03-16T17:00:00-07:00',
      },
      'America/Los_Angeles',
    );

    const preview = buildCalendarPreviewMessage('delete', [item]);

    expect(preview).toBe(
      '**Ready to delete**\n\n"Work" on Mon, Mar 16 from 9 AM to 5 PM\n\nReply **confirm** and I\'ll delete it.',
    );
  });

  test('formats Google all-day events with an inclusive end date in completion text', () => {
    const item = describeGoogleCalendarEvent(
      {
        summary: 'Trip',
        start: { date: '2026-03-20' },
        end: { date: '2026-03-23' },
      },
      'America/Los_Angeles',
    );

    expect(buildCalendarCompletionMessage({ action: 'delete', items: [item] })).toBe(
      '**All set.**\n\nDeleted "Trip" from Fri, Mar 20 to Sun, Mar 22 (all day).',
    );
  });

  test('formats Google timed events using the event timezone when dateTime has no offset', () => {
    const item = describeGoogleCalendarEvent(
      {
        summary: 'Meeting with Veetesh',
        start: {
          dateTime: '2026-03-18T19:00:00',
          timeZone: 'America/Los_Angeles',
        },
        end: {
          dateTime: '2026-03-18T20:00:00',
          timeZone: 'America/Los_Angeles',
        },
      },
      'UTC',
    );

    expect(item).toBe('"Meeting with Veetesh" on Wed, Mar 18 from 7 PM to 8 PM');
  });

  test('builds a conversational completion message for multiple events', () => {
    const message = buildCalendarCompletionMessage({
      action: 'delete',
      items: [
        '"Work" on Mon, Mar 16 from 9 AM to 5 PM',
        '"Work" on Tue, Mar 17 from 9 AM to 5 PM',
      ],
    });

    expect(message).toBe(
      '**All set.**\n\nI deleted these 2 events:\n\n' +
      '1) "Work" on Mon, Mar 16 from 9 AM to 5 PM\n' +
      '2) "Work" on Tue, Mar 17 from 9 AM to 5 PM',
    );
  });
});
