import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Analysis Subagent Schemas
//
// The Calendar Analysis Subagent is a specialized LLM that:
// 1. Receives raw calendar data + email context + scheduling requirements
// 2. Analyzes free/busy time, conflicts, and patterns
// 3. Returns a concise, decision-ready summary for the Planner
//
// This offloads calendar reasoning from the main Planner, reducing context
// bloat and improving accuracy for both scheduling and general reply planning.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single free time slot identified by the subagent.
 */
export const FreeSlotSchema = z.object({
  start: z.string().describe('Start time in user-friendly format (e.g., "Wed Jan 8, 2:00 PM")'),
  end: z.string().describe('End time in user-friendly format'),
  durationMinutes: z.number().int().positive().describe('Duration of the free slot in minutes'),
  quality: z
    .enum(['ideal', 'good', 'acceptable', 'tight'])
    .describe('How suitable this slot is (ideal = plenty of buffer, tight = barely fits)'),
});

export type FreeSlotDTO = z.infer<typeof FreeSlotSchema>;

/**
 * A conflict or busy period relevant to the scheduling request.
 */
export const ConflictInfoSchema = z.object({
  description: z.string().describe('Brief description of the conflict (e.g., "Team Standup blocks 10-10:30 AM")'),
  severity: z.enum(['blocks_request', 'partial_overlap', 'adjacent']).describe('How this affects the request'),
});

export type ConflictInfoDTO = z.infer<typeof ConflictInfoSchema>;

/**
 * The structured output from the Calendar Analysis Subagent.
 * This is what the Planner receives - concise and decision-ready.
 */
export const CalendarAnalysisResultSchema = z.object({
  // Core scheduling information
  freeSlots: z
    .array(FreeSlotSchema)
    .describe('Available time slots that match the requirements, ordered by quality/preference'),

  // Conflicts and busy periods
  conflicts: z
    .array(ConflictInfoSchema)
    .describe('Relevant conflicts or busy periods the Planner should know about'),

  // Busyness assessment
  busynessLevel: z
    .enum(['light', 'moderate', 'busy', 'packed'])
    .describe('Overall busyness for the requested period'),

  // Primary recommendation
  recommendation: z
    .string()
    .max(300)
    .describe('The best option or suggested action (e.g., "Tuesday 2-3 PM is the best slot" or "No availability; ask sender for next week")'),

  // Alternative suggestions when no slots found
  alternatives: z
    .string()
    .max(200)
    .optional()
    .describe('Alternative suggestion if no suitable slots exist (e.g., "Try next week" or "Morning slots free on Thursday")'),

  // Brief reasoning for transparency
  reasoning: z
    .string()
    .max(400)
    .describe('Brief explanation of the analysis (helps Planner understand the context)'),

  // Metadata for the Planner
  meta: z.object({
    dateRangeAnalyzed: z.string().describe('The date range that was analyzed (e.g., "Jan 8-10, 2026")'),
    totalEventsInRange: z.number().int().min(0).describe('How many events were in the analyzed range'),
    slotsMatchingDuration: z.number().int().min(0).describe('How many slots matched the duration requirement'),
  }),
});

export type CalendarAnalysisResultDTO = z.infer<typeof CalendarAnalysisResultSchema>;

/**
 * Input parameters for the Calendar Analysis Subagent.
 * The Planner provides these when calling the analyze_calendar tool.
 */
export const CalendarAnalysisInputSchema = z.object({
  // Date range to analyze
  startDate: z.string().describe('Start date in ISO format'),
  endDate: z.string().describe('End date in ISO format'),

  // Scheduling requirements (optional - from Planner)
  durationNeeded: z
    .string()
    .optional()
    .describe('Required duration (e.g., "30 minutes", "1 hour")'),

  preferences: z
    .string()
    .optional()
    .describe('Scheduling preferences (e.g., "prefer mornings", "avoid Fridays", "after 2pm")'),

  // Context from the email (helps subagent understand priority/urgency)
  meetingContext: z
    .string()
    .optional()
    .describe('Brief context about what this meeting is for (e.g., "sync with John about project X")'),
});

export type CalendarAnalysisInputDTO = z.infer<typeof CalendarAnalysisInputSchema>;

/**
 * Full context passed to the Calendar Analysis Subagent internally.
 * This includes the raw calendar data + the Planner's request.
 */
export const CalendarAnalysisContextSchema = z.object({
  // From the Planner
  request: CalendarAnalysisInputSchema,

  // Raw calendar data (from getCalendarSnapshot)
  calendarSnapshot: z.object({
    success: z.boolean(),
    timezone: z.string(),
    dateRange: z.object({
      start: z.string(),
      end: z.string(),
    }),
    events: z.array(
      z.object({
        name: z.string(),
        start: z.string(),
        end: z.string(),
        isAllDay: z.boolean(),
      }),
    ),
    error: z.string().optional(),
  }),

  // Email context for understanding priority
  emailContext: z.object({
    subject: z.string(),
    fromEmail: z.string(),
    bodySnippet: z.string().max(500),
  }),

  // Current time reference
  currentTime: z.object({
    utcNow: z.string(),
    userTimezone: z.string(),
    userLocalNow: z.string(),
    dayOfWeek: z.string(),
  }),
});

export type CalendarAnalysisContextDTO = z.infer<typeof CalendarAnalysisContextSchema>;

