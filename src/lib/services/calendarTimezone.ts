import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { CalendarService } from '@/lib/services/core/calendarService';

export type CalendarTimezoneSource =
  | 'google_primary_calendar'
  | 'cached_user_settings'
  | 'default';

export type ResolvedCalendarTimezone = {
  timeZone: string;
  source: CalendarTimezoneSource;
  degradedReason?: string;
};

export function isValidIanaTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function getCachedUserTimezone(userId: string): Promise<string | null> {
  const userSettings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { calendarTimezone: true },
  });

  return isValidIanaTimeZone(userSettings?.calendarTimezone)
    ? userSettings.calendarTimezone
    : null;
}

async function cacheResolvedTimezone(userId: string, timeZone: string): Promise<void> {
  await prisma.userSettings.upsert({
    where: { userId },
    update: { calendarTimezone: timeZone },
    create: {
      userId,
      autonomyLevel: 0,
      replyScope: 'ALL_SENDERS',
      enablePushNotifications: true,
      preferencesSaved: false,
      autoFileLowPriority: 50,
      autoSendConfidence: 95,
      calendarTimezone: timeZone,
      calendarContextCalendarIds: [],
    },
  });
}

export async function resolveCalendarTimezoneForUser(userId: string): Promise<ResolvedCalendarTimezone> {
  try {
    const calendarService = await CalendarService.create({
      userId,
      purpose: 'calendar-timezone:resolve-primary',
      requester: 'calendarTimezone.resolveCalendarTimezoneForUser',
    });

    if (calendarService) {
      const calendars = await calendarService.listCalendars();
      const primary = calendars.find((calendar) => calendar.primary);
      const primaryTimeZone = primary?.timeZone;

      if (isValidIanaTimeZone(primaryTimeZone)) {
        await cacheResolvedTimezone(userId, primaryTimeZone);
        return {
          timeZone: primaryTimeZone,
          source: 'google_primary_calendar',
        };
      }

      logger.warn('[calendarTimezone] Primary Google Calendar did not expose a valid timezone', {
        userId,
        primaryCalendarId: primary?.id,
        primaryTimeZone,
      });
    }
  } catch (error) {
    logger.warn('[calendarTimezone] Failed to resolve timezone from Google Calendar', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const cached = await getCachedUserTimezone(userId);
  if (cached) {
    return {
      timeZone: cached,
      source: 'cached_user_settings',
      degradedReason: 'google_primary_calendar_unavailable',
    };
  }

  return {
    timeZone: DEFAULT_CALENDAR_TIMEZONE,
    source: 'default',
    degradedReason: 'google_primary_calendar_and_cached_timezone_unavailable',
  };
}
