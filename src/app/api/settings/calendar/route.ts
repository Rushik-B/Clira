import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { CalendarService } from '@/lib/services/core/calendarService';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { REQUIRED_SCOPES } from '@/lib/auth/scope-utils';

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

    return NextResponse.json({
      success: true,
      calendars,
      hasCalendarWriteAccess,
      settings: {
        calendarTimezone: userSettings?.calendarTimezone ?? DEFAULT_CALENDAR_TIMEZONE,
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

// POST: update selected calendars + timezone
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { calendarTimezone, selectedCalendarIds } = body as {
      calendarTimezone?: string;
      selectedCalendarIds?: string[];
    };

    // Basic validation
    if (calendarTimezone && typeof calendarTimezone !== 'string') {
      return NextResponse.json(
      { error: 'calendarTimezone must be a string (IANA timezone like "America/Los_Angeles")' },
        { status: 400 },
      );
    }

    if (selectedCalendarIds && !Array.isArray(selectedCalendarIds)) {
      return NextResponse.json(
        { error: 'selectedCalendarIds must be an array of calendar IDs' },
        { status: 400 },
      );
    }

    // Normalize input
    const safeTimezone = calendarTimezone || DEFAULT_CALENDAR_TIMEZONE;
    const safeCalendarIds = (selectedCalendarIds || []).filter(
      (id: unknown): id is string => typeof id === 'string' && id.length > 0,
    );

    const updated = await prisma.userSettings.upsert({
      where: { userId: session.userId },
      update: {
        calendarTimezone: safeTimezone,
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
        calendarTimezone: safeTimezone,
        calendarContextCalendarIds: safeCalendarIds,
      },
    });

    return NextResponse.json({
      success: true,
      settings: {
        calendarTimezone: updated.calendarTimezone,
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


