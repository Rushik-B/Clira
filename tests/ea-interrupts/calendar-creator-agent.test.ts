import { beforeEach, describe, expect, test, vi } from 'vitest';

const llmMocks = vi.hoisted(() => ({
  callObject: vi.fn(),
}));

const promptMocks = vi.hoisted(() => ({
  readPromptFile: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  flash: vi.fn(),
}));

vi.mock('@/lib/ai/callLlm', () => ({
  callObject: llmMocks.callObject,
}));

vi.mock('@/lib/prompts', () => ({
  readPromptFile: promptMocks.readPromptFile,
}));

vi.mock('@/lib/ai/models', () => ({
  getGoogleThinkingProviderOptions: () => undefined,
  models: {
    flash: modelMocks.flash,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { runCalendarCreatorAgent } = await import('@/lib/ai/agents/calendarCreatorAgent');

describe('runCalendarCreatorAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    promptMocks.readPromptFile.mockReturnValue(
      [
        'UTC: {utcNow}',
        'Timezone: {userTimezone}',
        'Local now: {userLocalNow}',
        'Day: {dayOfWeek}',
        'Request: {userRequest}',
        'Calendars:',
        '{availableCalendars}',
        'Resolved events:',
        '{resolvedEvents}',
      ].join('\n'),
    );
    modelMocks.flash.mockReturnValue('gemini-calendar-creator');
  });

  test('builds a deterministic preview for create plans and resolves calendar names to ids', async () => {
    llmMocks.callObject.mockResolvedValue({
      object: {
        action: 'create',
        confidence: 92,
        calendarId: 'Work',
        createItems: [
          {
            summary: 'Shift',
            start: {
              dateTime: '2026-03-16T09:00:00-07:00',
              timeZone: 'America/Los_Angeles',
            },
            end: {
              dateTime: '2026-03-16T17:00:00-07:00',
              timeZone: 'America/Los_Angeles',
            },
          },
        ],
      },
    });

    const result = await runCalendarCreatorAgent(
      {
        request: 'create a shift on my Work calendar',
      },
      {
        currentTime: {
          utcNow: '2026-03-13T21:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-13T14:00:00',
          dayOfWeek: 'Friday',
        },
        availableCalendars: [
          {
            id: 'primary',
            summary: 'Personal',
            primary: true,
            accessRole: 'owner',
          },
          {
            id: 'work-cal',
            summary: 'Work',
            primary: false,
            accessRole: 'writer',
          },
        ],
      },
    );

    expect(result.action).toBe('bundle');
    expect(result.calendarId).toBe('work-cal');
    expect(result.userPreviewText).toContain('**Ready to add**');
    expect(result.userPreviewText).toContain('Reply **confirm** and I\'ll put it on your calendar.');
    expect(result.userPreviewText).toContain('in Work');
  });

  test('formats create previews using the draft timezone when dateTime has no offset', async () => {
    llmMocks.callObject.mockResolvedValue({
      object: {
        action: 'create',
        confidence: 92,
        calendarId: 'Work',
        createItems: [
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
        ],
      },
    });

    const result = await runCalendarCreatorAgent(
      {
        request: 'add my meeting with Veetesh to the Work calendar',
      },
      {
        currentTime: {
          utcNow: '2026-03-13T21:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-13T14:00:00',
          dayOfWeek: 'Friday',
        },
        availableCalendars: [
          {
            id: 'work-cal',
            summary: 'Work',
            primary: false,
            accessRole: 'writer',
          },
        ],
      },
    );

    expect(result.userPreviewText).toContain('"Meeting with Veetesh" on Mar 18, 7 PM to Mar 18, 8 PM in Work');
  });

  test('resolves pre-resolved update targets to event ids and generates a deterministic preview', async () => {
    llmMocks.callObject.mockResolvedValue({
      object: {
        action: 'update',
        confidence: 88,
        updateItems: [
          {
            target: {
              lookupQuery: 'March 16 shift',
            },
            eventDraft: {
              summary: 'Work',
            },
          },
        ],
      },
    });

    const result = await runCalendarCreatorAgent(
      {
        request: 'rename my March 16 shift to Work',
      },
      {
        currentTime: {
          utcNow: '2026-03-13T21:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-13T14:00:00',
          dayOfWeek: 'Friday',
        },
        resolvedEvents: [
          {
            eventId: 'evt-1',
            calendarId: 'work-cal',
            name: 'March 16 shift',
            start: '2026-03-16T09:00:00-07:00',
            end: '2026-03-16T17:00:00-07:00',
          },
        ],
      },
    );

    expect(result.action).toBe('bundle');
    if (result.action !== 'bundle') {
      throw new Error('Expected bundle result');
    }
    expect(result.ops[0]).toMatchObject({
      kind: 'update',
      target: {
        calendarId: 'work-cal',
        eventId: 'evt-1',
      },
    });
    expect(result.userPreviewText).toBe(
      '**Ready to update**\n\n"March 16 shift" -> rename to "Work"\n\nReply **confirm** and I\'ll make that change.',
    );
  });

  test('keeps broad field categories distinct in update previews', async () => {
    llmMocks.callObject.mockResolvedValue({
      object: {
        action: 'update',
        confidence: 91,
        updateItems: [
          {
            target: {
              eventId: 'evt-1',
              calendarId: 'personal-cal',
            },
            eventDraft: {
              location: 'AQ 3145',
              description: 'Bring calculator and student ID.',
              reminders: {
                useDefault: false,
                overrides: [{ method: 'popup', minutes: 60 }],
              },
            },
            destinationCalendarId: 'Work',
          },
        ],
      },
    });

    const result = await runCalendarCreatorAgent(
      {
        request: 'move this to my Work calendar, change the room to AQ 3145, add notes, and set a reminder',
      },
      {
        currentTime: {
          utcNow: '2026-03-13T21:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-13T14:00:00',
          dayOfWeek: 'Friday',
        },
        availableCalendars: [
          {
            id: 'personal-cal',
            summary: 'Personal',
            primary: true,
            accessRole: 'owner',
          },
          {
            id: 'work-cal',
            summary: 'Work',
            primary: false,
            accessRole: 'writer',
          },
        ],
        resolvedEvents: [
          {
            eventId: 'evt-1',
            calendarId: 'personal-cal',
            name: 'Office Hours',
            start: '2026-03-16T09:00:00-07:00',
            end: '2026-03-16T10:00:00-07:00',
          },
        ],
      },
    );

    expect(result.action).toBe('bundle');
    if (result.action !== 'bundle') {
      throw new Error('Expected bundle result');
    }
    expect(result.ops[0]).toMatchObject({
      kind: 'update',
      destinationCalendarId: 'work-cal',
    });
    expect(result.userPreviewText).toContain('set location to "AQ 3145"');
    expect(result.userPreviewText).toContain('update notes');
    expect(result.userPreviewText).toContain('update reminders');
    expect(result.userPreviewText).toContain('move to Work');
  });

  test('treats Google Meet links as a distinct update capability', async () => {
    llmMocks.callObject.mockResolvedValue({
      object: {
        action: 'update',
        confidence: 87,
        createMeetLink: true,
        updateItems: [
          {
            target: {
              eventId: 'evt-1',
              calendarId: 'personal-cal',
            },
            eventDraft: {},
          },
        ],
      },
    });

    const result = await runCalendarCreatorAgent(
      {
        request: 'add a Google Meet link to this event',
      },
      {
        currentTime: {
          utcNow: '2026-03-13T21:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-13T14:00:00',
          dayOfWeek: 'Friday',
        },
        availableCalendars: [
          {
            id: 'personal-cal',
            summary: 'Personal',
            primary: true,
            accessRole: 'owner',
          },
        ],
        resolvedEvents: [
          {
            eventId: 'evt-1',
            calendarId: 'personal-cal',
            name: 'Office Hours',
            start: '2026-03-16T09:00:00-07:00',
            end: '2026-03-16T10:00:00-07:00',
          },
        ],
      },
    );

    expect(result.action).toBe('bundle');
    if (result.action !== 'bundle') {
      throw new Error('Expected bundle result');
    }
    expect(result.ops[0]).toMatchObject({
      kind: 'update',
      createMeetLink: true,
    });
    expect(result.userPreviewText).toContain('add Google Meet link');
  });

  test('asks to clarify when a calendar-container request is expressed as a location update', async () => {
    llmMocks.callObject.mockResolvedValue({
      object: {
        action: 'update',
        confidence: 80,
        updateItems: [
          {
            target: {
              eventId: 'evt-1',
              calendarId: 'personal-cal',
            },
            eventDraft: {
              location: 'Moved to Work calendar',
            },
          },
        ],
      },
    });

    const result = await runCalendarCreatorAgent(
      {
        request: 'this event is in the wrong calendar',
      },
      {
        currentTime: {
          utcNow: '2026-03-13T21:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-13T14:00:00',
          dayOfWeek: 'Friday',
        },
        availableCalendars: [
          {
            id: 'personal-cal',
            summary: 'Personal',
            primary: true,
            accessRole: 'owner',
          },
          {
            id: 'work-cal',
            summary: 'Work',
            primary: false,
            accessRole: 'writer',
          },
        ],
      },
    );

    expect(result.action).toBe('clarify');
    expect(result.userPreviewText).toContain('calendar');
    expect(result.userPreviewText).not.toContain('location');
  });

  test('builds a specific deletion preview when multiple resolved events share the same title', async () => {
    llmMocks.callObject.mockResolvedValue({
      object: {
        action: 'delete',
        confidence: 93,
        deleteTargets: [
          {
            eventId: 'evt-1',
            calendarId: 'work-cal',
          },
          {
            eventId: 'evt-2',
            calendarId: 'work-cal',
          },
        ],
      },
    });

    const result = await runCalendarCreatorAgent(
      {
        request: 'delete my shifts next week',
      },
      {
        currentTime: {
          utcNow: '2026-03-13T21:00:00.000Z',
          userTimezone: 'America/Los_Angeles',
          userLocalNow: '2026-03-13T14:00:00',
          dayOfWeek: 'Friday',
        },
        resolvedEvents: [
          {
            eventId: 'evt-1',
            calendarId: 'work-cal',
            name: 'Work',
            start: '2026-03-16T09:00:00-07:00',
            end: '2026-03-16T17:00:00-07:00',
          },
          {
            eventId: 'evt-2',
            calendarId: 'work-cal',
            name: 'Work',
            start: '2026-03-17T09:00:00-07:00',
            end: '2026-03-17T17:00:00-07:00',
          },
        ],
      },
    );

    expect(result.action).toBe('bundle');
    expect(result.userPreviewText).toContain('**Ready to delete 2 events**');
    expect(result.userPreviewText).toContain('"Work" on Mon, Mar 16 from 9 AM to 5 PM');
    expect(result.userPreviewText).toContain('"Work" on Tue, Mar 17 from 9 AM to 5 PM');
    expect(result.userPreviewText).toContain('Reply **confirm** and I\'ll delete them.');
  });
});
