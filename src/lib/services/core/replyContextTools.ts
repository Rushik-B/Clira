import { CalendarService } from './calendarService';
import type { CalendarAvailability, CalendarEvent } from '../../../types';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { logger } from '@/lib/logger';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import type { EmailData } from '@/lib/email/gmail';
import { getSupermemoryClient, isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import type { SupermemorySearchResult } from '@/lib/services/supermemory/types';
import { addDaysToDateOnly, convertUserLocalTimeToUtc, getUserReferenceDate } from '@/lib/utils/timezone';
import { resolveCalendarTimezoneForUser } from '@/lib/services/calendarTimezone';

const parseMessyTime = require('parse-messy-time');

export type CalendarContextParameters = {
  dateHint?: string;
  durationHint?: string;
  attendees?: string[];
};

export type CalendarContextResult = {
  availability: CalendarAvailability | undefined;
  relevantEvents: CalendarEvent[];
  summary: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Simple calendar snapshot for the Planner agent
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarSnapshotEvent = {
  eventId: string;
  calendarId: string;
  name: string;
  start: string;
  end: string;
  isAllDay: boolean;
  description?: string;
  location?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
};

export type CalendarSnapshotResult = {
  success: boolean;
  timezone: string;
  dateRange: { start: string; end: string };
  dateRangeUtc: { start: string; end: string };
  events: CalendarSnapshotEvent[];
  error?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar snapshot with mutation identifiers (for update/delete flows)
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarMutationSnapshotEvent = {
  calendarId: string;
  eventId: string;
  etag?: string;
  name: string;
  start: string;
  end: string;
  isAllDay: boolean;
  description?: string;
  location?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
};

export type CalendarMutationSnapshotResult = {
  success: boolean;
  timezone: string;
  dateRange: { start: string; end: string };
  dateRangeUtc: { start: string; end: string };
  events: CalendarMutationSnapshotEvent[];
  error?: string;
};

/**
 * Fetches a snapshot of calendar events for the Planner to reason about scheduling.
 * Returns events as simple JSON with names and times in the user's configured timezone.
 */
export async function getCalendarSnapshot({
  userId,
  startDate,
  endDate,
}: {
  userId: string;
  startDate: Date;
  endDate: Date;
}): Promise<CalendarSnapshotResult> {
  try {
    const { prisma } = await import('@/lib/prisma');

    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        calendarContextCalendarIds: true,
      },
    });

    const calendarIds = userSettings?.calendarContextCalendarIds || [];
    const { timeZone } = await resolveCalendarTimezoneForUser(userId);

    const calendarService = await CalendarService.create({
      userId,
      purpose: 'reply:calendar-snapshot',
      requester: 'replyContextTools.getCalendarSnapshot',
    });

    if (!calendarService) {
      return {
        success: false,
        timezone: timeZone,
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        dateRangeUtc: { start: startDate.toISOString(), end: endDate.toISOString() },
        events: [],
        error: 'No calendar access available.',
      };
    }

    const rawEvents = await calendarService.listEventsForMutation(startDate, endDate, 100, {
      calendarIds,
      timeZone,
    });

    const formatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });

    const events: CalendarSnapshotEvent[] = rawEvents.map((event) => {
      const startDt = event.start.dateTime;
      const endDt = event.end.dateTime;

      const isAllDay = !startDt.includes('T') || startDt === endDt;
      const startDateOnly = startDt.split('T')[0]!;
      const endDateOnlyRaw = endDt.split('T')[0]!;
      const endDateOnly =
        isAllDay && endDateOnlyRaw > startDateOnly ? addDaysToDateOnly(endDateOnlyRaw, -1) : endDateOnlyRaw;

      return {
        eventId: event.eventId,
        calendarId: event.calendarId,
        name: event.summary,
        start: isAllDay ? startDateOnly : formatter.format(new Date(startDt)),
        end: isAllDay ? endDateOnly : formatter.format(new Date(endDt)),
        isAllDay,
        description: event.description,
        location: event.location,
        attendees: event.attendees,
      };
    });

    return {
      success: true,
      timezone: timeZone,
      dateRange: {
        start: formatter.format(startDate),
        end: formatter.format(endDate),
      },
      dateRangeUtc: { start: startDate.toISOString(), end: endDate.toISOString() },
      events,
    };
  } catch (error) {
    console.error('❌ Error fetching calendar snapshot:', error);
    return {
      success: false,
      timezone: DEFAULT_CALENDAR_TIMEZONE,
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
      dateRangeUtc: { start: startDate.toISOString(), end: endDate.toISOString() },
      events: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetches a mutation-safe snapshot with event IDs and etags for update/delete flows.
 */
export async function getCalendarMutationSnapshot({
  userId,
  startDate,
  endDate,
}: {
  userId: string;
  startDate: Date;
  endDate: Date;
}): Promise<CalendarMutationSnapshotResult> {
  try {
    const { prisma } = await import('@/lib/prisma');

    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        calendarContextCalendarIds: true,
      },
    });

    const calendarIds = userSettings?.calendarContextCalendarIds || [];
    const { timeZone } = await resolveCalendarTimezoneForUser(userId);

    const calendarService = await CalendarService.create({
      userId,
      purpose: 'reply:calendar-mutation-snapshot',
      requester: 'replyContextTools.getCalendarMutationSnapshot',
    });

    if (!calendarService) {
      return {
        success: false,
        timezone: timeZone,
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        dateRangeUtc: { start: startDate.toISOString(), end: endDate.toISOString() },
        events: [],
        error: 'No calendar access available.',
      };
    }

    const rawEvents = await calendarService.listEventsForMutation(startDate, endDate, 150, {
      calendarIds,
      timeZone,
    });

    const formatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });

    const events: CalendarMutationSnapshotEvent[] = rawEvents.map((event) => {
      const startDt = event.start.dateTime;
      const endDt = event.end.dateTime;

      const isAllDay = !startDt.includes('T') || startDt === endDt;
      const startDateOnly = startDt.split('T')[0]!;
      const endDateOnlyRaw = endDt.split('T')[0]!;
      const endDateOnly =
        isAllDay && endDateOnlyRaw > startDateOnly ? addDaysToDateOnly(endDateOnlyRaw, -1) : endDateOnlyRaw;

      return {
        calendarId: event.calendarId,
        eventId: event.eventId,
        etag: event.etag,
        name: event.summary,
        start: isAllDay ? startDateOnly : formatter.format(new Date(startDt)),
        end: isAllDay ? endDateOnly : formatter.format(new Date(endDt)),
        isAllDay,
        description: event.description,
        location: event.location,
        attendees: event.attendees,
      };
    });

    return {
      success: true,
      timezone: timeZone,
      dateRange: {
        start: formatter.format(startDate),
        end: formatter.format(endDate),
      },
      dateRangeUtc: { start: startDate.toISOString(), end: endDate.toISOString() },
      events,
    };
  } catch (error) {
    logger.error('[calendarMutationSnapshot] Error fetching snapshot', error);
    return {
      success: false,
      timezone: DEFAULT_CALENDAR_TIMEZONE,
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
      dateRangeUtc: { start: startDate.toISOString(), end: endDate.toISOString() },
      events: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Gathers calendar context (availability and events) for reply generation.
 * Uses Calendar API to fetch relevant events based on date/time hints from the planner.
 */
export async function gatherCalendarContextForReply({
  userId,
  calendarParameters,
}: {
  userId: string;
  calendarParameters?: CalendarContextParameters;
}): Promise<CalendarContextResult | undefined> {
  try {
    const { prisma } = await import('@/lib/prisma');

    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        calendarContextCalendarIds: true,
      },
    });

    const calendarIds = userSettings?.calendarContextCalendarIds || [];
    const { timeZone } = await resolveCalendarTimezoneForUser(userId);

    const calendarService = await CalendarService.create({
      userId,
      purpose: 'reply:calendar-access',
      requester: 'replyContextTools.gatherCalendarContextForReply',
    });

    if (!calendarService) {
      return undefined;
    }

    const params = calendarParameters;
    let relevantEvents: CalendarEvent[] = [];
    let availability: CalendarAvailability | undefined = undefined;

    if (params?.dateHint) {
      const parsedDate = parseDateHint(params.dateHint, timeZone);
      if (parsedDate) {
        const startTime = new Date(parsedDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const endTime = new Date(parsedDate.getTime() + 7 * 24 * 60 * 60 * 1000);

        relevantEvents = await calendarService.getEvents(startTime, endTime, 50, true, {
          calendarIds,
          timeZone,
        });

        if (params.durationHint) {
          const duration = parseDurationHint(params.durationHint);
          const endDateTime = new Date(parsedDate.getTime() + duration);
          availability = await calendarService.checkAvailability(parsedDate, endDateTime, params.attendees, {
            calendarIds,
            timeZone,
          });
        }
      } else {
        relevantEvents = await calendarService.getWeekEvents({ calendarIds, timeZone });
      }
    } else {
      relevantEvents = await calendarService.getWeekEvents({ calendarIds, timeZone });
    }

    const summary = calendarService.generateCalendarSummary(relevantEvents, availability, timeZone);

    return {
      availability,
      relevantEvents,
      summary,
    };
  } catch (error) {
    console.error('❌ Error gathering calendar context:', error);
    return undefined;
  }
}

