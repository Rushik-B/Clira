import { readPromptFile } from '@/lib/prompts';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import {
  CalendarSearchResultSchema,
  type CalendarSearchResultDTO,
  type CalendarSearchInputDTO,
} from '@/lib/ai/schemas/calendarSearchSchemas';
import type { CalendarSnapshotResult } from '@/lib/services/core/replyContextTools';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Search Subagent
//
// A specialized LLM that searches calendar events using natural language queries
// and returns semantically relevant results to the Executive Agent.
//
// Benefits:
// 1. Offloads calendar search from Executive Agent (reduces context bloat)
// 2. Enables semantic search over events (not just keyword matching)
// 3. Provides ranked, filtered results with relevance scores
// 4. Executive Agent receives ~50-100 tokens instead of ~1000+ raw event tokens
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context passed to the Calendar Search Subagent.
 */
export type CalendarSearchContext = {
  /** The search query and parameters */
  request: CalendarSearchInputDTO;

  /** Raw calendar data from getCalendarSnapshot */
  calendarSnapshot: CalendarSnapshotResult;

  /** Current time reference for relative date handling */
  currentTime: {
    utcNow: string;
    userTimezone: string;
    userLocalNow: string;
    dayOfWeek: string;
  };

  /** User context for better semantic matching */
  userContext: {
    userEmail: string;
    requestContext: string;
  };

  /** Optional abort signal for time budgets */
  abortSignal?: AbortSignal;

  /** Optional deadline timestamp for early exits */
  deadlineAt?: number;
};

const EARLY_EXIT_BUFFER_MS = 3_000;

function isTimeLow(deadlineAt?: number, bufferMs = EARLY_EXIT_BUFFER_MS): boolean {
  return typeof deadlineAt === 'number' && deadlineAt - Date.now() < bufferMs;
}

/**
 * Builds the prompt for the Calendar Search Subagent by populating
 * the template with the provided context.
 */
function buildCalendarSearchPrompt(context: CalendarSearchContext): string {
  const template = readPromptFile('core-processing/calendarSearchPrompt.md');

  // Format events as JSON for the LLM
  const eventsJson =
    context.calendarSnapshot.events.length > 0
      ? JSON.stringify(context.calendarSnapshot.events, null, 2)
      : '(No events in this range)';

  const maxResults = context.request.maxResults ?? 10;
  const minRelevance = context.request.minRelevance ?? 40;

  return template
    .replace('{utcNow}', context.currentTime.utcNow)
    .replace('{userTimezone}', context.currentTime.userTimezone)
    .replace('{userLocalNow}', context.currentTime.userLocalNow)
    .replace('{dayOfWeek}', context.currentTime.dayOfWeek)
    .replace('{userEmail}', context.userContext.userEmail)
    .replace('{requestContext}', context.userContext.requestContext)
    .replace('{searchQuery}', context.request.query)
    .replace('{dateRangeStart}', context.calendarSnapshot.dateRange.start)
    .replace('{dateRangeEnd}', context.calendarSnapshot.dateRange.end)
    .replace('{maxResults}', String(maxResults))
    .replace('{minRelevance}', String(minRelevance))
    .replace('{eventsJson}', eventsJson);
}

/**
 * Creates a fallback result when the subagent fails or calendar is unavailable.
 */
