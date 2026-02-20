import { google } from 'googleapis';
import { CalendarEvent, CalendarAvailability } from '../../../types';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { GmailService } from '@/lib/email/gmail';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { startOfDayInTimezone, endOfDayInTimezone, getZonedTimeComponents } from '@/lib/utils/timezone';

const CALENDAR_RETRY_MAX_ATTEMPTS = 3;
const CALENDAR_RETRY_BASE_DELAY_MS = 500;

const VALID_RESPONSE_STATUSES = ['needsAction', 'declined', 'tentative', 'accepted'] as const;
type ResponseStatus = (typeof VALID_RESPONSE_STATUSES)[number];

function toResponseStatus(
  s: string | null | undefined,
): ResponseStatus | undefined {
  if (!s || !VALID_RESPONSE_STATUSES.includes(s as ResponseStatus)) return undefined;
  return s as ResponseStatus;
}

type CalendarMutationEvent = {
  calendarId: string;
  eventId: string;
  etag?: string;
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  location?: string;
};

export class CalendarService {
  private calendar: ReturnType<typeof google.calendar>;
  private gmailService: GmailService;
  private userId: string;

  private constructor({
    calendar,
    gmailService,
    userId,
  }: {
    calendar: ReturnType<typeof google.calendar>;
    gmailService: GmailService;
    userId: string;
  }) {
    this.calendar = calendar;
    this.gmailService = gmailService;
    this.userId = userId;
  }

  static async create({
    userId,
    purpose,
    requester,
  }: {
    userId: string;
    purpose: string;
    requester: string;
  }): Promise<CalendarService | null> {
    const context = await createGmailServiceForUser({
      userId,
      purpose,
      requester,
      includeRefreshToken: true,
    });

    if (!context) {
      return null;
    }

    await context.gmail.ensureAuthenticated();

    const calendar = google.calendar({
      version: 'v3',
      auth: context.gmail.getOAuthClient(),
    });

    return new CalendarService({
      calendar,
      gmailService: context.gmail,
      userId,
    });
  }

  private async ensureAuthenticated(): Promise<void> {
    await this.gmailService.ensureAuthenticated();
  }

  private async backoffDelay(attempt: number): Promise<void> {
    const jitter = Math.floor(Math.random() * 150);
    const delay = Math.min(4_000, CALENDAR_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)) + jitter;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private shouldRetryStatus(status?: number): boolean {
    if (!status) return false;
    return status === 429 || status >= 500;
  }