/**
 * Gathers conversation thread context for reply generation.
 * Uses Gmail API to fetch all messages in the thread chronologically.
 */
export async function gatherThreadContextForReply({
  userId,
  threadId,
  mailboxId,
  maxBodyChars = 300,
}: {
  userId: string;
  threadId: string;
  mailboxId?: string;
  maxBodyChars?: number;
}): Promise<string> {
  try {
    const gmailContext = await createGmailServiceForUser({
      userId,
      mailboxId,
      purpose: 'reply:thread-context',
      requester: 'replyContextTools.gatherThreadContextForReply',
    });

    if (!gmailContext) {
      logger.warn(`[threadContext] No Gmail credentials for userId=${userId}`);
      return '\nNo conversation thread history available.\n';
    }

    const threadEmails = await gmailContext.gmail.fetchFullThread(threadId);

    if (!threadEmails || threadEmails.length === 0) {
      logger.info(`[threadContext] 🧵 threadId=${threadId} → 0 messages`);
      return '\nNo conversation thread history available.\n';
    }

    const threadContext = `\nCONVERSATION THREAD HISTORY (chronological order):\n${threadEmails
      .map((email, index) => {
        const direction = email.isSent ? '[YOU SENT]' : '[THEY SENT]';
        const date = email.date.toLocaleDateString();
        const content =
          email.body.substring(0, maxBodyChars) + (email.body.length > maxBodyChars ? '...' : '');
        return `${index + 1}. ${direction} on ${date}
From: ${email.from}
To: ${email.to.join(', ')}
Subject: ${email.subject}
Content: ${content}
---`;
      })
      .join('\n')}\n`;

    logger.info(
      `[threadContext] 🧵 threadId=${threadId} → ${threadEmails.length} message${threadEmails.length !== 1 ? 's' : ''} (${Math.round(threadContext.length / 1024)}KB)`,
    );

    return threadContext;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[threadContext] ❌ threadId=${threadId} error: ${message}`);
    return '\nError fetching conversation thread history.\n';
  }
}

/**
 * Gathers direct email history between the user and a specific sender.
 * Uses Gmail API to search for complete threads (conversations) involving the sender.
 * Returns all messages from matching threads, preserving conversation context.
 */
export async function gatherDirectEmailHistoryForReply({
  userId,
  senderEmail,
  mailboxId,
  limit = 15,
}: {
  userId: string;
  senderEmail: string;
  mailboxId?: string;
  limit?: number;
}): Promise<
  Array<{
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
    isSent: boolean;
    messageId: string;
    threadId: string;
  }>
> {
  try {
    const gmailContext = await createGmailServiceForUser({
      userId,
      mailboxId,
      purpose: 'reply:email-history',
      requester: 'replyContextTools.gatherDirectEmailHistoryForReply',
    });

    if (!gmailContext) {
      logger.warn(`[emailHistory] No Gmail credentials for userId=${userId}`);
      return [];
    }

    // Gmail search query to find threads with emails from OR to the sender
    const query = `{from:${senderEmail} OR to:${senderEmail}} -in:spam -in:trash`;

    const threads = await gmailContext.gmail.searchThreads(query, limit);

    // Flatten all emails from all threads while preserving thread context
    const allEmails = threads.flatMap(thread =>
      thread.emails.map(email => ({
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        date: email.date,
        isSent: email.isSent,
        messageId: email.messageId,
        threadId: thread.threadId,
      }))
    );

    const sentCount = allEmails.filter((e) => e.isSent).length;
    const receivedCount = allEmails.length - sentCount;

    if (threads.length === 0) {
      logger.info(`[emailHistory] 📧 sender=${senderEmail} → 0 threads`);
    } else {
      logger.info(
        `[emailHistory] 📧 sender=${senderEmail} → ${threads.length} thread${threads.length !== 1 ? 's' : ''} with ${allEmails.length} email${allEmails.length !== 1 ? 's' : ''} (${sentCount} sent, ${receivedCount} received)`,
      );
    }

    return allEmails;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[emailHistory] ❌ sender=${senderEmail} error: ${message}`);
    return [];
  }
}

