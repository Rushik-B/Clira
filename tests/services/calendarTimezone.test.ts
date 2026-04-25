import { beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveCalendarTimezoneForUser } from '@/lib/services/calendarTimezone';

const mockListCalendars = vi.fn();

vi.mock('@/lib/services/core/calendarService', () => ({
  CalendarService: {
    create: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('resolveCalendarTimezoneForUser', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { CalendarService } = await import('@/lib/services/core/calendarService');
    const { prisma } = await import('@/lib/prisma');

    vi.mocked(CalendarService.create).mockResolvedValue({
      listCalendars: mockListCalendars,
    } as never);
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.userSettings.upsert).mockResolvedValue({} as never);
  });

  test('uses primary Google Calendar timezone and caches it', async () => {
    const { prisma } = await import('@/lib/prisma');
    mockListCalendars.mockResolvedValue([
      { id: 'secondary', summary: 'Work', primary: false, accessRole: 'owner', timeZone: 'America/Vancouver' },
      { id: 'primary', summary: 'Rushik', primary: true, accessRole: 'owner', timeZone: 'Asia/Kolkata' },
    ]);

    const resolved = await resolveCalendarTimezoneForUser('user-1');

    expect(resolved).toEqual({
      timeZone: 'Asia/Kolkata',
      source: 'google_primary_calendar',
    });
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: { calendarTimezone: 'Asia/Kolkata' },
      }),
    );
  });

  test('falls back to cached settings when Google Calendar is unavailable', async () => {
    const { CalendarService } = await import('@/lib/services/core/calendarService');
    const { prisma } = await import('@/lib/prisma');

    vi.mocked(CalendarService.create).mockRejectedValue(new Error('calendar unavailable'));
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({
      calendarTimezone: 'America/Los_Angeles',
    } as never);

    const resolved = await resolveCalendarTimezoneForUser('user-1');

    expect(resolved).toEqual({
      timeZone: 'America/Los_Angeles',
      source: 'cached_user_settings',
      degradedReason: 'google_primary_calendar_unavailable',
    });
  });
});
