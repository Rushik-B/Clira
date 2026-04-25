import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getServerSessionMock,
  userSettingsFindUniqueMock,
  userSettingsUpsertMock,
  oauthAccountFindFirstMock,
  calendarServiceCreateMock,
  resolveCalendarTimezoneForUserMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userSettingsFindUniqueMock: vi.fn(),
  userSettingsUpsertMock: vi.fn(),
  oauthAccountFindFirstMock: vi.fn(),
  calendarServiceCreateMock: vi.fn(),
  resolveCalendarTimezoneForUserMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth/auth', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSettings: {
      findUnique: userSettingsFindUniqueMock,
      upsert: userSettingsUpsertMock,
    },
    oAuthAccount: {
      findFirst: oauthAccountFindFirstMock,
    },
  },
}));

vi.mock('@/lib/services/core/calendarService', () => ({
  CalendarService: {
    create: calendarServiceCreateMock,
  },
}));

vi.mock('@/lib/services/calendarTimezone', () => ({
  resolveCalendarTimezoneForUser: resolveCalendarTimezoneForUserMock,
}));

import { GET, POST } from '@/app/api/settings/calendar/route';

describe('calendar settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ userId: 'user-1' });
    userSettingsFindUniqueMock.mockResolvedValue({
      calendarTimezone: 'America/Los_Angeles',
      calendarContextCalendarIds: ['primary'],
    });
    userSettingsUpsertMock.mockResolvedValue({
      calendarTimezone: 'Asia/Kolkata',
      calendarContextCalendarIds: ['primary', 'work'],
    });
    oauthAccountFindFirstMock.mockResolvedValue({
      scope: 'https://www.googleapis.com/auth/calendar.events',
    });
    calendarServiceCreateMock.mockResolvedValue({
      listCalendars: vi.fn().mockResolvedValue([
        { id: 'primary', summary: 'Primary', primary: true, timeZone: 'Asia/Kolkata' },
      ]),
    });
    resolveCalendarTimezoneForUserMock.mockResolvedValue({
      timeZone: 'Asia/Kolkata',
      source: 'google_primary_calendar',
    });
  });

  test('GET returns timezone source metadata from resolver', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      settings: {
        calendarTimezone: 'Asia/Kolkata',
        calendarTimezoneSource: 'google_primary_calendar',
        calendarTimezoneDegradedReason: null,
        calendarContextCalendarIds: ['primary'],
      },
    });
  });

  test('POST rejects malformed selected calendar payload', async () => {
    const request = new Request('http://localhost/api/settings/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedCalendarIds: 'primary' }),
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('INVALID_CALENDAR_SETTINGS');
    expect(userSettingsUpsertMock).not.toHaveBeenCalled();
  });

  test('POST saves selected calendars with Google-derived timezone', async () => {
    const request = new Request('http://localhost/api/settings/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarTimezone: 'America/New_York',
        selectedCalendarIds: ['primary', 'work', 'primary'],
      }),
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(userSettingsUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          calendarTimezone: 'Asia/Kolkata',
          calendarContextCalendarIds: ['primary', 'work'],
        },
      }),
    );
    expect(payload).toMatchObject({
      success: true,
      settings: {
        calendarTimezone: 'Asia/Kolkata',
        calendarTimezoneSource: 'google_primary_calendar',
        calendarContextCalendarIds: ['primary', 'work'],
      },
    });
  });
});