/**
 * Searches complete email threads containing specific keywords using Gmail API.
 * Returns all messages from matching threads to provide full conversation context.
 * Supports date filtering, sender filtering, and keyword matching in subject/body.
 */
export async function gatherKeywordEmailContextForReply({
  userId,
  keywords,
  mailboxId,
  dateWindowHint = 'recent',
  maxResults = 15,
  senderFilter,
}: {
  userId: string;
  keywords: string[];
  mailboxId?: string;
  dateWindowHint?: string;
  maxResults?: number;
  senderFilter?: string[];
}): Promise<
  Array<{
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
    isSent: boolean;
    messageId: string;
    threadId: string;
    matchedKeywords: string[];
  }>
> {
  try {
    const cleanedKeywords = keywords
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 8);

    if (cleanedKeywords.length === 0) {
      return [];
    }

    const gmailContext = await createGmailServiceForUser({
      userId,
      mailboxId,
      purpose: 'reply:keyword-search',
      requester: 'replyContextTools.gatherKeywordEmailContextForReply',
    });

    if (!gmailContext) {
      logger.warn(`[keywordSearch] No Gmail credentials for userId=${userId}`);
      return [];
    }

    // Build Gmail search query
    const queryParts: string[] = [];

    // Add keywords (Gmail searches in subject and body by default)
    if (cleanedKeywords.length > 0) {
      const keywordQuery = cleanedKeywords.map(kw => `"${kw}"`).join(' OR ');
      queryParts.push(`(${keywordQuery})`);
    }

    // Add sender filter
    if (senderFilter && senderFilter.length > 0) {
      const senderQuery = senderFilter.map(s => `{from:${s} OR to:${s}}`).join(' OR ');
      queryParts.push(`(${senderQuery})`);
    }

    // Add date filter
    if (dateWindowHint === 'recent') {
      queryParts.push('newer_than:30d');
    } else if (dateWindowHint === 'last_month') {
      queryParts.push('newer_than:30d');
    } else if (dateWindowHint === 'last_year') {
      queryParts.push('newer_than:365d');
    }

    // Always exclude spam and trash
    queryParts.push('-in:spam -in:trash');

    const query = queryParts.join(' ');

    const threads = await gmailContext.gmail.searchThreads(query, maxResults);

    // Flatten all emails from all threads while preserving thread context
    const allEmails = threads.flatMap(thread =>
      thread.emails.map(email => ({
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        date: email.date,
        isSent: email.isSent,
        messageId: email.messageId,
        threadId: thread.threadId,
        matchedKeywords: cleanedKeywords.filter(
          (keyword) =>
            email.subject.toLowerCase().includes(keyword.toLowerCase()) ||
            email.body.toLowerCase().includes(keyword.toLowerCase()),
        ),
      }))
    );

    // Logging
    const keywordStr = cleanedKeywords.length <= 3
      ? cleanedKeywords.join(', ')
      : `${cleanedKeywords.slice(0, 2).join(', ')} +${cleanedKeywords.length - 2} more`;
    const senderStr = senderFilter && senderFilter.length > 0 ? ` | senders=${senderFilter.length}` : '';

    if (threads.length === 0) {
      logger.info(`[keywordSearch] 🔍 keywords=[${keywordStr}]${senderStr} window=${dateWindowHint} → 0 threads`);
    } else {
      const uniqueSenders = new Set(allEmails.map((e) => e.from)).size;
      logger.info(
        `[keywordSearch] 🔍 keywords=[${keywordStr}]${senderStr} window=${dateWindowHint} → ${threads.length} thread${threads.length !== 1 ? 's' : ''} with ${allEmails.length} email${allEmails.length !== 1 ? 's' : ''} from ${uniqueSenders} sender${uniqueSenders !== 1 ? 's' : ''}`,
      );
    }

    return allEmails;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[keywordSearch] ❌ error: ${message}`);
    return [];
  }
}

/**
 * Searches Supermemory for relevant context based on a natural language query.
 *
 * This tool searches the user's personal memory graph (built from past emails,
 * conversations, and ingested content) to retrieve contextually relevant information
 * that may not be available in recent email threads.
 *
 * Use cases:
 * - Finding personal preferences, habits, or background information about people
 * - Retrieving context from old conversations or past interactions
 * - Discovering relevant information discussed outside of email (e.g., in-person meetings)
 * - Understanding relationship history and communication patterns
 *
 * @param userId - The user ID to search memories for
 * @param query - Natural language search query describing what you're looking for
 * @param limit - Maximum number of results to return (default: 5)
 * @param threshold - Similarity threshold for results, 0.0-1.0 (default: 0.7, higher = more relevant)
 * @param timeoutMs - Optional request timeout (ms). Use shorter value for time-sensitive paths (e.g. alerts).
 * @returns Array of memory search results with content, score, and metadata
 */
export async function gatherMemoryContextForReply({
  userId,
  query,
  limit = 5,
  threshold = 0.4, // Lower default threshold (0.4) for broader search vs API default 0.5
  timeoutMs,
}: {
  userId: string;
  query: string;
  limit?: number;
  threshold?: number;
  timeoutMs?: number;
}): Promise<
  Array<{
    id: string;
    content: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>
> {
  try {
    // Check if Supermemory is configured
    if (!isSupermemoryConfigured()) {
      logger.info('[memorySearch] Supermemory not configured, skipping memory search');
      return [];
    }

    const client = getSupermemoryClient();

    // Search memories using the user's ID as the container tag
    // This ensures we only search this specific user's memory graph
    // Use lower threshold (0.4) for broader search - API default is 0.5, we want more inclusive results
    // Try 'memories' mode first, then fall back to 'hybrid' if no results
    const searchOpts = { timeoutMs };
    let response = await client.searchMemories({
      query,
      limit,
      containerTag: userId,
      threshold: threshold ?? 0.4, // Use provided threshold or default to 0.4 for broader search
      rerank: true,
      searchMode: 'memories', // Only search memories, not raw documents
      ...searchOpts,
    });

    // If no results with 'memories' mode and threshold >= 0.4, try with lower threshold
    if (response.results.length === 0 && (threshold ?? 0.4) >= 0.4) {
      logger.debug(`[memorySearch] No results with threshold ${threshold ?? 0.4}, trying lower threshold 0.3`);
      response = await client.searchMemories({
        query,
        limit,
        containerTag: userId,
        threshold: 0.3, // Try even lower threshold for broader results
        rerank: true,
        searchMode: 'hybrid', // Try hybrid mode as fallback (searches memories then falls back to document chunks)
        ...searchOpts,
      });
    }

    // Transform results to a consistent format
    // Note: /v4/search API returns memories with field names: "memory" (not "content"), "similarity" (not "score")
    const resultsArray = Array.isArray(response.results) 
      ? response.results 
      : (response as unknown as { results?: SupermemorySearchResult[] }).results || [];

    const results = resultsArray.map((result: any) => {
      // Handle API response format: /v4/search returns "memory" and "similarity" fields
      // Our type definition expects "content" and "score", so map appropriately
      const memoryContent = result.memory ?? result.content;
      const similarityScore = result.similarity ?? result.score;
      
      return {
        id: result.id,
        content: memoryContent || '', // API returns "memory", we expose as "content"
        score: similarityScore ?? 0, // API returns "similarity", we expose as "score"
        metadata: result.metadata,
      };
    });

    if (results.length === 0) {
      logger.info(
        `[memorySearch] 🧠 query="${query.substring(0, 50)}..." containerTag=${userId} threshold=${threshold ?? 0.4} → 0 results`,
      );
    } else {
      const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
      logger.info(
        `[memorySearch] 🧠 query="${query.substring(0, 50)}..." containerTag=${userId} → ${results.length} result${results.length !== 1 ? 's' : ''} (avg score: ${avgScore.toFixed(2)})`,
      );
    }

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? { 
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : { error };
    
    logger.error(
      `[memorySearch] ❌ error: ${message}`,
      {
        query: query.substring(0, 100),
        userId,
        ...errorDetails,
      },
    );

    // Memory search failures should not block reply generation
    // Return empty array and let the planner continue with other context
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

function parseDateHint(dateHint: string, timeZone: string = 'UTC'): Date | null {
  try {
    const now = new Date();
    const userReferenceDate = getUserReferenceDate(now, timeZone);

    const parsedResult = parseMessyTime(dateHint, { now: userReferenceDate });

    if (parsedResult && !Number.isNaN(parsedResult.getTime())) {
      return convertUserLocalTimeToUtc(parsedResult, timeZone);
    }

    const fallbackDate = new Date(dateHint);
    if (!Number.isNaN(fallbackDate.getTime())) {
      return fallbackDate;
    }

    return null;
  } catch (error) {
    console.error(`❌ Error parsing date hint "${dateHint}":`, error);
    return null;
  }
}

function parseDurationHint(durationHint: string): number {
  const lowerHint = durationHint.toLowerCase();
  const numberMatch = lowerHint.match(/(\d+)/);
  const number = numberMatch ? parseInt(numberMatch[1]) : 60;

  if (lowerHint.includes('hour')) {
    return number * 60 * 60 * 1000;
  }
  return number * 60 * 1000;
}
