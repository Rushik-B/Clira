import crypto from 'crypto';
import { z } from 'zod';
import { type Prisma, ActionHistoryType, PendingCalendarChangeStatus } from '@prisma/client';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { CalendarService } from '@/lib/services/core/calendarService';
import {
  getCalendarMutationSnapshot,
  type CalendarMutationSnapshotResult,
} from '@/lib/services/core/replyContextTools';
import { runCalendarSearch } from '@/lib/ai/agents/calendarSearchSubagent';
import { runCalendarCreatorAgent, type AvailableCalendar } from '@/lib/ai/agents/calendarCreatorAgent';
import {
  buildCalendarCompletionMessage,
  describeGoogleCalendarEvent,
} from '@/lib/ai/calendar-user-facing';
import { formatDateTimeInTimeZone } from '@/lib/utils/timezone';
import {
  type CalendarMutationTarget,
  buildMutationCandidates,
  createClarifyCalendarPlan,
  isCalendarTargetById,
  isCalendarTargetLookup,
  parsePendingCalendarChangeRecord,
  resolveMutationSearchRange,
} from '@/lib/ai/agents/executiveCalendarMutationHelpers';
import { generateReauthUrl, REQUIRED_SCOPES } from '@/lib/auth/scope-utils';
import {
  type CalendarCreatorPlanDTO,
  type CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import {
  PENDING_CALENDAR_CHANGE_TTL_MS,
  PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS,
} from '../constants';
import {
  type GoogleEventTime,
  isCalendarScopeError,
  applyGoogleReminderLimit,
  normalizeUpdateDraftTimesForPatch,
  runWithSubagentBudget,
  stripUndefined,
  summarizeAttendees,
  truncate,
  validateEventDraftTimes,
} from '../helpers';
import type {
  ExecutiveRuntimeContext,
  PendingCalendarChangeRecord,
} from '../types';

export function buildCalendarMutationTools({
  context,
  nextSubagentCallIndex,
}: {
  context: ExecutiveRuntimeContext;
  nextSubagentCallIndex: () => number;
}): Record<string, unknown> {
  const {
    input,
    channel: resolvedChannel,
    userTimezone,
    currentTimeUtc,
    currentTimeUserTz,
    dayOfWeek,
    toolAbort,
    toolAbortSignal,
  } = context;
  const staleToolResult = () => ({
    ok: false,
    status: 'deferred',
    error: 'superseded_by_newer_message',
    message: 'A newer user message arrived, so this action was deferred.',
  });
  const ensureCurrentRun = async (toolName: string) => {
    if (await context.isRunCurrent()) {
      return null;
    }

    logger.info(`[executiveAgent] ${toolName} deferred due to stale run`);
    return staleToolResult();
  };

  return {
      // Tool 5: Plan Calendar Change
      // ─────────────────────────────────────────────────────────────────────────
      plan_calendar_change: {
        description:
          'Plan a calendar change (create/update/delete) with a confirmation-required preview. ' +
          'Always return a user-facing preview and a pending change for explicit confirmation. ' +
          'Use for calendar mutations only; never execute changes directly. ' +
          'When the plan moves or reschedules specific events: call search_calendar exactly once with one combined query (all event names) and one date range, then pass the returned events as resolvedEvents. Do not call search_calendar multiple times for the same plan. Required for performance. ' +
          'Field semantics matter: summary=title, location=room/link/place, description=notes, start/end=time, attendees=people, reminders=notifications, and calendar choice is the container calendar. Never encode a calendar move as a location or description change. This tool already receives the writable calendar list internally.',
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
          const stale = await ensureCurrentRun('plan_calendar_change');
          if (stale) return stale;

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
            if (existingPending.status === PendingCalendarChangeStatus.IN_PROGRESS) {
              const pendingPayload = parsePendingCalendarChangeRecord(existingPending as PendingCalendarChangeRecord);
              return {
                ok: false,
                message: 'A calendar change is currently being processed. Please wait a moment.',
                pendingChange: {
                  pendingId: existingPending.id,
                  createdAt: formatDateTimeInTimeZone(existingPending.createdAt, userTimezone),
                  expiresAt: formatDateTimeInTimeZone(existingPending.expiresAt, userTimezone),
                  status: existingPending.status,
                  action: pendingPayload?.plan.action,
                },
              };
            }

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
                createdAt: formatDateTimeInTimeZone(existingPending.createdAt, userTimezone),
                expiresAt: formatDateTimeInTimeZone(existingPending.expiresAt, userTimezone),
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

          const toolCallIndex = nextSubagentCallIndex();

          const planResult = await (async () => {
            try {
              return await runWithSubagentBudget({
                toolName: 'plan_calendar_change',
                counts: { total: 0, tool: 0 },
                timeLeftMs: toolAbort.timeLeftMs(),
                abortSignal: toolAbortSignal,
                toolCallIndex,
                minBudgetMs: PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS,
                maxBudgetMs: PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS,
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
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              const isDeadline =
                error instanceof Error &&
                (error.name === 'AbortError' || /deadline exceeded|aborted|abort/i.test(message));
              logger.warn('[executiveAgent] plan_calendar_change failed', {
                message,
                isDeadline,
              });
              return {
                ok: false as const,
                error: isDeadline ? 'deadline_exceeded' : 'calendar_plan_failed',
                message: isDeadline
                  ? 'I ran out of time planning that calendar change. Please try again.'
                  : `I could not plan that calendar change. ${message}`,
              };
            }
          })();

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
          const staleBeforePendingCancel = await ensureCurrentRun('plan_calendar_change');
          if (staleBeforePendingCancel) return staleBeforePendingCancel;

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

          const staleBeforePendingWrite = await ensureCurrentRun('plan_calendar_change');
          if (staleBeforePendingWrite) return staleBeforePendingWrite;

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
                  expiresAt: formatDateTimeInTimeZone(expiresAt, userTimezone),
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
              createdAt: formatDateTimeInTimeZone(pendingRecord.createdAt, userTimezone),
              expiresAt: formatDateTimeInTimeZone(pendingRecord.expiresAt, userTimezone),
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
          const stale = await ensureCurrentRun('commit_calendar_change');
          if (stale) return stale;

          await context.input.runContext?.markRunPhase?.('commit_boundary');

          const staleAfterBoundary = await ensureCurrentRun('commit_calendar_change');
          if (staleAfterBoundary) return staleAfterBoundary;

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

          const hasMeaningfulUpdateDraft = (draft: Record<string, unknown> | undefined) => {
            if (!draft) {
              return false;
            }

            return Object.values(draft).some((value) => value !== undefined);
          };

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
                start: GoogleEventTime | null | undefined;
                end: GoogleEventTime | null | undefined;
              }> = [];
              const failures: Array<{ index: number; summary: string; message: string }> = [];

              for (const [index, draft] of drafts.entries()) {
                const staleInLoop = await ensureCurrentRun('commit_calendar_change');
                if (staleInLoop) {
                  return staleInLoop;
                }

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
                const draftForApi = applyGoogleReminderLimit(draft);
                const { calendarId: _draftCalId, ...draftWithoutCalendarId } = draftForApi as Record<string, unknown>;

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
                    start: event.start as GoogleEventTime | null | undefined,
                    end: event.end as GoogleEventTime | null | undefined,
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
                const message = buildCalendarCompletionMessage({
                  action: 'create',
                  items: createdEvents.map((event) =>
                    describeGoogleCalendarEvent(
                      {
                        summary: event.summary,
                        start: event.start,
                        end: event.end,
                      },
                      userTimezone,
                    ),
                  ),
                  failureCount: failures.length,
                });
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
                  start: GoogleEventTime | null | undefined;
                  end: GoogleEventTime | null | undefined;
                }> = [];
                const failures: Array<{ index: number; summary: string; message: string }> = [];

                for (const [index, target] of pendingPayload.resolvedTargets.entries()) {
                  const staleInLoop = await ensureCurrentRun('commit_calendar_change');
                  if (staleInLoop) {
                    return staleInLoop;
                  }

                  const draft = plan.eventDrafts[index];
                  const requestedDestinationCalendarId = plan.destinationCalendarIds?.[index];
                  const hasDraftChanges = hasMeaningfulUpdateDraft(draft);
                  const shouldMoveCalendars = Boolean(
                    requestedDestinationCalendarId &&
                      requestedDestinationCalendarId !== target.calendarId,
                  );
                  if (!draft) {
                    failures.push({
                      index,
                      summary: `Event ${index + 1}`,
                      message: 'Missing update fields for this target.',
                    });
                    continue;
                  }

                  if (
                    !hasDraftChanges &&
                    !shouldMoveCalendars &&
                    !plan.createMeetLink
                  ) {
                    failures.push({
                      index,
                      summary: draft.summary ?? `Event ${index + 1}`,
                      message: requestedDestinationCalendarId
                        ? 'That event is already on the requested calendar.'
                        : 'No update fields were provided.',
                    });
                    continue;
                  }

                  try {
                    const currentEventResponse = await calendarService.getEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                    });

                    const currentEvent = currentEventResponse.data;
                    let latestEvent = currentEvent;
                    let latestCalendarId = target.calendarId;
                    let latestEventId = currentEvent.id ?? target.eventId;

                    if (hasDraftChanges || plan.createMeetLink) {
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

                      const patchForApi = applyGoogleReminderLimit(normalizedDraft.patch);
                      const requestBody = stripUndefined({
                        ...patchForApi,
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

                      latestEvent = response.data;
                      latestEventId = response.data.id ?? latestEventId;
                    }

                    if (shouldMoveCalendars && requestedDestinationCalendarId) {
                      const response = await calendarService.moveEvent({
                        calendarId: latestCalendarId,
                        eventId: latestEventId,
                        destinationCalendarId: requestedDestinationCalendarId,
                        sendUpdates: plan.sendUpdates,
                      });
                      latestEvent = response.data;
                      latestCalendarId = requestedDestinationCalendarId;
                      latestEventId = response.data.id ?? latestEventId;
                    }

                    const summary = latestEvent.summary ?? currentEvent.summary ?? draft.summary ?? '(No title)';

                    updatedEvents.push({
                      eventId: latestEvent.id,
                      htmlLink: latestEvent.htmlLink,
                      summary,
                      start: (latestEvent.start ?? currentEvent.start) as GoogleEventTime | null | undefined,
                      end: (latestEvent.end ?? currentEvent.end) as GoogleEventTime | null | undefined,
                    });

                    await prisma.actionHistory.create({
                      data: {
                        userId: input.userId,
                        actionType: ActionHistoryType.CALENDAR_EVENT_UPDATED,
                        actionSummary: `Updated calendar event: ${summary}`,
                        actionDetails: {
                          calendarId: latestCalendarId,
                          sourceCalendarId: target.calendarId,
                          destinationCalendarId: shouldMoveCalendars
                            ? requestedDestinationCalendarId
                            : undefined,
                          eventId: latestEventId,
                          htmlLink: latestEvent.htmlLink,
                          sendUpdates: plan.sendUpdates,
                          createMeetLink: plan.createMeetLink,
                          start: (latestEvent.start ?? currentEvent.start) as Prisma.InputJsonValue,
                          end: (latestEvent.end ?? currentEvent.end) as Prisma.InputJsonValue,
                          attendees: summarizeAttendees(latestEvent.attendees ?? currentEvent.attendees),
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
                  const message = buildCalendarCompletionMessage({
                    action: 'update',
                    items: updatedEvents.map((event) =>
                      describeGoogleCalendarEvent(
                        {
                          summary: event.summary,
                          start: event.start,
                          end: event.end,
                        },
                        userTimezone,
                      ),
                    ),
                    failureCount: failures.length,
                  });
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

              const hasDraftChanges = hasMeaningfulUpdateDraft(plan.eventDraft);
              const shouldMoveCalendars = Boolean(
                plan.destinationCalendarId &&
                  plan.destinationCalendarId !== pendingPayload.resolvedTarget.calendarId,
              );

              if (
                !hasDraftChanges &&
                !shouldMoveCalendars &&
                !plan.createMeetLink
              ) {
                await cancelPending();
                return {
                  ok: false,
                  error: 'invalid_plan',
                  message: plan.destinationCalendarId
                    ? 'That event is already on the requested calendar.'
                    : 'No update fields were provided.',
                };
              }

              const staleSingleUpdate = await ensureCurrentRun('commit_calendar_change');
              if (staleSingleUpdate) {
                await releasePending();
                return staleSingleUpdate;
              }

              const currentEventResponse = await calendarService.getEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
              });

              const currentEvent = currentEventResponse.data;
              let latestEvent = currentEvent;
              let latestCalendarId = pendingPayload.resolvedTarget.calendarId;
              let latestEventId = currentEvent.id ?? pendingPayload.resolvedTarget.eventId;

              if (hasDraftChanges || plan.createMeetLink) {
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

                const patchForApi = applyGoogleReminderLimit(normalizedDraft.patch);
                const requestBody = stripUndefined({
                  ...patchForApi,
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

                latestEvent = response.data;
                latestEventId = response.data.id ?? latestEventId;
              }

              if (shouldMoveCalendars && plan.destinationCalendarId) {
                const response = await calendarService.moveEvent({
                  calendarId: latestCalendarId,
                  eventId: latestEventId,
                  destinationCalendarId: plan.destinationCalendarId,
                  sendUpdates: plan.sendUpdates,
                });
                latestEvent = response.data;
                latestCalendarId = plan.destinationCalendarId;
                latestEventId = response.data.id ?? latestEventId;
              }

              await markPendingConsumed();

              await prisma.actionHistory.create({
                data: {
                  userId: input.userId,
                  actionType: ActionHistoryType.CALENDAR_EVENT_UPDATED,
                  actionSummary: `Updated calendar event: ${latestEvent.summary ?? currentEvent.summary ?? '(No title)'}`,
                  actionDetails: {
                    calendarId: latestCalendarId,
                    sourceCalendarId: pendingPayload.resolvedTarget.calendarId,
                    destinationCalendarId: shouldMoveCalendars
                      ? plan.destinationCalendarId
                      : undefined,
                    eventId: latestEventId,
                    htmlLink: latestEvent.htmlLink,
                    sendUpdates: plan.sendUpdates,
                    createMeetLink: plan.createMeetLink,
                    start: (latestEvent.start ?? currentEvent.start) as Prisma.InputJsonValue,
                    end: (latestEvent.end ?? currentEvent.end) as Prisma.InputJsonValue,
                    attendees: summarizeAttendees(latestEvent.attendees ?? currentEvent.attendees),
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
                message: buildCalendarCompletionMessage({
                  action: 'update',
                  items: [
                    describeGoogleCalendarEvent(
                      {
                        summary: latestEvent.summary ?? currentEvent.summary ?? '(No title)',
                        start: (latestEvent.start ?? currentEvent.start) as GoogleEventTime | null | undefined,
                        end: (latestEvent.end ?? currentEvent.end) as GoogleEventTime | null | undefined,
                      },
                      userTimezone,
                    ),
                  ],
                }),
                eventId: latestEvent.id,
                htmlLink: latestEvent.htmlLink,
                summary: latestEvent.summary ?? currentEvent.summary ?? '(No title)',
              };
            }

            if (plan.action === 'delete') {
              if (pendingPayload.resolvedTargets?.length) {
                const deletedEvents: Array<{
                  eventId: string;
                  summary: string;
                  start: GoogleEventTime | null | undefined;
                  end: GoogleEventTime | null | undefined;
                }> = [];
                const failures: Array<{ index: number; summary: string; message: string }> = [];

                for (const [index, target] of pendingPayload.resolvedTargets.entries()) {
                  const staleInLoop = await ensureCurrentRun('commit_calendar_change');
                  if (staleInLoop) {
                    return staleInLoop;
                  }

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
                      start: currentEvent.start as GoogleEventTime | null | undefined,
                      end: currentEvent.end as GoogleEventTime | null | undefined,
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
                  const message = buildCalendarCompletionMessage({
                    action: 'delete',
                    items: deletedEvents.map((event) =>
                      describeGoogleCalendarEvent(
                        {
                          summary: event.summary,
                          start: event.start,
                          end: event.end,
                        },
                        userTimezone,
                      ),
                    ),
                    failureCount: failures.length,
                  });
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

              const staleSingleDelete = await ensureCurrentRun('commit_calendar_change');
              if (staleSingleDelete) {
                await releasePending();
                return staleSingleDelete;
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
                message: buildCalendarCompletionMessage({
                  action: 'delete',
                  items: [
                    describeGoogleCalendarEvent(
                      {
                        summary: currentEvent.summary ?? '(No title)',
                        start: currentEvent.start as GoogleEventTime | null | undefined,
                        end: currentEvent.end as GoogleEventTime | null | undefined,
                      },
                      userTimezone,
                    ),
                  ],
                }),
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

  };
}
