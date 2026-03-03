import { z } from 'zod';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  getCalendarSnapshot,
  gatherMemoryContextForReply,
} from '@/lib/services/core/replyContextTools';
import {
  endOfDayInTimezone,
  endOfTodayInTimezone,
  getDateOnlyInTimezone,
  addDaysToDateOnly,
  normalizeIsoDateInputToUtc,
  startOfDayInTimezone,
} from '@/lib/utils/timezone';
import { runCalendarAnalysis } from '@/lib/ai/agents/calendarAnalysisSubagent';
import { runCalendarSearch } from '@/lib/ai/agents/calendarSearchSubagent';
import { runEmailRetrieval } from '@/lib/ai/agents/emailRetrievalSubagent';
import { isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import {
  CALENDAR_SEARCH_MIN_BUDGET_MS,
  MESSAGING_INBOX_CALL_LIMITS,
} from '../constants';
import {
  buildToolBudgetExceededResult,
  runWithSubagentBudget,
  truncate,
} from '../helpers';
import type {
  ExecutiveRuntimeContext,
  SearchInboxContextArgs,
} from '../types';

export function buildContextTools({
  context,
  nextSubagentCallIndex,
}: {
  context: ExecutiveRuntimeContext;
  nextSubagentCallIndex: () => number;
}): Record<string, unknown> {
  const {
    input,
    retrievalProfile,
    userTimezone,
    currentTimeUtc,
    currentTimeUserTz,
    dayOfWeek,
    toolAbort,
    toolAbortSignal,
    toolResultCache,
  } = context;

  const inboxCallTracker = {
    quickCalls: 0,
    deepCalls: 0,
  };
  context.registerToolResultCacheStatsReader?.(() => toolResultCache.getStats());

  let inboxMinStoredAtMsPromise: Promise<number | undefined> | null = null;
  const getInboxMinStoredAtMs = async (): Promise<number | undefined> => {
    if (!inboxMinStoredAtMsPromise) {
      inboxMinStoredAtMsPromise = prisma.mailbox.findMany({
        where: {
          userId: input.userId,
          status: 'CONNECTED',
        },
        select: {
          updatedAt: true,
          gmailHistoryId: true,
        },
      }).then((mailboxes) => {
        const updatedAtValues = mailboxes
          .map((mailbox) => mailbox.updatedAt?.getTime())
          .filter((value): value is number => Number.isFinite(value));

        if (updatedAtValues.length === 0) {
          return undefined;
        }

        const maxUpdatedAtMs = Math.max(...updatedAtValues);
        const historyMarkerCount = mailboxes.filter((mailbox) => !!mailbox.gmailHistoryId).length;
        logger.debug(
          `[executiveAgent] search_inbox_context freshness marker: connectedMailboxes=${mailboxes.length} historyMarkers=${historyMarkerCount} minStoredAtMs=${maxUpdatedAtMs}`,
        );
        return maxUpdatedAtMs;
      }).catch((error) => {
        logger.warn('[executiveAgent] Failed to load inbox freshness marker', error);
        return undefined;
      });
    }

    return inboxMinStoredAtMsPromise;
  };

  return {
      // Tool 1: Search Inbox Context
      // ─────────────────────────────────────────────────────────────────────────
      search_inbox_context: {
        description:
          'Search the user inbox and return a compact evidence pack with ranked matches, quotes, and coverage. ' +
          'Use deep for analytical, quantitative, or aggregative questions (totals, counts, sums, patterns, temporal summaries, or any question requiring data from many emails)—deep returns broader coverage for accurate calculation. Use quick for simple lookup (one email, recent thread, contact). Also use deep for exact wording, attachments, or when quick results are weak. This tool does not dump raw emails. You may perform any analysis over the evidence (aggregations, calculations, inference) and report clearly.',
        inputSchema: z
          .object({
            mode: z.enum(['quick', 'deep']).optional().describe('Use "deep" for analytical/aggregative questions or broad coverage; "quick" for simple lookup. Default: quick.'),
            intent: z
              .string()
              .min(1)
              .max(500)
              .describe('Natural language description of the email to find'),
            constraints: z
              .object({
                sender: z.string().optional().describe('Sender email or name'),
                recipient: z.string().optional().describe('Recipient email or name'),
                keywords: z.array(z.string()).max(8).optional().describe('Keywords or phrases'),
                subject: z.string().optional().describe('Subject hint or fragment'),
                timeWindow: z
                  .enum(['recent', 'last_month', 'last_year', 'all_time'])
                  .optional()
                  .describe('Time window hint'),
                startDate: z.string().optional().describe('ISO start date'),
                endDate: z.string().optional().describe('ISO end date'),
                hasAttachment: z.boolean().optional().describe('Require attachments'),
              })
              .optional(),
          }),
        execute: async (args: SearchInboxContextArgs) => {
          const mode = args.mode ?? 'quick';
          const intent = args.intent?.trim() || input.userRequest;
          const cacheArgs = {
            mode,
            intent,
            constraints: args.constraints,
          };
          const inboxMinStoredAtMs = await getInboxMinStoredAtMs();
          const cachedResult = toolResultCache.get('search_inbox_context', cacheArgs, {
            minStoredAtMs: inboxMinStoredAtMs,
          });
          if (cachedResult) {
            logger.info(
              `[executiveAgent] search_inbox_context cache hit: mode=${mode} intent="${truncate(intent, 80)}"`,
            );
            return cachedResult;
          }

          const totalCalls = inboxCallTracker.quickCalls + inboxCallTracker.deepCalls;
          const modeCalls = mode === 'deep' ? inboxCallTracker.deepCalls : inboxCallTracker.quickCalls;
          const modeLimit = MESSAGING_INBOX_CALL_LIMITS[mode];

          if (modeCalls >= modeLimit) {
            logger.warn(
              `[executiveAgent] search_inbox_context budget exceeded: mode=${mode} calls=${modeCalls} limit=${modeLimit}`,
            );
            return buildToolBudgetExceededResult(
              'search_inbox_context',
              `Max ${mode} inbox searches reached.`,
              { total: totalCalls, tool: modeCalls },
            );
          }

          if (mode === 'deep') {
            inboxCallTracker.deepCalls += 1;
          } else {
            inboxCallTracker.quickCalls += 1;
          }

          logger.info(
            `[executiveAgent] search_inbox_context: mode=${mode} intent="${truncate(intent, 80)}"`,
          );

          const toolCallIndex = nextSubagentCallIndex();
          const result = await runWithSubagentBudget({
            toolName: 'search_inbox_context',
            counts: { total: totalCalls, tool: modeCalls },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            run: (budgetContext) =>
              runEmailRetrieval(
                {
                  intent,
                  mode,
                  constraints: args.constraints,
                  profile: retrievalProfile,
                },
                {
                  userId: input.userId,
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
          toolResultCache.set('search_inbox_context', cacheArgs, result);
          return result;
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 2: Search Memory
      // ─────────────────────────────────────────────────────────────────────────
      search_memory: {
        description:
          'Search the user\'s personal memory for relevant context. ' +
          'Memories include: names and roles (professors, managers, contacts), preferences, facts, communication style. ' +
          'Use this when: the user asks a RECALL question (e.g. "what\'s my stat prof\'s name?", "who\'s my manager?", "what did I tell you about X?"). ' +
          'Call search_memory first; only say you don\'t know if the search returns nothing.',
        inputSchema: z.object({
          query: z.string().min(1).max(200).describe('Natural language search query'),
          limit: z.number().int().min(1).max(10).optional().describe('Max memories to return (default: 5)'),
        }),
        execute: async (args: { query: string; limit?: number }) => {
          const cacheArgs = {
            query: args.query,
            limit: args.limit ?? 5,
          };
          const cachedResult = toolResultCache.get('search_memory', cacheArgs);
          if (cachedResult) {
            logger.info(`[executiveAgent] search_memory cache hit: "${truncate(args.query, 50)}"`);
            return cachedResult;
          }

          logger.info(`[executiveAgent] search_memory: "${truncate(args.query, 50)}"`);

          if (!isSupermemoryConfigured()) {
            return { query: args.query, count: 0, memories: [], note: 'Memory system not configured' };
          }

          const memories = await gatherMemoryContextForReply({
            userId: input.userId,
            query: args.query,
            limit: args.limit ?? 5,
            threshold: 0.4,
          });

          const result = {
            query: args.query,
            count: memories.length,
            memories: memories.map((m) => ({
              content: truncate(m.content, 400),
              relevanceScore: m.score,
            })),
          };
          toolResultCache.set('search_memory', cacheArgs, result);
          return result;
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 3: Check Calendar
      // ─────────────────────────────────────────────────────────────────────────
      check_calendar: {
        description:
          'Analyze calendar availability for scheduling. Returns free slots, conflicts, and recommendations. ' +
          'Use this when: user wants to schedule a meeting, needs availability, or email involves dates/times. ' +
          'IMPORTANT: Dates are interpreted in the USER\'S timezone. Prefer date-only strings ("YYYY-MM-DD") for day-based queries.',
        inputSchema: z.object({
          startDate: z
            .string()
            .describe('Start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          endDate: z
            .string()
            .describe('End date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          durationNeeded: z.string().optional().describe('Meeting duration (e.g., "30 minutes", "1 hour")'),
          preferences: z.string().optional().describe('Scheduling preferences (e.g., "prefer mornings")'),
        }),
        execute: async (args: {
          startDate: string;
          endDate: string;
          durationNeeded?: string;
          preferences?: string;
        }) => {
          const cacheArgs = {
            startDate: args.startDate,
            endDate: args.endDate,
            durationNeeded: args.durationNeeded,
            preferences: args.preferences,
          };
          const cachedResult = toolResultCache.get('check_calendar', cacheArgs);
          if (cachedResult) {
            logger.info(
              `[executiveAgent] check_calendar cache hit: ${args.startDate} to ${args.endDate}`,
            );
            return cachedResult;
          }

          logger.info(`[executiveAgent] check_calendar: ${args.startDate} to ${args.endDate}`);
          let normalizedStartDate: Date;
          let normalizedEndDate: Date;
          try {
            normalizedStartDate = normalizeIsoDateInputToUtc(args.startDate, userTimezone, 'start');
            normalizedEndDate = normalizeIsoDateInputToUtc(args.endDate, userTimezone, 'end');
          } catch {
            return {
              freeSlots: [],
              conflicts: [],
              recommendation: 'Invalid date format. Use ISO format like "2026-01-20".',
            };
          }

          if (normalizedStartDate > normalizedEndDate) {
            return {
              freeSlots: [],
              conflicts: [],
              recommendation:
                'End date must be on or after start date. Please use a valid range (e.g. start "2026-01-20", end "2026-01-25").',
            };
          }

          const calendarSnapshot = await getCalendarSnapshot({
            userId: input.userId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          });

          const toolCallIndex = nextSubagentCallIndex();
          const result = await runWithSubagentBudget({
            toolName: 'check_calendar',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            run: (budgetContext) =>
              runCalendarAnalysis(
                {
                  startDate: args.startDate,
                  endDate: args.endDate,
                  durationNeeded: args.durationNeeded,
                  preferences: args.preferences,
                },
                {
                  calendarSnapshot,
                  emailContext: {
                    subject: 'WhatsApp scheduling request',
                    fromEmail: input.userEmail,
                    bodySnippet: truncate(input.userRequest, 200),
                  },
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone: userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek: dayOfWeek,
                  },
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
          toolResultCache.set('check_calendar', cacheArgs, result);
          return result;
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 4: Search Calendar
      // ─────────────────────────────────────────────────────────────────────────
      search_calendar: {
        description:
          'Search for specific events in the user\'s calendar using natural language queries. ' +
          'Returns semantically relevant events with ranking and insights. ' +
          'Use this when: user asks to find specific meetings/events, wants to recall past events, ' +
          'needs to check if a particular meeting happened, or wants to find events with specific people or topics. ' +
          'IMPORTANT: Dates are interpreted in the USER\'S timezone. Prefer date-only strings ("YYYY-MM-DD") for full-day ranges. ' +
          'Examples: "events today" -> startDate="YYYY-MM-DD", endDate="YYYY-MM-DD" (user-local). ' +
          'Other examples: "find my meetings with John last week", "show me all-day events in January", "when did I last meet with the team?"',
        inputSchema: z.object({
          query: z.string().min(1).max(500).describe('Natural language search query describing what events to find'),
          startDate: z
            .string()
            .optional()
            .describe('Start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          endDate: z
            .string()
            .optional()
            .describe('End date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          maxResults: z.number().int().min(1).max(50).optional().describe('Maximum number of matching events to return (default: 10)'),
          minRelevance: z.number().min(0).max(100).optional().describe('Minimum relevance score (0-100) for results (default: 40)'),
        }),
        execute: async (args: {
          query: string;
          startDate?: string;
          endDate?: string;
          maxResults?: number;
          minRelevance?: number;
        }) => {
          const cacheArgs = {
            query: args.query,
            startDate: args.startDate,
            endDate: args.endDate,
            maxResults: args.maxResults ?? 10,
            minRelevance: args.minRelevance ?? 40,
          };
          const cachedResult = toolResultCache.get('search_calendar', cacheArgs);
          if (cachedResult) {
            logger.info(`[executiveAgent] search_calendar cache hit: "${truncate(args.query, 50)}"`);
            return cachedResult;
          }

          logger.info(`[executiveAgent] search_calendar: "${truncate(args.query, 50)}"`);

          // Default date range: 30 days ago to today (in user's timezone)
          const now = new Date();
          const userToday = getDateOnlyInTimezone(now, userTimezone);

          // Compute normalized start date
          let normalizedStartDate: Date;
          if (args.startDate) {
            try {
              normalizedStartDate = normalizeIsoDateInputToUtc(args.startDate, userTimezone, 'start');
            } catch {
              return {
                events: [],
                summary: 'Invalid start date format. Use ISO format like "2026-01-20".',
                reasoning: 'Date parsing failed',
                meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
              };
            }
          } else {
            // Default: 30 days ago at start of day in user's timezone
            const thirtyDaysAgo = addDaysToDateOnly(userToday, -30);
            normalizedStartDate = startOfDayInTimezone(thirtyDaysAgo, userTimezone);
          }

          // Compute normalized end date
          let normalizedEndDate: Date;
          if (args.endDate) {
            try {
              normalizedEndDate = normalizeIsoDateInputToUtc(args.endDate, userTimezone, 'end');
            } catch {
              return {
                events: [],
                summary: 'Invalid end date format. Use ISO format like "2026-01-20".',
                reasoning: 'Date parsing failed',
                meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
              };
            }
          } else {
            // Default: end of today in user's timezone
            const endOfToday = endOfTodayInTimezone(now, userTimezone);
            if (args.startDate && normalizedStartDate > endOfToday) {
              // startDate is in the future — "end of today" would create an invalid range (start > end).
              // Default to end of startDate's day so we search that full day.
              const startDateOnly = getDateOnlyInTimezone(normalizedStartDate, userTimezone);
              normalizedEndDate = endOfDayInTimezone(startDateOnly, userTimezone);
            } else {
              normalizedEndDate = endOfToday;
            }
          }

          if (normalizedStartDate > normalizedEndDate) {
            return {
              events: [],
              summary: 'Invalid date range: end date must be on or after start date.',
              reasoning: 'Date range validation failed',
              meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
            };
          }

          const calendarSnapshot = await getCalendarSnapshot({
            userId: input.userId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          });

          const toolCallIndex = nextSubagentCallIndex();
          const result = await runWithSubagentBudget({
            toolName: 'search_calendar',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            minBudgetMs: CALENDAR_SEARCH_MIN_BUDGET_MS,
            uncappedBudget: true,
            run: (budgetContext) =>
              runCalendarSearch(
                {
                  query: args.query,
                  startDate: args.startDate,
                  endDate: args.endDate,
                  maxResults: args.maxResults,
                  minRelevance: args.minRelevance,
                },
                {
                  calendarSnapshot,
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone: userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek: dayOfWeek,
                  },
                  userContext: {
                    userEmail: input.userEmail,
                    requestContext: truncate(input.userRequest, 500),
                  },
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
          toolResultCache.set('search_calendar', cacheArgs, result);
          return result;
        },
      },
  };
}