  private async executeCalendarRequest<T>(
    operation: string,
    fn: () => Promise<T>,
    attempt = 1,
  ): Promise<T> {
    try {
      await this.ensureAuthenticated();
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status as number | undefined;

      if (status === 401 && attempt < CALENDAR_RETRY_MAX_ATTEMPTS) {
        await this.ensureAuthenticated();
        return this.executeCalendarRequest(operation, fn, attempt + 1);
      }

      if (this.shouldRetryStatus(status) && attempt < CALENDAR_RETRY_MAX_ATTEMPTS) {
        console.warn(`[calendar] 🔁 retrying ${operation} (status=${status}) attempt=${attempt + 1}`);
        await this.backoffDelay(attempt);
        return this.executeCalendarRequest(operation, fn, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * List calendars available for this user.
   * @param options.minAccessRole - Minimum access role filter (default: none).
   *   Use 'writer' to only return calendars the user can create events in.
   */
  async listCalendars(options?: {
    minAccessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  }): Promise<
    Array<{
      id: string;
      summary: string;
      primary: boolean;
      accessRole: string;
      timeZone?: string;
    }>
  > {
    return this.executeCalendarRequest('calendarList.list', async () => {
      const response = await this.calendar.calendarList.list({
        maxResults: 50,
        minAccessRole: options?.minAccessRole,
      });

      const items = response.data.items || [];

      return items
        .filter((item) => !!item.id)
        .map((item) => ({
          id: item.id as string,
          summary: item.summary || '(No title)',
          primary: Boolean(item.primary),
          accessRole: item.accessRole || 'reader',
          timeZone: item.timeZone || undefined,
        }));
    });
  }

  /**
   * Helper to format date for readable logs
   */
  private formatDateForLog(date: Date): string {
    const formatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return formatter.format(date);
  }

  /**
   * Get events within a date range
   */
  async getEvents(
    startDate: Date,
    endDate: Date,
    maxResults: number = 50,
    retry: boolean = true,
    options?: {
      calendarIds?: string[];
      timeZone?: string;
    },
  ): Promise<CalendarEvent[]> {
    try {
      const calendarIds =
        options?.calendarIds && options.calendarIds.length > 0
          ? options.calendarIds
          : ['primary'];

      const allEvents: CalendarEvent[] = [];
      const calendarCounts: Array<{ id: string; count: number }> = [];

      // Format date range for display
      const dateRange = `${this.formatDateForLog(startDate)} → ${this.formatDateForLog(endDate)}`;

      for (const calendarId of calendarIds) {
        const response = await this.executeCalendarRequest('events.list', () =>
          this.calendar.events.list({
            calendarId,
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            maxResults,
            singleEvents: true,
            orderBy: 'startTime',
          }),
        );

        const events = response.data.items || [];
        calendarCounts.push({ id: calendarId, count: events.length });

        const parsed = events
          .map((event) => this.parseCalendarEvent(event))
          .filter(Boolean) as CalendarEvent[];

        allEvents.push(...parsed);
      }

      // Sort merged events by start date/time
      allEvents.sort((a, b) => {
        const aTime = new Date(a.start.dateTime).getTime();
        const bTime = new Date(b.start.dateTime).getTime();
        return aTime - bTime;
      });

      // Log in a cleaner format
      if (calendarIds.length === 1) {
        console.log(
          `[calendar] 📅 ${dateRange} | ${allEvents.length} event${allEvents.length !== 1 ? 's' : ''}`,
        );
      } else {
        const countsSummary = calendarCounts
          .map((c) => `${c.count}`)
          .join('+');
        console.log(
          `[calendar] 📅 ${dateRange} | ${calendarIds.length} calendar${calendarIds.length !== 1 ? 's' : ''} (${countsSummary}) = ${allEvents.length} total`,
        );
      }

      return allEvents;
    } catch (error: any) {
      if (error.response?.status === 401 && retry) {
        console.log('[calendar] 🔄 Token expired, attempting refresh...');
        await this.ensureAuthenticated();
        return this.getEvents(startDate, endDate, maxResults, false);
      }
      console.error('❌ Error fetching calendar events:', error);
      throw error;
    }
  }

  async listEventsForMutation(
    startDate: Date,
    endDate: Date,
    maxResults: number = 100,
    options?: {
      calendarIds?: string[];
      timeZone?: string;
    },
  ): Promise<CalendarMutationEvent[]> {
    const calendarIds =
      options?.calendarIds && options.calendarIds.length > 0 ? options.calendarIds : ['primary'];

    const allEvents: CalendarMutationEvent[] = [];

    for (const calendarId of calendarIds) {
      const response = await this.executeCalendarRequest('events.list', () =>
        this.calendar.events.list({
          calendarId,
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        }),
      );

      const events = response.data.items || [];

      for (const event of events) {
        if (!event.id || !event.start || !event.end) continue;

        const startDateTime = event.start.dateTime || event.start.date;
        const endDateTime = event.end.dateTime || event.end.date;
        if (!startDateTime || !endDateTime) continue;

        allEvents.push({
          calendarId,
          eventId: event.id,
          etag: event.etag ?? undefined,
          summary: event.summary || '(No title)',
          description: event.description ?? undefined,
          start: {
            dateTime: startDateTime,
            timeZone: event.start.timeZone ?? undefined,
          },
          end: {
            dateTime: endDateTime,
            timeZone: event.end.timeZone ?? undefined,
          },
          attendees: event.attendees?.map((attendee) => ({
            email: attendee.email ?? '',
            displayName: attendee.displayName ?? undefined,
            responseStatus: toResponseStatus(attendee.responseStatus ?? undefined),
          })),
          location: event.location ?? undefined,
        });
      }
    }

    return allEvents;
  }

  async createEvent(params: {
    calendarId: string;
    requestBody: Record<string, unknown>;
    conferenceDataVersion?: number;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }) {
    return this.executeCalendarRequest('events.insert', () =>
      this.calendar.events.insert({
        calendarId: params.calendarId,
        sendUpdates: params.sendUpdates,
        conferenceDataVersion: params.conferenceDataVersion,
        requestBody: params.requestBody,
      }),
    );
  }

  async patchEvent(params: {
    calendarId: string;
    eventId: string;
    requestBody: Record<string, unknown>;
    conferenceDataVersion?: number;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    ifMatchEtag?: string;
  }) {
    return this.executeCalendarRequest('events.patch', () =>
      this.calendar.events.patch(
        {
          calendarId: params.calendarId,
          eventId: params.eventId,
          sendUpdates: params.sendUpdates,
          conferenceDataVersion: params.conferenceDataVersion,
          requestBody: params.requestBody,
        },
        params.ifMatchEtag ? { headers: { 'If-Match': params.ifMatchEtag } } : undefined,
      ),
    );
  }

  async deleteEvent(params: {
    calendarId: string;
    eventId: string;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    ifMatchEtag?: string;
  }) {
    return this.executeCalendarRequest('events.delete', () =>
      this.calendar.events.delete(
        {
          calendarId: params.calendarId,
          eventId: params.eventId,
          sendUpdates: params.sendUpdates,
        },
        params.ifMatchEtag ? { headers: { 'If-Match': params.ifMatchEtag } } : undefined,
      ),
    );
  }

  async getEvent(params: { calendarId: string; eventId: string }) {
    return this.executeCalendarRequest('events.get', () =>
      this.calendar.events.get({
        calendarId: params.calendarId,
        eventId: params.eventId,
      }),
    );
  }

  /**
   * Check availability for a specific time slot
   */
  async checkAvailability(
    startTime: Date,
    endTime: Date,
    attendees?: string[],
    options?: {
      calendarIds?: string[];
      timeZone?: string;
    },
  ): Promise<CalendarAvailability> {
    try {
      // Get events for the specified time range
      const events = await this.getEvents(startTime, endTime, 50, true, options);
      
      // Filter for conflicting events (events that overlap with the requested time)
      const conflictingEvents = events.filter(event => {
        const eventStart = new Date(event.start.dateTime);
        const eventEnd = new Date(event.end.dateTime);
        
        // Check for overlap
        return (
          (eventStart < endTime && eventEnd > startTime) &&
          event.status !== 'cancelled'
        );
      });

      const isFree = conflictingEvents.length === 0;
      
      // If not free, suggest alternative times (simple implementation)
      let suggestedTimes: Array<{ start: string; end: string }> = [];
      if (!isFree) {
        // Find next available slot after the requested time
        const duration = endTime.getTime() - startTime.getTime();
        const nextSlotStart = new Date(endTime.getTime() + 30 * 60 * 1000); // 30 min buffer
        const nextSlotEnd = new Date(nextSlotStart.getTime() + duration);
        
        suggestedTimes = [{
          start: nextSlotStart.toISOString(),
          end: nextSlotEnd.toISOString()
        }];
      }

      const lines: string[] = [];
      lines.push(
        `[calendar] 🗓️ Availability: ${isFree ? 'FREE ✅' : 'BUSY ⛔'} conflicts=${conflictingEvents.length} window=${startTime.toISOString()} → ${endTime.toISOString()}`,
      );
      if (!isFree) {
        lines.push(`[calendar] 💡 Suggestion: ${suggestedTimes[0]?.start} → ${suggestedTimes[0]?.end}`);
      }
      console.log(lines.join('\n'));
      
      return {
        isFree,
        conflictingEvents,
        suggestedTimes: !isFree ? suggestedTimes : undefined
      };
    } catch (error) {
      console.error('❌ Error checking availability:', error);
      throw error;
    }
  }

  /**
   * Get today's events for quick context
   */
  async getTodaysEvents(options?: { calendarIds?: string[]; timeZone?: string }): Promise<CalendarEvent[]> {
    const timeZone = options?.timeZone || DEFAULT_CALENDAR_TIMEZONE;
    const now = new Date();
    const { year, month, day } = getZonedTimeComponents(now, timeZone);
    const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const startOfDay = startOfDayInTimezone(todayStr, timeZone);
    const endOfDay = endOfDayInTimezone(todayStr, timeZone);

    return this.getEvents(startOfDay, endOfDay, 50, true, options);
  }

  /**
   * Get this week's events for broader context
   */
  async getWeekEvents(options?: { calendarIds?: string[]; timeZone?: string }): Promise<CalendarEvent[]> {
    const timeZone = options?.timeZone || DEFAULT_CALENDAR_TIMEZONE;
    const now = new Date();

    // Compute week boundaries in user's timezone (not server-local) so "this week" is correct when server TZ ≠ user TZ
    const { year, month, day } = getZonedTimeComponents(now, timeZone);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay(); // 0=Sun, 6=Sat

    const sundayDate = new Date(Date.UTC(year, month - 1, day - dayOfWeek, 12, 0, 0));
    const saturdayDate = new Date(Date.UTC(year, month - 1, day - dayOfWeek + 6, 12, 0, 0));

    const sundayStr = `${sundayDate.getUTCFullYear()}-${String(sundayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(sundayDate.getUTCDate()).padStart(2, '0')}`;
    const saturdayStr = `${saturdayDate.getUTCFullYear()}-${String(saturdayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(saturdayDate.getUTCDate()).padStart(2, '0')}`;

    const weekStart = startOfDayInTimezone(sundayStr, timeZone);
    const weekEnd = endOfDayInTimezone(saturdayStr, timeZone);

    return this.getEvents(weekStart, weekEnd, 50, true, options);
  }

  /**
   * Parse Google Calendar event to our CalendarEvent interface
   */
  private parseCalendarEvent(event: any): CalendarEvent | null {
    try {
      if (!event.id) return null;

      return {
        id: event.id,
        summary: event.summary || '(No title)',
        description: event.description,
        start: {
          dateTime: event.start?.dateTime || event.start?.date,
          timeZone: event.start?.timeZone
        },
        end: {
          dateTime: event.end?.dateTime || event.end?.date,
          timeZone: event.end?.timeZone
        },
        attendees: event.attendees?.map((attendee: any) => ({
          email: attendee.email,
          displayName: attendee.displayName,
          responseStatus: attendee.responseStatus
        })),
        status: event.status || 'confirmed',
        location: event.location
      };
    } catch (error) {
      console.error('Error parsing calendar event:', error);
      return null;
    }
  }

  /**
   * Generate a text summary of calendar data for LLM consumption
   */
  generateCalendarSummary(
    events: CalendarEvent[],
    availability?: CalendarAvailability,
    timeZone?: string
  ): string {
    let summary = '';
    
    if (availability) {
      summary += `AVAILABILITY CHECK:\n`;
      summary += `Status: ${availability.isFree ? 'FREE' : 'BUSY'}\n`;
      if (availability.conflictingEvents.length > 0) {
        summary += `Conflicts: ${availability.conflictingEvents
          .map((e) => {
            const start = this.formatDateTimeForZone(e.start.dateTime, timeZone);
            const end = this.formatDateTimeForZone(e.end.dateTime, timeZone);
            return `"${e.summary}" (${start} - ${end})`;
          })
          .join(', ')}\n`;
      }
      if (availability.suggestedTimes) {
        summary += `Suggested alternatives: ${availability.suggestedTimes
          .map((t) => {
            const start = this.formatDateTimeForZone(t.start, timeZone);
            const end = this.formatDateTimeForZone(t.end, timeZone);
            return `${start} - ${end}`;
          })
          .join(', ')}\n`;
      }
      summary += '\n';
    }
    
    if (events.length > 0) {
      summary += `RELEVANT CALENDAR EVENTS:\n`;
      events.forEach((event) => {
        const start = this.formatDateTimeForZone(event.start.dateTime, timeZone);
        summary += `- "${event.summary}" on ${start}`;
        if (event.attendees && event.attendees.length > 0) {
          summary += ` (with ${event.attendees.map(a => a.email).join(', ')})`;
        }
        if (event.location) {
          summary += ` at ${event.location}`;
        }
        summary += '\n';
      });
    } else {
      summary += 'No relevant calendar events found.\n';
    }
    
    if (timeZone) {
      summary += `\n(All times shown in ${timeZone})\n`;
    }
    return summary;
  }

  /**
   * Helper to render a date-time string in a specific timezone for LLM consumption
   */
  private formatDateTimeForZone(dateTime: string, timeZone?: string): string {
    try {
      const date = new Date(dateTime);
      if (!timeZone) {
        return date.toISOString();
      }

      const formatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
      });

      return `${formatter.format(date)} (${timeZone})`;
    } catch {
      return dateTime;
    }
  }
} 
