import { readPromptFile } from '@/lib/prompts';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import {
  CalendarAnalysisResultSchema,
  type CalendarAnalysisResultDTO,
  type CalendarAnalysisInputDTO,
} from '@/lib/ai/schemas/schemas';
import type { CalendarSnapshotResult } from '@/lib/services/core/replyContextTools';
import type { AiTraceContext } from '@/lib/ai/tracing';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Analysis Subagent
//
// A specialized LLM that analyzes calendar data and returns concise,
// decision-ready scheduling information to the main Planner agent.
//
// Benefits:
// 1. Offloads calendar reasoning from Planner (reduces context bloat)
// 2. Specialized prompt for calendar analysis (higher accuracy)
// 3. Compresses raw events into actionable recommendations
// 4. Planner receives ~50-100 tokens instead of ~1000+ raw event tokens
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context passed to the Calendar Analysis Subagent.
 */
export type CalendarAnalysisContext = {
  /** The Planner's scheduling request */
  request: CalendarAnalysisInputDTO;

  /** Raw calendar data from getCalendarSnapshot */
  calendarSnapshot: CalendarSnapshotResult;

  /** Email context for understanding priority/urgency */
  emailContext: {
    subject: string;
    fromEmail: string;
    bodySnippet: string;
  };

  /** Current time reference for relative date handling */
  currentTime: {
    utcNow: string;
    userTimezone: string;
    userLocalNow: string;
    dayOfWeek: string;
  };

  /** Optional abort signal for time budgets */
  abortSignal?: AbortSignal;

  /** Optional deadline timestamp for early exits */
  deadlineAt?: number;
  traceContext?: AiTraceContext;
};

const EARLY_EXIT_BUFFER_MS = 3_000;

function isTimeLow(deadlineAt?: number, bufferMs = EARLY_EXIT_BUFFER_MS): boolean {
  return typeof deadlineAt === 'number' && deadlineAt - Date.now() < bufferMs;
}

/**
 * Builds the prompt for the Calendar Analysis Subagent by populating
 * the template with the provided context.
 */
function buildCalendarAnalysisPrompt(context: CalendarAnalysisContext): string {
  const template = readPromptFile('core-processing/calendarAnalysisPrompt.md');

  // Format events as JSON for the LLM
  const eventsJson =
    context.calendarSnapshot.events.length > 0
      ? JSON.stringify(context.calendarSnapshot.events, null, 2)
      : '(No events in this range)';

  return template
    .replace('{utcNow}', context.currentTime.utcNow)
    .replace('{userTimezone}', context.currentTime.userTimezone)
    .replace('{userLocalNow}', context.currentTime.userLocalNow)
    .replace('{dayOfWeek}', context.currentTime.dayOfWeek)
    .replace('{dateRangeStart}', context.calendarSnapshot.dateRange.start)
    .replace('{dateRangeEnd}', context.calendarSnapshot.dateRange.end)
    .replace('{durationNeeded}', context.request.durationNeeded || '(not specified)')
    .replace('{preferences}', context.request.preferences || '(none)')
    .replace('{meetingContext}', context.request.meetingContext || '(not specified)')
    .replace('{fromEmail}', context.emailContext.fromEmail)
    .replace('{emailSubject}', context.emailContext.subject)
    .replace('{emailSnippet}', context.emailContext.bodySnippet)
    .replace('{eventsJson}', eventsJson);
}

/**
 * Creates a fallback result when the subagent fails or calendar is unavailable.
 */
