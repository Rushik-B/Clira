import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Search Subagent Schemas
//
// The Calendar Search Subagent is a specialized LLM that:
// 1. Receives a natural language query + raw calendar data + date range
// 2. Searches and filters calendar events based on the query
// 3. Returns matching events with relevance scores and reasoning
//
// This offloads calendar search/filtering from the Executive Agent, enabling
// semantic search over calendar events (e.g., "find my meetings with John last week")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single calendar event that matches the search query.
 */
export const MatchedEventSchema = z.object({
  eventId: z.string().describe('Event ID from Google Calendar'),
  calendarId: z.string().describe('Calendar ID from Google Calendar'),
  name: z.string().describe('Event title/name'),
  start: z.string().describe('Start time in user-friendly format'),
  end: z.string().describe('End time in user-friendly format'),
  isAllDay: z.boolean().describe('Whether this is an all-day event'),
  description: z.string().optional().describe('Event description if available'),
  location: z.string().optional().describe('Event location if available'),
  attendees: z
    .array(
      z.object({
        email: z.string(),
        displayName: z.string().optional(),
        responseStatus: z
          .enum(['needsAction', 'declined', 'tentative', 'accepted'])
          .optional(),
      }),
    )
    .optional()
    .describe('List of attendees if available'),
  relevanceScore: z
    .number()
    .min(0)
    .max(100)
    .describe('How relevant this event is to the search query (0-100)'),
  matchReason: z
    .string()
    .max(150)
    .describe('Brief explanation of why this event matches the query'),
});

export type MatchedEventDTO = z.infer<typeof MatchedEventSchema>;

/**
 * The structured output from the Calendar Search Subagent.
 * This is what the Executive Agent receives - filtered, ranked, and contextualized.
 */
export const CalendarSearchResultSchema = z.object({
  // Matched events, ordered by relevance
  events: z
    .array(MatchedEventSchema)
    .describe('Calendar events matching the search query, ordered by relevance (most relevant first)'),

  // Search summary
  summary: z
    .string()
    .max(300)
    .describe('Concise summary of the search results (e.g., "Found 3 meetings with John in the past week")'),

  // Overall insights
  insights: z
    .string()
    .max(400)
    .optional()
    .describe('Additional insights or patterns noticed in the results (e.g., "Most meetings were on Mondays")'),

  // Reasoning for transparency
  reasoning: z
    .string()
    .max(500)
    .describe('Brief explanation of how the search was performed and why these events were selected'),

  // Metadata
  meta: z.object({
    totalEventsSearched: z.number().int().min(0).describe('Total number of events in the search range'),
    matchesFound: z.number().int().min(0).describe('Number of events that matched the query'),
    dateRangeSearched: z.string().describe('The date range that was searched'),
    queryType: z
      .enum(['participant', 'topic', 'time_range', 'pattern', 'general'])
      .describe('The type of search query detected'),
  }),
});

export type CalendarSearchResultDTO = z.infer<typeof CalendarSearchResultSchema>;

/**
 * Input parameters for the Calendar Search Subagent.
 * The Executive Agent provides these when calling the search_calendar tool.
 */
export const CalendarSearchInputSchema = z.object({
  // Natural language search query
  query: z
    .string()
    .min(1)
    .max(500)
    .describe('Natural language search query (e.g., "meetings with John last week", "all-day events in January")'),

  // Optional date range constraints
  startDate: z
    .string()
    .optional()
    .describe('Start date in ISO format (optional - will use recent history if not provided)'),

  endDate: z
    .string()
    .optional()
    .describe('End date in ISO format (optional - will use today if not provided)'),

  // Result limits
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum number of matching events to return (default: 10)'),

  // Minimum relevance threshold
  minRelevance: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Minimum relevance score (0-100) for events to include in results (default: 40)'),
});

export type CalendarSearchInputDTO = z.infer<typeof CalendarSearchInputSchema>;

/**
 * Full context passed to the Calendar Search Subagent internally.
 * This includes the raw calendar data + the search parameters.
 */
export const CalendarSearchContextSchema = z.object({
  // From the Executive Agent
  request: CalendarSearchInputSchema,

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
        eventId: z.string(),
        calendarId: z.string(),
        name: z.string(),
        start: z.string(),
        end: z.string(),
        isAllDay: z.boolean(),
        description: z.string().optional(),
        location: z.string().optional(),
        attendees: z
          .array(
            z.object({
              email: z.string(),
              displayName: z.string().optional(),
              responseStatus: z
                .enum(['needsAction', 'declined', 'tentative', 'accepted'])
                .optional(),
            }),
          )
          .optional(),
      }),
    ),
    error: z.string().optional(),
  }),

  // Current time reference
  currentTime: z.object({
    utcNow: z.string(),
    userTimezone: z.string(),
    userLocalNow: z.string(),
    dayOfWeek: z.string(),
  }),

  // User context for better understanding
  userContext: z.object({
    userEmail: z.string(),
    requestContext: z.string().max(500).describe('Context from the user\'s request for better semantic matching'),
  }),
});

export type CalendarSearchContextDTO = z.infer<typeof CalendarSearchContextSchema>;
