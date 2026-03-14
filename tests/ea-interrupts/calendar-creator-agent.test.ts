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

    expect(result.action).toBe('create');
    expect(result.calendarId).toBe('work-cal');
    expect(result.userPreviewText).toContain('**Ready to add**');
    expect(result.userPreviewText).toContain('Reply **confirm** and I\'ll put it on your calendar.');
    expect(result.userPreviewText).toContain('in Work');
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

    expect(result.action).toBe('update');
    expect(result.target).toEqual({
      calendarId: 'work-cal',
      eventId: 'evt-1',
    });
    expect(result.userPreviewText).toBe(
      '**Ready to update**\n\n"March 16 shift" -> rename to "Work"\n\nReply **confirm** and I\'ll make that change.',
    );
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

    expect(result.action).toBe('delete');
    expect(result.userPreviewText).toContain('**Ready to delete 2 events**');
    expect(result.userPreviewText).toContain('"Work" on Mon, Mar 16 from 9 AM to 5 PM');
    expect(result.userPreviewText).toContain('"Work" on Tue, Mar 17 from 9 AM to 5 PM');
    expect(result.userPreviewText).toContain('Reply **confirm** and I\'ll delete them.');
  });
});
