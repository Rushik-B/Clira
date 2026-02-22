import crypto from 'crypto';
import { z } from 'zod';
import { type Prisma, ActionHistoryType, PendingCalendarChangeStatus } from '@prisma/client';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { CalendarService } from '@/lib/services/core/calendarService';
import {
  getCalendarSnapshot,
  getCalendarMutationSnapshot,
  gatherMemoryContextForReply,
  type CalendarMutationSnapshotResult,
} from '@/lib/services/core/replyContextTools';
import { parseReminderTime } from '@/lib/utils/timeParser';
import {
  startOfDayInTimezone,
  endOfDayInTimezone,
  endOfTodayInTimezone,
  getDateOnlyInTimezone,
  addDaysToDateOnly,
  formatDateTimeInTimeZone,
  normalizeIsoDateInputToUtc,
} from '@/lib/utils/timezone';
import { runCalendarAnalysis } from '@/lib/ai/agents/calendarAnalysisSubagent';
import { runCalendarSearch } from '@/lib/ai/agents/calendarSearchSubagent';
import { runCalendarCreatorAgent, type AvailableCalendar } from '@/lib/ai/agents/calendarCreatorAgent';
import { runEmailRetrieval } from '@/lib/ai/agents/emailRetrievalSubagent';
import {
  type CalendarMutationTarget,
  buildMutationCandidates,
  createClarifyCalendarPlan,
  isCalendarTargetById,
  isCalendarTargetLookup,
  parsePendingCalendarChangeRecord,
  resolveMutationSearchRange,
} from '@/lib/ai/agents/executiveCalendarMutationHelpers';
import { getSupermemoryClient, isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import {
  createSendProgressUpdateTool,
} from '@/lib/ai/tools/sendProgressUpdate';
import { generateReauthUrl, REQUIRED_SCOPES } from '@/lib/auth/scope-utils';
import {
  type CalendarCreatorPlanDTO,
  type CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import {
  CALENDAR_SEARCH_MIN_BUDGET_MS,
  MESSAGING_INBOX_CALL_LIMITS,
  PENDING_CALENDAR_CHANGE_TTL_MS,
  PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS,
} from './constants';
import {
  type GoogleEventTime,
  buildToolBudgetExceededResult,
  generateMemoryCustomId,
  isCalendarScopeError,
  normalizeUpdateDraftTimesForPatch,
  runWithSubagentBudget,
  stripUndefined,
  summarizeAttendees,
  truncate,
  validateEventDraftTimes,
} from './helpers';
import type {
  ExecutiveRuntimeContext,
  PendingCalendarChangeRecord,
  SearchInboxContextArgs,
} from './types';

export function buildExecutiveAgentTools(context: ExecutiveRuntimeContext): Record<string, unknown> {
  const {
    input,
    channel: resolvedChannel,
    retrievalProfile,
    userTimezone,
    currentTimeUtc,
    currentTimeUserTz,
    dayOfWeek,
    toolAbort,
    toolAbortSignal,
    onMemoryStored,
  } = context;

    const inboxCallTracker = {
      quickCalls: 0,
      deepCalls: 0,
    };
    let subagentCallIndex = 0;

    const reminderRecurrenceSchema = z.object({
      type: z.enum(['daily', 'weekly', 'monthly']),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
      dayOfMonth: z.number().int().min(1).max(31).optional(),
      until: z.string().optional(),
    });
    const reminderClosedStatuses = new Set(['DISMISSED', 'COMPLETED', 'MISSED', 'CANCELLED']);
    const reminderNonCancelableStatuses = new Set(['DELIVERED', 'DISMISSED', 'COMPLETED', 'MISSED', 'CANCELLED']);

    const tools: Record<string, unknown> = {
      // ─────────────────────────────────────────────────────────────────────────
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

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          return runWithSubagentBudget({
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

          return {
            query: args.query,
            count: memories.length,
            memories: memories.map((m) => ({
              content: truncate(m.content, 400),
              relevanceScore: m.score,
            })),
          };
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

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          return runWithSubagentBudget({
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

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          return runWithSubagentBudget({
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
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 5: Plan Calendar Change
      // ─────────────────────────────────────────────────────────────────────────
      plan_calendar_change: {
        description:
          'Plan a calendar change (create/update/delete) with a confirmation-required preview. ' +
          'Always return a user-facing preview and a pending change for explicit confirmation. ' +
          'Use for calendar mutations only; never execute changes directly. ' +
          'When the plan moves or reschedules specific events: call search_calendar exactly once with one combined query (all event names) and one date range, then pass the returned events as resolvedEvents. Do not call search_calendar multiple times for the same plan. Required for performance.',
        inputSchema: z.object({
          request: z.string().min(1).max(1000).describe('User request describing the calendar change'),
          startDate: z
            .string()
            .optional()
            .describe('Optional start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local).'),
          endDate: z
            .string()
            .optional()
            .describe('Optional end date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local).'),
          forceNewPlan: z
            .boolean()
            .optional()
            .describe(
              'Set true ONLY when the user explicitly asks to modify an existing pending plan. If omitted/false and a pending change exists, the tool will return the existing pending change instead of creating a new one.',
            ),
          resolvedEvents: z
            .array(
              z.object({
                eventId: z.string(),
                calendarId: z.string(),
                name: z.string(),
                start: z.string(),
                end: z.string(),
              }),
            )
            .optional()
            .describe(
              'Events from a prior search_calendar call. When available, pass these so the planner can use eventId directly instead of lookupQuery.',
            ),
        }),
        execute: async (args: {
          request: string;
          startDate?: string;
          endDate?: string;
          forceNewPlan?: boolean;
          resolvedEvents?: Array<{ eventId: string; calendarId: string; name: string; start: string; end: string }>;
        }) => {
          const request = args.request?.trim() || input.userRequest;
          logger.info(`[executiveAgent] plan_calendar_change: "${truncate(request, 80)}"`);

          const existingPending = await prisma.pendingCalendarChange.findFirst({
            where: {
              userId: input.userId,
              conversationId: input.conversationId,
              status: { in: [PendingCalendarChangeStatus.PENDING, PendingCalendarChangeStatus.IN_PROGRESS] },
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              plan: true,
              resolvedTarget: true,
              userTimezone: true,
              userRequest: true,
              expiresAt: true,
              status: true,
              createdAt: true,
            },
          });

          if (existingPending && !args.forceNewPlan) {
            const pendingPayload = parsePendingCalendarChangeRecord(existingPending as PendingCalendarChangeRecord);
            if (!pendingPayload) {
              return {
                ok: false,
                error: 'invalid_pending_change',
                message:
                  'I found an existing pending calendar change, but it looks corrupted. Please ask me to plan it again.',
              };
            }

            const existingPlan = pendingPayload.plan;
            const previewText =
              existingPlan?.userPreviewText ??
              'I already have a pending calendar change. Reply "yes" to confirm or "no" to cancel.';

            return {
              ok: true,
              plan: existingPlan,
              previewText,
              pendingChange: {
                pendingId: existingPending.id,
                createdAt: existingPending.createdAt.toISOString(),
                expiresAt: existingPending.expiresAt.toISOString(),
                action: existingPlan?.action,
              },
              note:
                'Pending calendar change already exists. Confirm/cancel it, or explicitly ask to modify the plan.',
            };
          }

          // Fetch writable calendars so the subagent can pick the right one
          let availableCalendars: AvailableCalendar[] | undefined;
          try {
            const calService = await CalendarService.create({
              userId: input.userId,
              purpose: `${resolvedChannel}:calendar-list`,
              requester: 'executiveAgent.plan_calendar_change',
            });
            if (calService) {
              const calendars = await calService.listCalendars({ minAccessRole: 'writer' });
              availableCalendars = calendars.map((cal) => ({
                id: cal.id,
                summary: cal.summary,
                primary: cal.primary,
                accessRole: cal.accessRole,
              }));
            }
          } catch (error) {
            logger.warn('[executiveAgent] Failed to fetch calendar list for plan, falling back to primary', error);
          }

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          const planResult = await runWithSubagentBudget({
            toolName: 'plan_calendar_change',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            minBudgetMs: PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS,
            uncappedBudget: true,
            run: (budgetContext) =>
              runCalendarCreatorAgent(
                { request },
                {
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek,
                  },
                  availableCalendars,
                  resolvedEvents: args.resolvedEvents,
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });

          if ((planResult as { ok?: boolean })?.ok === false) {
            return planResult;
          }

          const plan = planResult as CalendarCreatorPlanDTO;

          if (plan.action === 'clarify') {
            return {
              ok: true,
              plan,
              previewText: plan.userPreviewText,
            };
          }

          let resolvedTarget: CalendarMutationTarget | undefined;
          let resolvedTargets: CalendarMutationTarget[] | undefined;
          let resolvedPlan: CalendarCreatorPlanDTO = plan;

          type LookupResolvedRange = {
            startDate: Date;
            endDate: Date;
          };

          type LookupTargetResolution = {
            index: number;
            target: Extract<CalendarTargetDTO, { lookupQuery: string }>;
            range: LookupResolvedRange;
          };

          const buildOverlappingLookupGroups = (
            lookupTargets: LookupTargetResolution[],
          ): Array<{
            startDate: Date;
            endDate: Date;
            items: LookupTargetResolution[];
          }> => {
            if (lookupTargets.length === 0) return [];

            const sorted = [...lookupTargets].sort(
              (a, b) => a.range.startDate.getTime() - b.range.startDate.getTime(),
            );

            const groups: Array<{
              startDate: Date;
              endDate: Date;
              items: LookupTargetResolution[];
            }> = [];

            for (const item of sorted) {
              const lastGroup = groups[groups.length - 1];
              if (!lastGroup || item.range.startDate.getTime() > lastGroup.endDate.getTime()) {
                groups.push({
                  startDate: item.range.startDate,
                  endDate: item.range.endDate,
                  items: [item],
                });
                continue;
              }

              lastGroup.items.push(item);
              if (item.range.endDate.getTime() > lastGroup.endDate.getTime()) {
                lastGroup.endDate = item.range.endDate;
              }
            }

            return groups;
          };

          const resolveLookupTarget = async (
            target: Extract<CalendarTargetDTO, { lookupQuery: string }>,
            batchIndex?: number,
            options?: {
              resolvedRange?: LookupResolvedRange;
              mutationSnapshot?: CalendarMutationSnapshotResult;
            },
          ):
            Promise<
              | {
                  kind: 'resolved';
                  target: CalendarMutationTarget;
                  planTarget: { calendarId: string; eventId: string };
                }
              | { kind: 'clarify'; plan: CalendarCreatorPlanDTO; previewText: string }
              | { kind: 'error'; error: string; message: string }
            > => {
              const itemSuffix = batchIndex !== undefined ? ` for item ${batchIndex + 1}` : '';
              let resolvedRange = options?.resolvedRange;
              if (!resolvedRange) {
                const rangeResult = resolveMutationSearchRange({
                  startDate: target.lookupRange?.startDate ?? args.startDate,
                  endDate: target.lookupRange?.endDate ?? args.endDate,
                  userTimezone,
                });

                if ('error' in rangeResult) {
                  const clarifyPlan = createClarifyCalendarPlan(
                    plan,
                    [`Which dates should I search${itemSuffix}?`],
                    `I need a clearer date range to find that event${itemSuffix}. ${rangeResult.error}`,
                  );

                  return {
                    kind: 'clarify',
                    plan: clarifyPlan,
                    previewText: clarifyPlan.userPreviewText,
                  };
                }

                resolvedRange = rangeResult;
              }

              const mutationSnapshot =
                options?.mutationSnapshot ??
                (await getCalendarMutationSnapshot({
                  userId: input.userId,
                  startDate: resolvedRange.startDate,
                  endDate: resolvedRange.endDate,
                }));

              if (!mutationSnapshot.success) {
                return {
                  kind: 'error',
                  error: 'calendar_unavailable',
                  message: mutationSnapshot.error || 'Calendar access unavailable.',
                };
              }

              const searchSnapshot = {
                success: mutationSnapshot.success,
                timezone: mutationSnapshot.timezone,
                dateRange: mutationSnapshot.dateRange,
                dateRangeUtc: mutationSnapshot.dateRangeUtc,
                events: mutationSnapshot.events.map((event) => ({
                  eventId: event.eventId,
                  calendarId: event.calendarId,
                  name: event.name,
                  start: event.start,
                  end: event.end,
                  isAllDay: event.isAllDay,
                  description: event.description,
                  location: event.location,
                  attendees: event.attendees,
                })),
                error: mutationSnapshot.error,
              };

              const searchResult = await runCalendarSearch(
                {
                  query: target.lookupQuery,
                  startDate: target.lookupRange?.startDate ?? args.startDate,
                  endDate: target.lookupRange?.endDate ?? args.endDate,
                  maxResults: 10,
                  minRelevance: 40,
                },
                {
                  calendarSnapshot: searchSnapshot,
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek,
                  },
                  userContext: {
                    userEmail: input.userEmail,
                    requestContext: truncate(input.userRequest, 500),
                  },
                  abortSignal: toolAbortSignal,
                  deadlineAt: toolAbort.deadlineAt,
                },
              );

              const highConfidenceMatches = searchResult.events.filter(
                (event) => event.relevanceScore >= 60,
              );
              const matchesToUse =
                highConfidenceMatches.length > 0 ? highConfidenceMatches : searchResult.events;

              const candidates = buildMutationCandidates(matchesToUse, mutationSnapshot.events);
              const uniqueCandidates = Array.from(
                new Map(candidates.map((candidate) => [candidate.eventId, candidate])).values(),
              );

              if (uniqueCandidates.length === 0) {
                const clarifyPlan = createClarifyCalendarPlan(
                  plan,
                  [`Which event should I change${itemSuffix}?`],
                  `I couldn’t find a matching event${itemSuffix}. Which event should I update or delete?`,
                );

                return {
                  kind: 'clarify',
                  plan: clarifyPlan,
                  previewText: clarifyPlan.userPreviewText,
                };
              }

              if (uniqueCandidates.length > 1) {
                const lines = uniqueCandidates.slice(0, 5).map((candidate, index) => {
                  const dayNote = candidate.isAllDay ? ' (all day)' : '';
                  return `${index + 1}) ${candidate.summary} — ${candidate.start}${dayNote}`;
                });
                const question = `Which event should I ${plan.action}${itemSuffix}? Reply with the number.`;
                const previewText = `I found multiple matches. ${question}\n${lines.join('\n')}`;

                const clarifyPlan = createClarifyCalendarPlan(plan, [question], previewText);

                return {
                  kind: 'clarify',
                  plan: clarifyPlan,
                  previewText,
                };
              }

              const match = uniqueCandidates[0];
              return {
                kind: 'resolved',
                target: {
                  calendarId: match.calendarId,
                  eventId: match.eventId,
                  etag: match.etag,
                },
                planTarget: {
                  calendarId: match.calendarId,
                  eventId: match.eventId,
                },
              };
          };

          if (plan.action === 'update' || plan.action === 'delete') {
            if (plan.targets?.length) {
              const batchResolvedTargets: CalendarMutationTarget[] = [];
              const batchPlanTargets: Array<{ calendarId: string; eventId: string }> = [];
              const lookupTargets: LookupTargetResolution[] = [];

              for (const [index, target] of plan.targets.entries()) {
                if (isCalendarTargetById(target)) {
                  continue;
                }

                if (isCalendarTargetLookup(target)) {
                  const rangeResult = resolveMutationSearchRange({
                    startDate: target.lookupRange?.startDate ?? args.startDate,
                    endDate: target.lookupRange?.endDate ?? args.endDate,
                    userTimezone,
                  });

                  if ('error' in rangeResult) {
                    const itemSuffix = ` for item ${index + 1}`;
                    const clarifyPlan = createClarifyCalendarPlan(
                      plan,
                      [`Which dates should I search${itemSuffix}?`],
                      `I need a clearer date range to find that event${itemSuffix}. ${rangeResult.error}`,
                    );

                    return {
                      ok: true,
                      plan: clarifyPlan,
                      previewText: clarifyPlan.userPreviewText,
                    };
                  }

                  lookupTargets.push({
                    index,
                    target,
                    range: rangeResult,
                  });
                }
              }

              const lookupSnapshotsByIndex = new Map<number, CalendarMutationSnapshotResult>();
              if (lookupTargets.length > 0) {
                const lookupGroups = buildOverlappingLookupGroups(lookupTargets);
                const groupSnapshots = await Promise.all(
                  lookupGroups.map(async (group) => ({
                    group,
                    mutationSnapshot: await getCalendarMutationSnapshot({
                      userId: input.userId,
                      startDate: group.startDate,
                      endDate: group.endDate,
                    }),
                  })),
                );

                for (const { group, mutationSnapshot } of groupSnapshots) {
                  if (!mutationSnapshot.success) {
                    return {
                      ok: false,
                      error: 'calendar_unavailable',
                      message: mutationSnapshot.error || 'Calendar access unavailable.',
                    };
                  }

                  for (const item of group.items) {
                    lookupSnapshotsByIndex.set(item.index, mutationSnapshot);
                  }
                }
              }

              const lookupRangeByIndex = new Map<number, LookupResolvedRange>(
                lookupTargets.map((item) => [item.index, item.range]),
              );
              const lookupTargetByIndex = new Map<number, LookupTargetResolution>(
                lookupTargets.map((item) => [item.index, item]),
              );

              const lookupResolutions = await Promise.all(
                lookupTargets.map(async (item) => {
                  const lookupResolution = await resolveLookupTarget(item.target, item.index, {
                    resolvedRange: item.range,
                    mutationSnapshot: lookupSnapshotsByIndex.get(item.index),
                  });
                  return { index: item.index, lookupResolution };
                }),
              );

              const firstLookupFailure = lookupResolutions
                .filter(({ lookupResolution }) => lookupResolution.kind !== 'resolved')
                .sort((a, b) => a.index - b.index)[0];

              if (firstLookupFailure) {
                const { lookupResolution } = firstLookupFailure;
                if (lookupResolution.kind === 'error') {
                  return {
                    ok: false,
                    error: lookupResolution.error,
                    message: lookupResolution.message,
                  };
                }

                if (lookupResolution.kind === 'clarify') {
                  return {
                    ok: true,
                    plan: lookupResolution.plan,
                    previewText: lookupResolution.previewText,
                  };
                }

                return {
                  ok: false,
                  error: 'lookup_resolution_failed',
                  message: 'I could not resolve one of the target events. Please try again.',
                };
              }

              const lookupResolutionByIndex = new Map(
                lookupResolutions.map(({ index, lookupResolution }) => [index, lookupResolution]),
              );

              for (const [index, target] of plan.targets.entries()) {
                if (isCalendarTargetById(target)) {
                  const calendarId = target.calendarId ?? plan.calendarId ?? 'primary';
                  batchResolvedTargets.push({
                    calendarId,
                    eventId: target.eventId,
                  });
                  batchPlanTargets.push({
                    calendarId,
                    eventId: target.eventId,
                  });
                  continue;
                }

                if (isCalendarTargetLookup(target)) {
                  const lookupResolution = lookupResolutionByIndex.get(index);
                  if (!lookupResolution || lookupResolution.kind !== 'resolved') {
                    const lookupItem = lookupTargetByIndex.get(index);
                    const lookupRange = lookupRangeByIndex.get(index);
                    logger.warn(
                      '[executiveAgent] Missing resolved lookup target during batch plan resolution',
                      {
                        lookupQuery: lookupItem?.target.lookupQuery ?? target.lookupQuery,
                        hasRange: Boolean(lookupRange),
                        index,
                      },
                    );
                    return {
                      ok: false,
                      error: 'lookup_resolution_failed',
                      message: 'I could not resolve one of the target events. Please try again.',
                    };
                  }
                  batchResolvedTargets.push(lookupResolution.target);
                  batchPlanTargets.push(lookupResolution.planTarget);
                }
              }

              resolvedTargets = batchResolvedTargets;
              resolvedPlan = {
                ...plan,
                target: undefined,
                targets: batchPlanTargets,
              };
            } else if (plan.target) {
              if (isCalendarTargetById(plan.target)) {
                resolvedTarget = {
                  calendarId: plan.target.calendarId ?? plan.calendarId ?? 'primary',
                  eventId: plan.target.eventId,
                };
              } else if (isCalendarTargetLookup(plan.target)) {
                const lookupResolution = await resolveLookupTarget(plan.target);
                if (lookupResolution.kind === 'error') {
                  return {
                    ok: false,
                    error: lookupResolution.error,
                    message: lookupResolution.message,
                  };
                }
                if (lookupResolution.kind === 'clarify') {
                  return {
                    ok: true,
                    plan: lookupResolution.plan,
                    previewText: lookupResolution.previewText,
                  };
                }

                resolvedTarget = lookupResolution.target;
                resolvedPlan = {
                  ...plan,
                  targets: undefined,
                  target: lookupResolution.planTarget,
                };
              }
            }
          }

          if (
            (plan.action === 'update' || plan.action === 'delete') &&
            !resolvedTarget &&
            (!resolvedTargets || resolvedTargets.length === 0)
          ) {
            const clarifyPlan = createClarifyCalendarPlan(
              plan,
              ['Which event should I change?'],
              'Which event should I update or delete?',
            );

            return {
              ok: true,
              plan: clarifyPlan,
              previewText: clarifyPlan.userPreviewText,
            };
          }

          const now = new Date();
          const expiresAt = new Date(now.getTime() + PENDING_CALENDAR_CHANGE_TTL_MS);
          await prisma.pendingCalendarChange.updateMany({
            where: {
              userId: input.userId,
              conversationId: input.conversationId,
              status: PendingCalendarChangeStatus.PENDING,
            },
            data: {
              status: PendingCalendarChangeStatus.CANCELLED,
              cancelledAt: now,
            },
          });

          const resolvedTargetPayload = resolvedTargets?.length
            ? resolvedTargets
            : resolvedTarget ?? null;

          const pendingRecord = await prisma.pendingCalendarChange.create({
            data: {
              userId: input.userId,
              conversationId: input.conversationId,
              plan: resolvedPlan as Prisma.InputJsonValue,
              resolvedTarget: resolvedTargetPayload as Prisma.InputJsonValue,
              userTimezone,
              userRequest: request,
              expiresAt,
              status: PendingCalendarChangeStatus.PENDING,
            },
          });

          try {
            const eventCount = resolvedPlan.eventDrafts?.length
              ? resolvedPlan.eventDrafts.length
              : resolvedPlan.eventDraft
                ? 1
                : 0;
            await prisma.actionHistory.create({
              data: {
                userId: input.userId,
                actionType: ActionHistoryType.CALENDAR_CHANGE_PROPOSED,
                actionSummary: `Proposed calendar ${resolvedPlan.action}`,
                actionDetails: {
                  pendingId: pendingRecord.id,
                  action: resolvedPlan.action,
                  calendarId:
                    resolvedTarget?.calendarId ??
                    resolvedTargets?.[0]?.calendarId ??
                    resolvedPlan.calendarId ??
                    'primary',
                  eventId: resolvedTarget?.eventId ?? null,
                  eventIds: resolvedTargets?.map((target) => target.eventId) ?? undefined,
                  sendUpdates: resolvedPlan.sendUpdates,
                  createMeetLink: resolvedPlan.createMeetLink,
                  summary: resolvedPlan.eventDraft?.summary ?? null,
                  eventCount,
                  targetCount: resolvedTargets?.length ?? (resolvedTarget ? 1 : 0),
                  expiresAt: expiresAt.toISOString(),
                },
                undoable: false,
                metadata: {
                  source: 'executive-agent',
                  type: 'calendar-change-proposal',
                },
              },
            });
          } catch (error) {
            logger.warn('[executiveAgent] Failed to log calendar proposal', error);
          }

          return {
            ok: true,
            plan: resolvedPlan,
            previewText: resolvedPlan.userPreviewText,
            pendingChange: {
              pendingId: pendingRecord.id,
              createdAt: pendingRecord.createdAt.toISOString(),
              expiresAt: pendingRecord.expiresAt.toISOString(),
              action: resolvedPlan.action,
            },
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 6: Commit Calendar Change
      // ─────────────────────────────────────────────────────────────────────────
      commit_calendar_change: {
        description:
          'Finalize the latest pending calendar change. ' +
          'Use decision="confirm" only after explicit confirmation. Use decision="cancel" when the user declines.',
        inputSchema: z.object({
          decision: z.enum(['confirm', 'cancel']),
        }),
        execute: async (args: { decision: 'confirm' | 'cancel' }) => {
          const latestPending = await prisma.pendingCalendarChange.findFirst({
            where: {
              userId: input.userId,
              conversationId: input.conversationId,
              status: { in: [PendingCalendarChangeStatus.PENDING, PendingCalendarChangeStatus.IN_PROGRESS] },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              plan: true,
              resolvedTarget: true,
              userTimezone: true,
              userRequest: true,
              expiresAt: true,
              status: true,
              createdAt: true,
            },
          });

          if (!latestPending) {
            return {
              ok: false,
              error: 'pending_change_missing',
              message: 'No pending calendar change found. Please ask me to plan it again first.',
            };
          }

          if (Date.now() > latestPending.expiresAt.getTime()) {
            await prisma.pendingCalendarChange.updateMany({
              where: {
                id: latestPending.id,
                status: {
                  in: [PendingCalendarChangeStatus.PENDING, PendingCalendarChangeStatus.IN_PROGRESS],
                },
              },
              data: {
                status: PendingCalendarChangeStatus.EXPIRED,
              },
            });

            return {
              ok: false,
              error: 'pending_change_expired',
              message: 'That pending calendar change expired. Please ask me to plan it again.',
            };
          }

          if (latestPending.status === PendingCalendarChangeStatus.IN_PROGRESS) {
            return {
              ok: false,
              error: 'pending_change_in_progress',
              message: 'That calendar change is already being processed. Please wait a moment.',
            };
          }

          if (args.decision === 'cancel') {
            await prisma.pendingCalendarChange.updateMany({
              where: {
                id: latestPending.id,
                status: PendingCalendarChangeStatus.PENDING,
              },
              data: {
                status: PendingCalendarChangeStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            });

            return {
              ok: true,
              status: 'cancelled',
              message: 'Okay, I cancelled that pending calendar change.',
            };
          }

          const claim = await prisma.pendingCalendarChange.updateMany({
            where: {
              id: latestPending.id,
              status: PendingCalendarChangeStatus.PENDING,
            },
            data: {
              status: PendingCalendarChangeStatus.IN_PROGRESS,
            },
          });

          if (claim.count !== 1) {
            return {
              ok: false,
              error: 'pending_change_in_progress',
              message: 'That calendar change is already being processed.',
            };
          }

          const markPendingConsumed = async () => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.CONSUMED,
                consumedAt: new Date(),
              },
            });
          };

          const releasePending = async () => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.PENDING,
              },
            });
          };

          const cancelPending = async () => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            });
          };

          const pendingPayload = parsePendingCalendarChangeRecord(
            latestPending as PendingCalendarChangeRecord,
          );
          if (!pendingPayload) {
            await cancelPending();
            return {
              ok: false,
              error: 'invalid_pending_change',
              message: 'The pending calendar change is invalid. Please plan it again.',
            };
          }

          const plan = pendingPayload.plan;
          const calendarId = pendingPayload.resolvedTarget?.calendarId ?? plan.calendarId ?? 'primary';

          const calendarService = await CalendarService.create({
            userId: input.userId,
            purpose: `${resolvedChannel}:calendar-mutation`,
            requester: 'executiveAgent.commit_calendar_change',
          });

          if (!calendarService) {
            await releasePending();
            return {
              ok: false,
              error: 'calendar_unavailable',
              message: 'No calendar access available. Please reconnect your calendar.',
            };
          }

          try {
            if (plan.action === 'create') {
              const drafts = plan.eventDrafts?.length
                ? plan.eventDrafts
                : plan.eventDraft
                  ? [plan.eventDraft]
                  : [];

              if (drafts.length === 0) {
                await cancelPending();
                return { ok: false, error: 'invalid_plan', message: 'Missing event details for creation.' };
              }

              const createdEvents: Array<{
                eventId: string | null | undefined;
                htmlLink?: string | null;
                summary: string;
              }> = [];
              const failures: Array<{ index: number; summary: string; message: string }> = [];

              for (const [index, draft] of drafts.entries()) {
                const timeValidation = validateEventDraftTimes(draft, 'create');
                if (!timeValidation.ok) {
                  failures.push({
                    index,
                    summary: draft.summary ?? `Event ${index + 1}`,
                    message: timeValidation.message,
                  });
                  continue;
                }

                // Per-draft calendarId overrides plan-level default
                const draftCalendarId = (draft as { calendarId?: string }).calendarId ?? calendarId;

                const conferenceData = plan.createMeetLink
                  ? {
                      createRequest: {
                        requestId: crypto.randomUUID(),
                        conferenceSolutionKey: { type: 'hangoutsMeet' },
                      },
                    }
                  : undefined;

                // Strip calendarId from the draft before building requestBody
                // (calendarId is a path param for Google API, not an event field)
                const { calendarId: _draftCalId, ...draftWithoutCalendarId } = draft as Record<string, unknown>;

                const requestBody = stripUndefined({
                  ...draftWithoutCalendarId,
                  extendedProperties: {
                    private: {
                      cliraPendingId: latestPending.id,
                      cliraSource: 'calendarCreatorAgent',
                    },
                  },
                  conferenceData,
                } satisfies Record<string, unknown>);

                try {
                  const response = await calendarService.createEvent({
                    calendarId: draftCalendarId,
                    requestBody,
                    conferenceDataVersion: conferenceData ? 1 : undefined,
                    sendUpdates: plan.sendUpdates,
                  });

                  const event = response.data;
                  const summary = event.summary ?? draft.summary ?? '(No title)';

                  createdEvents.push({
                    eventId: event.id,
                    htmlLink: event.htmlLink,
                    summary,
                  });

                  await prisma.actionHistory.create({
                    data: {
                      userId: input.userId,
                      actionType: ActionHistoryType.CALENDAR_EVENT_CREATED,
                      actionSummary: `Created calendar event: ${summary}`,
                      actionDetails: {
                        calendarId: draftCalendarId,
                        eventId: event.id,
                        htmlLink: event.htmlLink,
                        sendUpdates: plan.sendUpdates,
                        createMeetLink: plan.createMeetLink,
                        start: event.start as Prisma.InputJsonValue,
                        end: event.end as Prisma.InputJsonValue,
                        attendees: summarizeAttendees(event.attendees),
                      },
                      undoable: false,
                      metadata: {
                        source: 'executive-agent',
                        pendingId: latestPending.id,
                      },
                    },
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Unknown error';
                  failures.push({
                    index,
                    summary: draft.summary ?? `Event ${index + 1}`,
                    message,
                  });
                }
              }

              if (createdEvents.length > 0) {
                await markPendingConsumed();
                const status = failures.length > 0 ? 'partial' : 'created';
                const message = failures.length > 0
                  ? `Created ${createdEvents.length} event(s), but ${failures.length} failed.`
                  : `Created ${createdEvents.length} calendar event(s).`;
                return {
                  ok: failures.length === 0,
                  status,
                  message,
                  createdCount: createdEvents.length,
                  failedCount: failures.length,
                  createdEvents,
                  failures,
                };
              }

              await releasePending();
              const firstFailure = failures[0]?.message ?? 'No events were created.';
              return {
                ok: false,
                error: 'calendar_commit_failed',
                message: `Could not create the event(s): ${firstFailure}`,
                failedCount: failures.length,
                failures,
              };
            }

            if (plan.action === 'update') {
              if (pendingPayload.resolvedTargets?.length) {
                if (!plan.eventDrafts || plan.eventDrafts.length !== pendingPayload.resolvedTargets.length) {
                  await cancelPending();
                  return {
                    ok: false,
                    error: 'invalid_plan',
                    message: 'Batch updates require matching targets and eventDrafts.',
                  };
                }

                const updatedEvents: Array<{
                  eventId: string | null | undefined;
                  htmlLink?: string | null;
                  summary: string;
                }> = [];
                const failures: Array<{ index: number; summary: string; message: string }> = [];

                for (const [index, target] of pendingPayload.resolvedTargets.entries()) {
                  const draft = plan.eventDrafts[index];
                  if (!draft) {
                    failures.push({
                      index,
                      summary: `Event ${index + 1}`,
                      message: 'Missing update fields for this target.',
                    });
                    continue;
                  }

                  const draftKeys = Object.entries(draft).filter(([, value]) => value !== undefined);
                  if (draftKeys.length === 0) {
                    failures.push({
                      index,
                      summary: draft.summary ?? `Event ${index + 1}`,
                      message: 'No update fields were provided.',
                    });
                    continue;
                  }

                  try {
                    const currentEventResponse = await calendarService.getEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                    });

                    const currentEvent = currentEventResponse.data;

                    const normalizedDraft = normalizeUpdateDraftTimesForPatch({
                      draft,
                      currentEvent: {
                        start: currentEvent.start as GoogleEventTime | null | undefined,
                        end: currentEvent.end as GoogleEventTime | null | undefined,
                      },
                    });

                    if (!normalizedDraft.ok) {
                      failures.push({
                        index,
                        summary: draft.summary ?? `Event ${index + 1}`,
                        message: normalizedDraft.message,
                      });
                      continue;
                    }

                    const timeValidation = validateEventDraftTimes(normalizedDraft.patch, 'update');
                    if (!timeValidation.ok) {
                      failures.push({
                        index,
                        summary: draft.summary ?? `Event ${index + 1}`,
                        message: timeValidation.message,
                      });
                      continue;
                    }

                    const conferenceData = plan.createMeetLink
                      ? {
                          createRequest: {
                            requestId: crypto.randomUUID(),
                            conferenceSolutionKey: { type: 'hangoutsMeet' },
                          },
                        }
                      : undefined;

                    const requestBody = stripUndefined({
                      ...normalizedDraft.patch,
                      extendedProperties: {
                        private: {
                          ...(currentEvent.extendedProperties?.private ?? {}),
                          cliraPendingId: latestPending.id,
                          cliraSource: 'calendarCreatorAgent',
                        },
                      },
                      conferenceData,
                    } satisfies Record<string, unknown>);

                    const response = await calendarService.patchEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                      requestBody,
                      conferenceDataVersion: conferenceData ? 1 : undefined,
                      sendUpdates: plan.sendUpdates,
                      ifMatchEtag: currentEvent.etag ?? target.etag,
                    });

                    const updatedEvent = response.data;
                    const summary = updatedEvent.summary ?? currentEvent.summary ?? draft.summary ?? '(No title)';

                    updatedEvents.push({
                      eventId: updatedEvent.id,
                      htmlLink: updatedEvent.htmlLink,
                      summary,
                    });

                    await prisma.actionHistory.create({
                      data: {
                        userId: input.userId,
                        actionType: ActionHistoryType.CALENDAR_EVENT_UPDATED,
                        actionSummary: `Updated calendar event: ${summary}`,
                        actionDetails: {
                          calendarId: target.calendarId,
                          eventId: target.eventId,
                          htmlLink: updatedEvent.htmlLink,
                          sendUpdates: plan.sendUpdates,
                          createMeetLink: plan.createMeetLink,
                          start: (updatedEvent.start ?? currentEvent.start) as Prisma.InputJsonValue,
                          end: (updatedEvent.end ?? currentEvent.end) as Prisma.InputJsonValue,
                          attendees: summarizeAttendees(updatedEvent.attendees ?? currentEvent.attendees),
                        },
                        undoable: false,
                        metadata: {
                          source: 'executive-agent',
                          pendingId: latestPending.id,
                        },
                      },
                    });
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    failures.push({
                      index,
                      summary: draft.summary ?? `Event ${index + 1}`,
                      message,
                    });
                  }
                }

                if (updatedEvents.length > 0) {
                  await markPendingConsumed();
                  const status = failures.length > 0 ? 'partial' : 'updated';
                  const message = failures.length > 0
                    ? `Updated ${updatedEvents.length} event(s), but ${failures.length} failed.`
                    : `Updated ${updatedEvents.length} calendar event(s).`;
                  return {
                    ok: failures.length === 0,
                    status,
                    message,
                    updatedCount: updatedEvents.length,
                    failedCount: failures.length,
                    updatedEvents,
                    failures,
                  };
                }

                await releasePending();
                const firstFailure = failures[0]?.message ?? 'No events were updated.';
                return {
                  ok: false,
                  error: 'calendar_commit_failed',
                  message: `Could not update the event(s): ${firstFailure}`,
                  failedCount: failures.length,
                  failures,
                };
              }

              if (!pendingPayload.resolvedTarget) {
                await cancelPending();
                return {
                  ok: false,
                  error: 'missing_target',
                  message: 'No event target found for this update.',
                };
              }

              if (!plan.eventDraft) {
                await cancelPending();
                return { ok: false, error: 'invalid_plan', message: 'Missing fields to update.' };
              }

              const draftKeys = Object.entries(plan.eventDraft).filter(([, value]) => value !== undefined);
              if (draftKeys.length === 0) {
                await cancelPending();
                return { ok: false, error: 'invalid_plan', message: 'No update fields were provided.' };
              }

              const currentEventResponse = await calendarService.getEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
              });

              const currentEvent = currentEventResponse.data;

              const normalizedDraft = normalizeUpdateDraftTimesForPatch({
                draft: plan.eventDraft,
                currentEvent: {
                  start: currentEvent.start as GoogleEventTime | null | undefined,
                  end: currentEvent.end as GoogleEventTime | null | undefined,
                },
              });

              if (!normalizedDraft.ok) {
                await cancelPending();
                return { ok: false, error: 'invalid_event_time', message: normalizedDraft.message };
              }

              const timeValidation = validateEventDraftTimes(normalizedDraft.patch, 'update');
              if (!timeValidation.ok) {
                await cancelPending();
                return { ok: false, error: 'invalid_event_time', message: timeValidation.message };
              }

              const conferenceData = plan.createMeetLink
                ? {
                    createRequest: {
                      requestId: crypto.randomUUID(),
                      conferenceSolutionKey: { type: 'hangoutsMeet' },
                    },
                  }
                : undefined;

              const requestBody = stripUndefined({
                ...normalizedDraft.patch,
                extendedProperties: {
                  private: {
                    ...(currentEvent.extendedProperties?.private ?? {}),
                    cliraPendingId: latestPending.id,
                    cliraSource: 'calendarCreatorAgent',
                  },
                },
                conferenceData,
              } satisfies Record<string, unknown>);

              const response = await calendarService.patchEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
                requestBody,
                conferenceDataVersion: conferenceData ? 1 : undefined,
                sendUpdates: plan.sendUpdates,
                ifMatchEtag: currentEvent.etag ?? pendingPayload.resolvedTarget.etag,
              });

              const updatedEvent = response.data;

              await markPendingConsumed();

              await prisma.actionHistory.create({
                data: {
                  userId: input.userId,
                  actionType: ActionHistoryType.CALENDAR_EVENT_UPDATED,
                  actionSummary: `Updated calendar event: ${updatedEvent.summary ?? currentEvent.summary ?? '(No title)'}`,
                  actionDetails: {
                    calendarId: pendingPayload.resolvedTarget.calendarId,
                    eventId: pendingPayload.resolvedTarget.eventId,
                    htmlLink: updatedEvent.htmlLink,
                    sendUpdates: plan.sendUpdates,
                    createMeetLink: plan.createMeetLink,
                    start: (updatedEvent.start ?? currentEvent.start) as Prisma.InputJsonValue,
                    end: (updatedEvent.end ?? currentEvent.end) as Prisma.InputJsonValue,
                    attendees: summarizeAttendees(updatedEvent.attendees ?? currentEvent.attendees),
                  },
                  undoable: false,
                  metadata: {
                    source: 'executive-agent',
                    pendingId: latestPending.id,
                  },
                },
              });

              return {
                ok: true,
                status: 'updated',
                message: 'Updated the calendar event.',
                eventId: updatedEvent.id,
                htmlLink: updatedEvent.htmlLink,
                summary: updatedEvent.summary ?? currentEvent.summary ?? '(No title)',
              };
            }

            if (plan.action === 'delete') {
              if (pendingPayload.resolvedTargets?.length) {
                const deletedEvents: Array<{
                  eventId: string;
                  summary: string;
                }> = [];
                const failures: Array<{ index: number; summary: string; message: string }> = [];

                for (const [index, target] of pendingPayload.resolvedTargets.entries()) {
                  try {
                    const currentEventResponse = await calendarService.getEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                    });
                    const currentEvent = currentEventResponse.data;

                    await calendarService.deleteEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                      sendUpdates: plan.sendUpdates,
                      ifMatchEtag: currentEvent.etag ?? target.etag,
                    });

                    const summary = currentEvent.summary ?? '(No title)';
                    deletedEvents.push({
                      eventId: target.eventId,
                      summary,
                    });

                    await prisma.actionHistory.create({
                      data: {
                        userId: input.userId,
                        actionType: ActionHistoryType.CALENDAR_EVENT_DELETED,
                        actionSummary: `Deleted calendar event: ${summary}`,
                        actionDetails: {
                          calendarId: target.calendarId,
                          eventId: target.eventId,
                          sendUpdates: plan.sendUpdates,
                          createMeetLink: plan.createMeetLink,
                          start: currentEvent.start as Prisma.InputJsonValue,
                          end: currentEvent.end as Prisma.InputJsonValue,
                          attendees: summarizeAttendees(currentEvent.attendees),
                        } as Prisma.InputJsonObject,
                        undoable: false,
                        metadata: {
                          source: 'executive-agent',
                          pendingId: latestPending.id,
                        },
                      },
                    });
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    failures.push({
                      index,
                      summary: `Event ${index + 1}`,
                      message,
                    });
                  }
                }

                if (deletedEvents.length > 0) {
                  await markPendingConsumed();
                  const status = failures.length > 0 ? 'partial' : 'deleted';
                  const message = failures.length > 0
                    ? `Deleted ${deletedEvents.length} event(s), but ${failures.length} failed.`
                    : `Deleted ${deletedEvents.length} calendar event(s).`;
                  return {
                    ok: failures.length === 0,
                    status,
                    message,
                    deletedCount: deletedEvents.length,
                    failedCount: failures.length,
                    deletedEvents,
                    failures,
                  };
                }

                await releasePending();
                const firstFailure = failures[0]?.message ?? 'No events were deleted.';
                return {
                  ok: false,
                  error: 'calendar_commit_failed',
                  message: `Could not delete the event(s): ${firstFailure}`,
                  failedCount: failures.length,
                  failures,
                };
              }

              if (!pendingPayload.resolvedTarget) {
                await cancelPending();
                return {
                  ok: false,
                  error: 'missing_target',
                  message: 'No event target found for this deletion.',
                };
              }

              const currentEventResponse = await calendarService.getEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
              });
              const currentEvent = currentEventResponse.data;

              await calendarService.deleteEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
                sendUpdates: plan.sendUpdates,
                ifMatchEtag: currentEvent.etag ?? pendingPayload.resolvedTarget.etag,
              });

              await markPendingConsumed();

              await prisma.actionHistory.create({
                data: {
                  userId: input.userId,
                  actionType: ActionHistoryType.CALENDAR_EVENT_DELETED,
                  actionSummary: `Deleted calendar event: ${currentEvent.summary ?? '(No title)'}`,
                  actionDetails: {
                    calendarId: pendingPayload.resolvedTarget.calendarId,
                    eventId: pendingPayload.resolvedTarget.eventId,
                    sendUpdates: plan.sendUpdates,
                    createMeetLink: plan.createMeetLink,
                    start: currentEvent.start as Prisma.InputJsonValue,
                    end: currentEvent.end as Prisma.InputJsonValue,
                    attendees: summarizeAttendees(currentEvent.attendees),
                  } as Prisma.InputJsonObject,
                  undoable: false,
                  metadata: {
                    source: 'executive-agent',
                    pendingId: latestPending.id,
                  },
                },
              });

              return {
                ok: true,
                status: 'deleted',
                message: 'Deleted the calendar event.',
                eventId: pendingPayload.resolvedTarget.eventId,
                summary: currentEvent.summary ?? '(No title)',
              };
            }

            await cancelPending();
            return {
              ok: false,
              error: 'invalid_plan',
              message: 'Calendar change is not ready to commit.',
            };
          } catch (error) {
            if (isCalendarScopeError(error)) {
              await releasePending();
              return {
                ok: false,
                error: 'calendar_scope_missing',
                message: 'Calendar write access is required. Please reconnect Google Calendar.',
                reauthUrl: generateReauthUrl([REQUIRED_SCOPES.CALENDAR_EVENTS]),
              };
            }

            const message = error instanceof Error ? error.message : 'Unknown error';
            await releasePending();
            return {
              ok: false,
              error: 'calendar_commit_failed',
              message,
            };
          }
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 7: Append to Memory
      // ─────────────────────────────────────────────────────────────────────────
      append_to_supermemory: {
        description:
          'Store a fact to memory so you remember it in future conversations. Call in two cases: ' +
          '(1) When the user reveals names, roles, preferences, or facts—store them. ' +
          '(2) When you DISCOVER accurate, high-confidence facts from your tools (search_inbox_context, search_calendar)—e.g. you find "Dr. Smith" is the user\'s statistics professor from emails, or "Sarah" is their manager from calendar—store that too. ' +
          'High confidence only; don\'t guess. One atomic sentence per memory. Memory is deduped—storing the same fact twice is safe. You can\'t rely on the user to say everything.',
        inputSchema: z.object({
          content: z.string().min(1).max(300).describe('Atomic memory line (1 sentence describing a user fact)'),
          type: z
            .enum(['user_preference', 'user_fact', 'relationship_info', 'scheduling_preference', 'communication_style'])
            .default('user_preference')
            .describe('Category of the memory'),
        }),
        execute: async (args: { content: string; type: string }) => {
          logger.info(`[executiveAgent] append_to_supermemory: "${truncate(args.content, 50)}"`);

          if (!isSupermemoryConfigured()) {
            return { stored: false, reason: 'Memory system not configured' };
          }

          try {
            const customId = generateMemoryCustomId(input.userId, resolvedChannel, args.content);
            const client = getSupermemoryClient();

            await client.addDocument({
              content: args.content,
              customId,
              metadata: {
                type: args.type,
                source: resolvedChannel,
                timestamp: new Date().toISOString(),
              },
              containerTags: [input.userId],
              userId: input.userId,
            });

            onMemoryStored();
            logger.info(`[executiveAgent] Memory stored: customId=${customId}`);

            return { stored: true, customId };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.warn(`[executiveAgent] Memory storage failed: ${message}`);
            return { stored: false, reason: message };
          }
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 8: Add Email Alert
      // ─────────────────────────────────────────────────────────────────────────
      add_email_alert: {
        description:
          'Create an email notification alert. You will be notified via your linked messaging channel when matching emails arrive. ' +
          'Examples: "emails from my teacher", "emails about invoices", "emails from john@company.com", etc...',
        inputSchema: z.object({
          description: z
            .string()
            .min(5)
            .max(300)
            .describe('What emails to alert on (natural language)'),
        }),
        execute: async (args: { description: string }) => {
          const description = args.description.trim();
          if (description.length < 5) {
            return { success: false, message: 'Please provide a longer alert description.' };
          }

          const alert = await prisma.emailAlert.create({
            data: {
              userId: input.userId,
              description,
              isActive: true,
            },
          });

          logger.info(`[executiveAgent] Created email alert: ${alert.id}`);

          return {
            success: true,
            alertId: alert.id,
            description,
            message: `Got it! I'll notify you when emails matching "${description}" arrive.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 9: Remove Email Alert
      // ─────────────────────────────────────────────────────────────────────────
      remove_email_alert: {
        description:
          'Remove an email alert by ID or find by description. ' +
          'Use list_email_alerts first to see active alerts.',
        inputSchema: z.object({
          alertId: z.string().optional().describe('Alert ID to remove'),
          descriptionMatch: z.string().optional().describe('Find alert by partial description match'),
        }),
        execute: async (args: { alertId?: string; descriptionMatch?: string }) => {
          if (!args.alertId && !args.descriptionMatch) {
            return { success: false, message: 'Provide an alertId or descriptionMatch.' };
          }

          let alert: { id: string; description: string } | null = null;

          if (args.alertId) {
            alert = await prisma.emailAlert.findFirst({
              where: { id: args.alertId, userId: input.userId },
              select: { id: true, description: true },
            });
          } else if (args.descriptionMatch) {
            alert = await prisma.emailAlert.findFirst({
              where: {
                userId: input.userId,
                isActive: true,
                description: { contains: args.descriptionMatch, mode: 'insensitive' },
              },
              select: { id: true, description: true },
            });
          }

          if (!alert) {
            return { success: false, message: 'Alert not found.' };
          }

          await prisma.emailAlert.delete({ where: { id: alert.id } });
          logger.info(`[executiveAgent] Removed email alert: ${alert.id}`);

          return {
            success: true,
            alertId: alert.id,
            message: `Removed alert: "${alert.description}"`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 10: List Email Alerts
      // ─────────────────────────────────────────────────────────────────────────
      list_email_alerts: {
        description: 'List all active email alerts.',
        inputSchema: z.object({}),
        execute: async () => {
          const alerts = await prisma.emailAlert.findMany({
            where: { userId: input.userId, isActive: true },
            orderBy: { createdAt: 'desc' },
            select: { id: true, description: true, createdAt: true },
          });

          return {
            count: alerts.length,
            alerts: alerts.map((alert) => ({
              id: alert.id,
              description: alert.description,
              createdAt: alert.createdAt.toISOString(),
            })),
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 11: Add Reminder
      // ─────────────────────────────────────────────────────────────────────────
      add_reminder: {
        description:
          'Create a time-based reminder. Prefer natural language like "today 4pm", "tomorrow 9am", or "4:00 PM" (assumed in the user\'s timezone). ' +
          'Only use ISO timestamps if you are certain about timezone conversion: a trailing "Z" means UTC. ' +
          'Always ensure the time is in the future.',
        inputSchema: z.object({
          title: z.string().min(1).max(200).describe('Short reminder title'),
          scheduledAt: z.string().min(1).max(200).describe('Reminder time (natural language preferred; ISO UTC allowed)'),
          context: z.string().max(1000).optional().describe('Additional context or urgency notes'),
          recurrence: reminderRecurrenceSchema.optional(),
          linkedEmailId: z.string().optional(),
          linkedEventId: z.string().optional(),
        }),
        execute: async (args: {
          title: string;
          scheduledAt: string;
          context?: string;
          recurrence?: z.infer<typeof reminderRecurrenceSchema>;
          linkedEmailId?: string;
          linkedEventId?: string;
        }) => {
          const title = args.title.trim();
          if (!title) {
            return { success: false, message: 'Reminder title is required.' };
          }

          const now = new Date();
          const parsed = parseReminderTime(args.scheduledAt, { now, timeZone: userTimezone });
          if (!parsed || Number.isNaN(parsed.date.getTime())) {
            return { success: false, message: 'Could not parse the reminder time. Try a specific time.' };
          }
          if (parsed.date.getTime() <= now.getTime()) {
            return { success: false, message: 'That time is in the past. Provide a future time.' };
          }

          if (args.recurrence?.until) {
            const untilDate = new Date(args.recurrence.until);
            if (Number.isNaN(untilDate.getTime())) {
              return { success: false, message: 'Recurrence "until" must be a valid ISO date.' };
            }
            if (untilDate.getTime() <= parsed.date.getTime()) {
              return { success: false, message: 'Recurrence "until" must be after the scheduled time.' };
            }
          }

          const reminder = await prisma.reminder.create({
            data: {
              userId: input.userId,
              title,
              context: args.context?.trim() || undefined,
              scheduledAt: parsed.date,
              recurrence: args.recurrence ?? undefined,
              linkedEmailId: args.linkedEmailId,
              linkedEventId: args.linkedEventId,
            },
          });

          const scheduledAtLocal = formatDateTimeInTimeZone(reminder.scheduledAt, userTimezone);

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_CREATED',
              actionSummary: `Reminder created: ${title}`,
              actionDetails: {
                reminderId: reminder.id,
                scheduledAt: reminder.scheduledAt.toISOString(),
                scheduledAtLocal,
                recurrence: args.recurrence ?? undefined,
                confidence: parsed.confidence,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: reminder.id,
            scheduledAt: reminder.scheduledAt.toISOString(),
            scheduledAtLocal,
            confidence: parsed.confidence,
            message: `Got it. I'll remind you on ${scheduledAtLocal}.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 12: List Reminders
      // ─────────────────────────────────────────────────────────────────────────
      list_reminders: {
        description: 'List upcoming reminders (pending and snoozed by default).',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(20).optional().describe('Max reminders to return (default: 5)'),
          includeCompleted: z.boolean().optional().describe('Include completed/dismissed/cancelled reminders'),
        }),
        execute: async (args: { limit?: number; includeCompleted?: boolean }) => {
          const limit = Math.min(args.limit ?? 5, 20);
          const includeCompleted = args.includeCompleted ?? false;

          const reminders = await prisma.reminder.findMany({
            where: {
              userId: input.userId,
              ...(includeCompleted ? {} : { status: { in: ['PENDING', 'SNOOZED'] } }),
            },
            orderBy: { scheduledAt: 'asc' },
            take: limit,
          });

          return {
            count: reminders.length,
            reminders: reminders.map((reminder) => {
              const dueAt = reminder.status === 'SNOOZED' && reminder.snoozedUntil
                ? reminder.snoozedUntil
                : reminder.scheduledAt;
              return {
                id: reminder.id,
                title: reminder.title,
                status: reminder.status,
                scheduledAt: dueAt.toISOString(),
                scheduledAtLocal: formatDateTimeInTimeZone(dueAt, userTimezone),
              };
            }),
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 13: Snooze Reminder
      // ─────────────────────────────────────────────────────────────────────────
      snooze_reminder: {
        description: 'Snooze a reminder until a new time.',
        inputSchema: z.object({
          reminderId: z.string().min(1),
          snoozeUntil: z.string().min(1).max(200).describe('Snooze until (ISO UTC or natural language)'),
        }),
        execute: async (args: { reminderId: string; snoozeUntil: string }) => {
          const now = new Date();
          const parsed = parseReminderTime(args.snoozeUntil, { now, timeZone: userTimezone });
          if (!parsed || Number.isNaN(parsed.date.getTime())) {
            return { success: false, message: 'Could not parse the snooze time. Try a specific time.' };
          }
          if (parsed.date.getTime() <= now.getTime()) {
            return { success: false, message: 'Snooze time must be in the future.' };
          }

          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminderClosedStatuses.has(reminder.status)) {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: 'SNOOZED',
              snoozedUntil: parsed.date,
              snoozeCount: { increment: 1 },
            },
          });

          const snoozedLocal = formatDateTimeInTimeZone(parsed.date, userTimezone);

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_SNOOZED',
              actionSummary: `Reminder snoozed: ${reminder.title}`,
              actionDetails: {
                reminderId: reminder.id,
                snoozedUntil: parsed.date.toISOString(),
                snoozedUntilLocal: snoozedLocal,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            snoozedUntil: parsed.date.toISOString(),
            snoozedUntilLocal: snoozedLocal,
            message: `Snoozed until ${snoozedLocal}.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 14: Dismiss Reminder
      // ─────────────────────────────────────────────────────────────────────────
      dismiss_reminder: {
        description: 'Dismiss a reminder (optionally mark as completed).',
        inputSchema: z.object({
          reminderId: z.string().min(1),
          markCompleted: z.boolean().optional(),
        }),
        execute: async (args: { reminderId: string; markCompleted?: boolean }) => {
          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminder.status === 'CANCELLED' || reminder.status === 'MISSED') {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const markCompleted = args.markCompleted ?? false;
          const status = markCompleted ? 'COMPLETED' : 'DISMISSED';

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status,
              dismissedAt: new Date(),
              snoozedUntil: null,
            },
          });

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_DISMISSED',
              actionSummary: `${markCompleted ? 'Reminder completed' : 'Reminder dismissed'}: ${reminder.title}`,
              actionDetails: {
                reminderId: reminder.id,
                status,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            status: updated.status,
            message: markCompleted ? 'Marked complete.' : 'Dismissed.',
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 15: Cancel Reminder
      // ─────────────────────────────────────────────────────────────────────────
      cancel_reminder: {
        description: 'Cancel a pending reminder the user no longer wants.',
        inputSchema: z.object({
          reminderId: z.string().min(1),
        }),
        execute: async (args: { reminderId: string }) => {
          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminderNonCancelableStatuses.has(reminder.status)) {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: 'CANCELLED',
              dismissedAt: new Date(),
              snoozedUntil: null,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            status: updated.status,
            message: `Cancelled reminder: ${reminder.title}`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 16: Send Email (TERMINAL - Requires Explicit Permission)
      // ─────────────────────────────────────────────────────────────────────────
      send_email: {
        description:
          'Send an email immediately via Gmail. TERMINAL action - ONLY call after user explicitly says "yes", "send it", "go ahead", or similar clear permission. ' +
          'This IMMEDIATELY SENDS the email - it is NOT a draft or preview. The email will be sent from the user\'s Gmail account. ' +
          'Always show the email details to the user first, wait for their explicit "send" approval, then call this tool. ' +
          'After calling this, provide a brief channel-appropriate confirmation message.',
        inputSchema: z.object({
          to: z.string().email().describe('Email recipient (primary)'),
          cc: z.array(z.string().email()).optional().describe('CC recipient(s)'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body'),
          inReplyTo: z.string().optional().describe('RFC 2822 In-Reply-To header for threading'),
          references: z.string().optional().describe('RFC 2822 References header for threading'),
          threadId: z.string().optional().describe('Gmail thread ID to attach email to'),
        }),
        execute: async (args: {
          to: string;
          cc?: string[];
          subject: string;
          body: string;
          inReplyTo?: string;
          references?: string;
          threadId?: string;
        }) => {
          logger.info(`[executiveAgent] send_email: to=${args.to} subject="${truncate(args.subject, 30)}"`);

          try {
            const gmailContext = await createGmailServiceForUser({
              userId: input.userId,
              purpose: `${resolvedChannel}:send-email`,
              requester: 'executiveAgent.send_email',
            });

            if (!gmailContext) {
              return {
                success: false,
                message: 'Gmail credentials not available. Please reconnect your Gmail account.',
              };
            }

            const result = await gmailContext.gmail.sendEmail({
              to: args.to,
              cc: args.cc,
              subject: args.subject,
              body: args.body,
              inReplyTo: args.inReplyTo,
              references: args.references,
              threadId: args.threadId,
            });

            logger.info(`[executiveAgent] Email sent: messageId=${result.id}`);

            return {
              success: true,
              messageId: result.id,
              threadId: result.threadId,
              message: `Email sent successfully to ${args.to}${args.cc && args.cc.length > 0 ? ` (CC: ${args.cc.join(', ')})` : ''}!`,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`[executiveAgent] Failed to send email: ${message}`);
            return {
              success: false,
              message: `Failed to send email: ${message}`,
            };
          }
        },
      },
    };

    if (input.progressContext) {
      tools.send_progress_update = createSendProgressUpdateTool(input.progressContext);
    }

  return tools;
}