function createFallbackResult(
  context: CalendarSearchContext,
  reason: string,
): CalendarSearchResultDTO {
  return {
    events: [],
    summary: `Unable to search calendar: ${reason}`,
    reasoning: `Calendar search failed: ${reason}`,
    meta: {
      totalEventsSearched: 0,
      matchesFound: 0,
      dateRangeSearched: `${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
      queryType: 'general',
    },
  };
}

/**
 * Creates an empty result when no events are found in the date range.
 */
function createEmptyResult(context: CalendarSearchContext): CalendarSearchResultDTO {
  return {
    events: [],
    summary: 'No events found in the specified date range',
    reasoning: 'The calendar has no events in the search period',
    meta: {
      totalEventsSearched: 0,
      matchesFound: 0,
      dateRangeSearched: `${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
      queryType: 'general',
    },
  };
}

function createQuickResult(
  context: CalendarSearchContext,
  reason: string,
): CalendarSearchResultDTO {
  return {
    events: [],
    summary: 'Time is tight, so I skipped the deep calendar search.',
    reasoning: `Calendar search skipped: ${reason}`,
    meta: {
      totalEventsSearched: context.calendarSnapshot.events.length,
      matchesFound: 0,
      dateRangeSearched: `${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
      queryType: 'general',
    },
  };
}

/**
 * Runs the Calendar Search Subagent.
 *
 * Takes a natural language query + calendar data and returns
 * semantically relevant events with ranking and insights.
 *
 * @param context - The full context including query, calendar data, and user info
 * @returns Structured calendar search result
 */
export async function searchCalendarEvents(
  context: CalendarSearchContext,
): Promise<CalendarSearchResultDTO> {
  // Fast-path: if calendar access failed, return fallback immediately
  if (!context.calendarSnapshot.success) {
    const reason = context.calendarSnapshot.error || 'Calendar access unavailable';
    logger.warn(`[calendarSearchSubagent] Calendar snapshot failed: ${reason}`);
    return createFallbackResult(context, reason);
  }

  // Fast-path: if no events, return empty result
  if (context.calendarSnapshot.events.length === 0) {
    logger.info('[calendarSearchSubagent] No events in range - returning empty result');
    return createEmptyResult(context);
  }

  if (isTimeLow(context.deadlineAt)) {
    logger.warn('[calendarSearchSubagent] Time budget low - returning quick result');
    return createQuickResult(context, 'Time budget low, skipping deep search.');
  }

  const prompt = buildCalendarSearchPrompt(context);

  try {
    logger.info(
      `[calendarSearchSubagent] Searching calendar: query="${context.request.query}", ` +
        `${context.calendarSnapshot.events.length} events, ` +
        `range=${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
    );

    const { object: result } = await callObject<CalendarSearchResultDTO>({
      model: models.calendarSearch(),
      system:
        'You are a calendar search specialist. Analyze the calendar events and search query, then return a structured JSON response with semantically relevant matches. Be intelligent about matching - understand intent, not just keywords.',
      prompt,
      schema: CalendarSearchResultSchema,
      temperature: 0.3, // Slightly higher than analysis for creative semantic matching
      abortSignal: context.abortSignal,
      op: 'calendar.search',
      concurrency: { key: 'calendar.search', maxConcurrency: 4 },
      retry: { maxAttempts: 2, baseDelayMs: 500 },
    });

    logger.info(
      `[calendarSearchSubagent] Search complete: ${result.events.length} matches found, ` +
        `summary="${result.summary.slice(0, 50)}..."`,
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[calendarSearchSubagent] Search failed: ${message}`);
    return createFallbackResult(context, message);
  }
}

/**
 * Simplified interface for the Executive Agent to call the Calendar Search Subagent.
 *
 * This is the main entry point that handles:
 * 1. Fetching calendar snapshot for the specified date range
 * 2. Building context
 * 3. Running the subagent
 * 4. Returning the result
 *
 * @param params - Parameters from the Executive Agent's search_calendar tool call
 * @param dependencies - Dependencies injected by the Executive Agent
 */
export async function runCalendarSearch(
  params: CalendarSearchInputDTO,
  dependencies: {
    calendarSnapshot: CalendarSnapshotResult;
    currentTime: {
      utcNow: string;
      userTimezone: string;
      userLocalNow: string;
      dayOfWeek: string;
    };
    userContext: {
      userEmail: string;
      requestContext: string;
    };
    abortSignal?: AbortSignal;
    deadlineAt?: number;
  },
): Promise<CalendarSearchResultDTO> {
  const context: CalendarSearchContext = {
    request: params,
    calendarSnapshot: dependencies.calendarSnapshot,
    currentTime: dependencies.currentTime,
    userContext: dependencies.userContext,
    abortSignal: dependencies.abortSignal,
    deadlineAt: dependencies.deadlineAt,
  };

  return searchCalendarEvents(context);
}