function createFallbackResult(
  context: CalendarAnalysisContext,
  reason: string,
): CalendarAnalysisResultDTO {
  return {
    freeSlots: [],
    conflicts: [],
    busynessLevel: 'moderate',
    recommendation: `Unable to analyze calendar: ${reason}. Ask the sender for their availability.`,
    alternatives: 'Request the sender to share their preferred times.',
    reasoning: `Calendar analysis failed: ${reason}`,
    meta: {
      dateRangeAnalyzed: `${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
      totalEventsInRange: context.calendarSnapshot.events.length,
      slotsMatchingDuration: 0,
    },
  };
}

function createQuickResult(
  context: CalendarAnalysisContext,
  reason: string,
): CalendarAnalysisResultDTO {
  return {
    freeSlots: [],
    conflicts: [],
    busynessLevel: context.calendarSnapshot.events.length > 0 ? 'moderate' : 'light',
    recommendation: 'Time is tight, so I only did a quick pass. Want a deeper availability scan?',
    alternatives: 'Share a few candidate times or ask me to dig deeper.',
    reasoning: `Calendar analysis skipped: ${reason}`,
    meta: {
      dateRangeAnalyzed: `${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
      totalEventsInRange: context.calendarSnapshot.events.length,
      slotsMatchingDuration: 0,
    },
  };
}

/**
 * Runs the Calendar Analysis Subagent.
 *
 * Takes raw calendar data + email context + requirements and returns
 * a concise, decision-ready analysis for the Planner.
 *
 * @param context - The full context including calendar data and email info
 * @returns Structured calendar analysis result
 */
export async function analyzeCalendarForScheduling(
  context: CalendarAnalysisContext,
): Promise<CalendarAnalysisResultDTO> {
  // Fast-path: if calendar access failed, return fallback immediately
  if (!context.calendarSnapshot.success) {
    const reason = context.calendarSnapshot.error || 'Calendar access unavailable';
    logger.warn(`[calendarSubagent] Calendar snapshot failed: ${reason}`);
    return createFallbackResult(context, reason);
  }

  // Fast-path: if no events, return simple "all clear" result
  if (context.calendarSnapshot.events.length === 0) {
    logger.info('[calendarSubagent] No events in range - returning all-clear result');
    const startMs = new Date(context.calendarSnapshot.dateRangeUtc.start).getTime();
    const endMs = new Date(context.calendarSnapshot.dateRangeUtc.end).getTime();
    const durationMinutes =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? Math.max(1, Math.round((endMs - startMs) / 60_000))
        : 60;

    return {
      freeSlots: [
        {
          start: context.calendarSnapshot.dateRange.start,
          end: context.calendarSnapshot.dateRange.end,
          durationMinutes,
          quality: 'ideal',
        },
      ],
      conflicts: [],
      busynessLevel: 'light',
      recommendation: `Calendar is clear from ${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}.`,
      reasoning: 'No events found in the requested date range.',
      meta: {
        dateRangeAnalyzed: `${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
        totalEventsInRange: 0,
        slotsMatchingDuration: 1,
      },
    };
  }

  if (isTimeLow(context.deadlineAt)) {
    logger.warn('[calendarSubagent] Time budget low - returning quick result');
    return createQuickResult(context, 'Time budget low, skipping deep analysis.');
  }

  const prompt = buildCalendarAnalysisPrompt(context);

  try {
    logger.info(
      `[calendarSubagent] Analyzing calendar: ${context.calendarSnapshot.events.length} events, ` +
        `range=${context.calendarSnapshot.dateRange.start} to ${context.calendarSnapshot.dateRange.end}`,
    );

    const { object: result } = await callObject<CalendarAnalysisResultDTO>({
      model: models.flash(),
      system:
        'You are a calendar analysis specialist. Analyze the calendar data and return a structured JSON response matching the required schema. Be concise and actionable.',
      prompt,
      schema: CalendarAnalysisResultSchema,
      temperature: 0.2, // Low temperature for consistent, factual output
      abortSignal: context.abortSignal,
      op: 'calendar.analysis',
      concurrency: { key: 'calendar.analysis', maxConcurrency: 4 },
      retry: { maxAttempts: 2, baseDelayMs: 500 },
      traceContext: context.traceContext,
    });

    logger.info(
      `[calendarSubagent] Analysis complete: ${result.freeSlots.length} free slots, ` +
        `busyness=${result.busynessLevel}, recommendation="${result.recommendation.slice(0, 50)}..."`,
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[calendarSubagent] Analysis failed: ${message}`);
    return createFallbackResult(context, message);
  }
}

/**
 * Simplified interface for the Planner to call the Calendar Analysis Subagent.
 *
 * This is the main entry point that handles:
 * 1. Fetching calendar snapshot
 * 2. Building context
 * 3. Running the subagent
 * 4. Returning the result
 *
 * @param params - Parameters from the Planner's analyze_calendar tool call
 * @param dependencies - Dependencies injected by the Planner
 */
export async function runCalendarAnalysis(
  params: CalendarAnalysisInputDTO,
  dependencies: {
    calendarSnapshot: CalendarSnapshotResult;
    emailContext: {
      subject: string;
      fromEmail: string;
      bodySnippet: string;
    };
    currentTime: {
      utcNow: string;
      userTimezone: string;
      userLocalNow: string;
      dayOfWeek: string;
    };
    abortSignal?: AbortSignal;
    deadlineAt?: number;
    traceContext?: AiTraceContext;
  },
): Promise<CalendarAnalysisResultDTO> {
  const context: CalendarAnalysisContext = {
    request: params,
    calendarSnapshot: dependencies.calendarSnapshot,
    emailContext: dependencies.emailContext,
    currentTime: dependencies.currentTime,
    abortSignal: dependencies.abortSignal,
    deadlineAt: dependencies.deadlineAt,
    traceContext: dependencies.traceContext,
  };

  return analyzeCalendarForScheduling(context);
}
