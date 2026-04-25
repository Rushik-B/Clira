import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { CalendarService } from '@/lib/services/core/calendarService';
import { REQUIRED_SCOPES } from '@/lib/auth/scope-utils';
import { resolveCalendarTimezoneForUser } from '@/lib/services/calendarTimezone';
import { z } from 'zod';

const updateCalendarSettingsSchema = z.object({
  selectedCalendarIds: z.array(z.string().trim().min(1)).optional().default([]),
});

// GET: return available calendars + current preferences
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load user settings (may be null for new users)
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId: session.userId },
      select: {
        calendarTimezone: true,
        calendarContextCalendarIds: true,
      },
    });

    const oauthAccount = await prisma.oAuthAccount.findFirst({
      where: { userId: session.userId, provider: 'google' },
      select: { scope: true },
    });
    const rawScopes = oauthAccount?.scope ?? '';
    const userScopes = rawScopes.split(' ').filter(Boolean);
    const hasCalendarWriteAccess = userScopes.includes(REQUIRED_SCOPES.CALENDAR_EVENTS);

    // Attempt to fetch calendars from Google; if this fails, we still return preferences
    let calendars: Array<{ id: string; summary: string; primary: boolean; timeZone?: string }> = [];
    try {
      const calendarService = await CalendarService.create({
        userId: session.userId,
        purpose: 'settings:calendar-list',
        requester: 'settings/calendar/GET',
      });

      if (calendarService) {
        calendars = await calendarService.listCalendars();
      }
    } catch (err) {
      console.error('⚠️ Failed to load calendar list for settings:', err);
    }

    const resolvedTimezone = await resolveCalendarTimezoneForUser(session.userId);

    return NextResponse.json({
      success: true,
      calendars,
      hasCalendarWriteAccess,
      settings: {
        calendarTimezone: resolvedTimezone.timeZone,
        calendarTimezoneSource: resolvedTimezone.source,
        calendarTimezoneDegradedReason: resolvedTimezone.degradedReason ?? null,
        calendarContextCalendarIds: userSettings?.calendarContextCalendarIds ?? [],
      },
    });
  } catch (error) {
    console.error('Error fetching calendar settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar settings' },
      { status: 500 },
    );
  }
}

// POST: update selected calendars. Timezone is derived from the user's primary Google Calendar.
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = updateCalendarSettingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_CALENDAR_SETTINGS', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const resolvedTimezone = await resolveCalendarTimezoneForUser(session.userId);
    const safeCalendarIds = [...new Set(parsed.data.selectedCalendarIds)];

    const updated = await prisma.userSettings.upsert({
      where: { userId: session.userId },
      update: {
        calendarTimezone: resolvedTimezone.timeZone,
        calendarContextCalendarIds: safeCalendarIds,
      },
      create: {
        userId: session.userId,
        autonomyLevel: 0,
        replyScope: 'ALL_SENDERS',
        enablePushNotifications: true,
        preferencesSaved: true,
        autoFileLowPriority: 50,
        autoSendConfidence: 95,
        calendarTimezone: resolvedTimezone.timeZone,
        calendarContextCalendarIds: safeCalendarIds,
      },
    });

    return NextResponse.json({
      success: true,
      settings: {
        calendarTimezone: updated.calendarTimezone,
        calendarTimezoneSource: resolvedTimezone.source,
        calendarTimezoneDegradedReason: resolvedTimezone.degradedReason ?? null,
        calendarContextCalendarIds: updated.calendarContextCalendarIds,
      },
    });
  } catch (error) {
    console.error('Error updating calendar settings:', error);
    return NextResponse.json(
      { error: 'Failed to update calendar settings' },
      { status: 500 },
    );
  }
}
