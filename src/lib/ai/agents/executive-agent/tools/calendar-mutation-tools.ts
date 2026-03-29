import crypto from 'crypto';
import { z } from 'zod';
import { Prisma, ActionHistoryType, PendingCalendarChangeStatus } from '@prisma/client';
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
  buildCalendarBundleCompletionMessage,
  describeGoogleCalendarEvent,
} from '@/lib/ai/calendar-user-facing';
import { formatDateTimeInTimeZone } from '@/lib/utils/timezone';
import {
  type CalendarMutationTarget,
  buildMutationCandidates,
  coercePlanToBundle,
  createClarifyCalendarPlan,
  isCalendarTargetById,
  isCalendarTargetLookup,
  parsePendingCalendarChangeRecord,
  resolveMutationSearchRange,
  type PendingCalendarFailure,
} from '@/lib/ai/agents/executiveCalendarMutationHelpers';
import { generateReauthUrl, REQUIRED_SCOPES } from '@/lib/auth/scope-utils';
import {
  type CalendarCreatorPlanDTO,
  type CalendarMutationBundlePlanDTO,
  type CalendarMutationOperationDTO,
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

  const buildUserSafeCalendarFailureMessage = (error: unknown) => {
    const rawMessage = error instanceof Error ? error.message : 'Unknown error';
    if (/bad request/i.test(rawMessage)) {
      return {
        rawMessage,
        userMessage: 'Google Calendar rejected one of those changes. I kept the staged bundle closed so we can re-plan it cleanly.',
      };
    }

    if (/not found/i.test(rawMessage)) {
      return {
        rawMessage,
        userMessage: 'One of those calendar events no longer exists. I did not reopen the staged bundle.',
      };
    }

    return {
      rawMessage,
      userMessage: `I couldn't apply those calendar changes cleanly. ${rawMessage}`,
    };
  };

  const describeBundleSuccess = (
    op: CalendarMutationOperationDTO,
    event: {
      summary: string;
      start: GoogleEventTime | null | undefined;
      end: GoogleEventTime | null | undefined;
    },
  ) => {
    const eventText = describeGoogleCalendarEvent(event, userTimezone);
    if (op.kind === 'create') {
      return `Added ${eventText}`;
    }
    if (op.kind === 'update') {
      return `Updated ${eventText}`;
    }
    return `Deleted ${eventText}`;
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
              failure: true,
              userTimezone: true,
              userRequest: true,
              expiresAt: true,
              status: true,
              createdAt: true,
            },
          });

          if (existingPending?.status === PendingCalendarChangeStatus.IN_PROGRESS) {
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

          const bundlePlan = coercePlanToBundle(plan);
          if (!bundlePlan) {
            return {
              ok: false,
              error: 'invalid_plan',
              message: 'Calendar change is not ready to stage.',
            };
          }

          let resolvedPlan: CalendarMutationBundlePlanDTO = bundlePlan;

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
            opKind: 'update' | 'delete',
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
                  bundlePlan,
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
                const question = `Which event should I ${opKind}${itemSuffix}? Reply with the number.`;
                const previewText = `I found multiple matches. ${question}\n${lines.join('\n')}`;

                const clarifyPlan = createClarifyCalendarPlan(bundlePlan, [question], previewText);

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
          const resolvedOps: CalendarMutationOperationDTO[] = [...bundlePlan.ops];
          const lookupTargets: LookupTargetResolution[] = [];
          const lookupOpsByIndex = new Map<number, Extract<CalendarMutationOperationDTO, { kind: 'update' | 'delete' }>>();

          for (const [index, op] of bundlePlan.ops.entries()) {
            if (op.kind === 'create') {
              continue;
            }

            if (isCalendarTargetById(op.target)) {
              resolvedOps[index] = {
                ...op,
                target: {
                  calendarId: op.target.calendarId ?? bundlePlan.calendarId ?? 'primary',
                  eventId: op.target.eventId,
                },
              };
              continue;
            }

            const rangeResult = resolveMutationSearchRange({
              startDate: op.target.lookupRange?.startDate ?? args.startDate,
              endDate: op.target.lookupRange?.endDate ?? args.endDate,
              userTimezone,
            });

            if ('error' in rangeResult) {
              const itemSuffix = ` for item ${index + 1}`;
              const clarifyPlan = createClarifyCalendarPlan(
                bundlePlan,
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
              target: op.target,
              range: rangeResult,
            });
            lookupOpsByIndex.set(index, op);
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

          const lookupResolutionByIndex = new Map<
            number,
            Awaited<ReturnType<typeof resolveLookupTarget>>
          >();
          for (const item of lookupTargets) {
            const op = lookupOpsByIndex.get(item.index);
            if (!op) continue;
            if (!isCalendarTargetLookup(op.target)) {
              continue;
            }
            const lookupResolution = await resolveLookupTarget(op.target, op.kind, item.index, {
              resolvedRange: item.range,
              mutationSnapshot: lookupSnapshotsByIndex.get(item.index),
            });
            lookupResolutionByIndex.set(item.index, lookupResolution);
          }

          for (const [index, op] of bundlePlan.ops.entries()) {
            if (op.kind === 'create') {
              continue;
            }

            if (isCalendarTargetById(op.target)) {
              continue;
            }

            const lookupResolution = lookupResolutionByIndex.get(index);
            if (!lookupResolution) {
              return {
                ok: false,
                error: 'lookup_resolution_failed',
                message: 'I could not resolve one of the target events. Please try again.',
              };
            }

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

            resolvedOps[index] = {
              ...op,
              target: lookupResolution.planTarget,
            };
          }

          resolvedPlan = {
            ...bundlePlan,
            ops: resolvedOps,
          };

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
              status: PendingCalendarChangeStatus.SUPERSEDED,
              supersededAt: now,
            },
          });

          const staleBeforePendingWrite = await ensureCurrentRun('plan_calendar_change');
          if (staleBeforePendingWrite) return staleBeforePendingWrite;

          const pendingRecord = await prisma.pendingCalendarChange.create({
            data: {
              userId: input.userId,
              conversationId: input.conversationId,
              plan: resolvedPlan as Prisma.InputJsonValue,
              resolvedTarget: Prisma.JsonNull,
              failure: Prisma.JsonNull,
              userTimezone,
              userRequest: request,
              expiresAt,
              status: PendingCalendarChangeStatus.PENDING,
            },
          });

          try {
            await prisma.actionHistory.create({
              data: {
                userId: input.userId,
                actionType: ActionHistoryType.CALENDAR_CHANGE_PROPOSED,
                actionSummary: 'Proposed calendar mutation bundle',
                actionDetails: {
                  pendingId: pendingRecord.id,
                  action: resolvedPlan.action,
                  calendarId: resolvedPlan.calendarId ?? 'primary',
                  sendUpdates: resolvedPlan.sendUpdates,
                  createMeetLink: resolvedPlan.createMeetLink,
                  opCount: resolvedPlan.ops.length,
                  opKinds: resolvedPlan.ops.map((op) => op.kind),
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
                failure: Prisma.JsonNull,
              },
            });
          };

          const markPendingFailed = async (failure: PendingCalendarFailure) => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.FAILED,
                failedAt: new Date(),
                failure: failure as Prisma.InputJsonValue,
              },
            });
          };

          const cancelPending = async () => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.CANCELLED,
                cancelledAt: new Date(),
                failure: Prisma.JsonNull,
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
          const calendarId = plan.calendarId ?? 'primary';

          const calendarService = await CalendarService.create({
            userId: input.userId,
            purpose: `${resolvedChannel}:calendar-mutation`,
            requester: 'executiveAgent.commit_calendar_change',
          });

          if (!calendarService) {
            await markPendingFailed({
              code: 'calendar_unavailable',
              message: 'No calendar access available. Please reconnect your calendar.',
              retryable: true,
            });
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
            const bundlePlan = coercePlanToBundle(pendingPayload.plan);
            if (!bundlePlan) {
              await cancelPending();
              return {
                ok: false,
                error: 'invalid_plan',
                message: 'Calendar change is not ready to commit.',
              };
            }

            const appliedItems: string[] = [];
            const failures: Array<{
              index: number;
              kind: CalendarMutationOperationDTO['kind'];
              summary: string;
              message: string;
              rawMessage: string;
            }> = [];

            for (const [index, op] of bundlePlan.ops.entries()) {
              const staleInLoop = await ensureCurrentRun('commit_calendar_change');
              if (staleInLoop) {
                return staleInLoop;
              }

              if (op.kind === 'create') {
                const draft = op.eventDraft;
                const timeValidation = validateEventDraftTimes(draft, 'create');
                if (!timeValidation.ok) {
                  failures.push({
                    index,
                    kind: op.kind,
                    summary: draft.summary ?? `Event ${index + 1}`,
                    message: timeValidation.message,
                    rawMessage: timeValidation.message,
                  });
                  continue;
                }

                const draftCalendarId = (draft as { calendarId?: string }).calendarId ?? calendarId;
                const conferenceData = (op.createMeetLink ?? bundlePlan.createMeetLink)
                  ? {
                      createRequest: {
                        requestId: crypto.randomUUID(),
                        conferenceSolutionKey: { type: 'hangoutsMeet' },
                      },
                    }
                  : undefined;

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
                    sendUpdates: bundlePlan.sendUpdates,
                  });
                  const event = response.data;
                  const summary = event.summary ?? draft.summary ?? '(No title)';
                  appliedItems.push(
                    describeBundleSuccess(op, {
                      summary,
                      start: event.start as GoogleEventTime | null | undefined,
                      end: event.end as GoogleEventTime | null | undefined,
                    }),
                  );

                  await prisma.actionHistory.create({
                    data: {
                      userId: input.userId,
                      actionType: ActionHistoryType.CALENDAR_EVENT_CREATED,
                      actionSummary: `Created calendar event: ${summary}`,
                      actionDetails: {
                        calendarId: draftCalendarId,
                        eventId: event.id,
                        htmlLink: event.htmlLink,
                        sendUpdates: bundlePlan.sendUpdates,
                        createMeetLink: op.createMeetLink ?? bundlePlan.createMeetLink,
                        start: event.start as Prisma.InputJsonValue,
                        end: event.end as Prisma.InputJsonValue,
                        attendees: summarizeAttendees(event.attendees),
                      },
                      undoable: false,
                      metadata: {
                        source: 'executive-agent',
                        pendingId: latestPending.id,
                        opIndex: index,
                      },
                    },
                  });
                } catch (error) {
                  const { rawMessage, userMessage } = buildUserSafeCalendarFailureMessage(error);
                  failures.push({
                    index,
                    kind: op.kind,
                    summary: draft.summary ?? `Event ${index + 1}`,
                    message: userMessage,
                    rawMessage,
                  });
                }

                continue;
              }

              if (!isCalendarTargetById(op.target)) {
                failures.push({
                  index,
                  kind: op.kind,
                  summary: `Event ${index + 1}`,
                  message: 'That staged bundle is missing a concrete event target. Please re-plan it.',
                  rawMessage: 'missing_concrete_target',
                });
                continue;
              }

              const target = {
                calendarId: op.target.calendarId ?? bundlePlan.calendarId ?? 'primary',
                eventId: op.target.eventId,
              };

              if (op.kind === 'update') {
                const hasDraftChanges = hasMeaningfulUpdateDraft(op.eventDraft);
                const shouldMoveCalendars = Boolean(
                  op.destinationCalendarId && op.destinationCalendarId !== target.calendarId,
                );

                if (!hasDraftChanges && !shouldMoveCalendars && !op.createMeetLink) {
                  failures.push({
                    index,
                    kind: op.kind,
                    summary: op.eventDraft.summary ?? `Event ${index + 1}`,
                    message: op.destinationCalendarId
                      ? 'That event is already on the requested calendar.'
                      : 'No update fields were provided.',
                    rawMessage: 'no_update_fields',
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

                  if (hasDraftChanges || op.createMeetLink) {
                    const normalizedDraft = normalizeUpdateDraftTimesForPatch({
                      draft: op.eventDraft,
                      currentEvent: {
                        start: currentEvent.start as GoogleEventTime | null | undefined,
                        end: currentEvent.end as GoogleEventTime | null | undefined,
                      },
                    });

                    if (!normalizedDraft.ok) {
                      failures.push({
                        index,
                        kind: op.kind,
                        summary: op.eventDraft.summary ?? `Event ${index + 1}`,
                        message: normalizedDraft.message,
                        rawMessage: normalizedDraft.message,
                      });
                      continue;
                    }

                    const timeValidation = validateEventDraftTimes(normalizedDraft.patch, 'update');
                    if (!timeValidation.ok) {
                      failures.push({
                        index,
                        kind: op.kind,
                        summary: op.eventDraft.summary ?? `Event ${index + 1}`,
                        message: timeValidation.message,
                        rawMessage: timeValidation.message,
                      });
                      continue;
                    }

                    const conferenceData = op.createMeetLink
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
                      sendUpdates: bundlePlan.sendUpdates,
                      ifMatchEtag: currentEvent.etag ?? undefined,
                    });

                    latestEvent = response.data;
                    latestEventId = response.data.id ?? latestEventId;
                  }

                  if (shouldMoveCalendars && op.destinationCalendarId) {
                    const response = await calendarService.moveEvent({
                      calendarId: latestCalendarId,
                      eventId: latestEventId,
                      destinationCalendarId: op.destinationCalendarId,
                      sendUpdates: bundlePlan.sendUpdates,
                    });
                    latestEvent = response.data;
                    latestCalendarId = op.destinationCalendarId;
                    latestEventId = response.data.id ?? latestEventId;
                  }

                  const summary = latestEvent.summary ?? currentEvent.summary ?? op.eventDraft.summary ?? '(No title)';
                  appliedItems.push(
                    describeBundleSuccess(op, {
                      summary,
                      start: (latestEvent.start ?? currentEvent.start) as GoogleEventTime | null | undefined,
                      end: (latestEvent.end ?? currentEvent.end) as GoogleEventTime | null | undefined,
                    }),
                  );

                  await prisma.actionHistory.create({
                    data: {
                      userId: input.userId,
                      actionType: ActionHistoryType.CALENDAR_EVENT_UPDATED,
                      actionSummary: `Updated calendar event: ${summary}`,
                      actionDetails: {
                        calendarId: latestCalendarId,
                        sourceCalendarId: target.calendarId,
                        destinationCalendarId: shouldMoveCalendars ? op.destinationCalendarId : undefined,
                        eventId: latestEventId,
                        htmlLink: latestEvent.htmlLink,
                        sendUpdates: bundlePlan.sendUpdates,
                        createMeetLink: op.createMeetLink ?? false,
                        start: (latestEvent.start ?? currentEvent.start) as Prisma.InputJsonValue,
                        end: (latestEvent.end ?? currentEvent.end) as Prisma.InputJsonValue,
                        attendees: summarizeAttendees(latestEvent.attendees ?? currentEvent.attendees),
                      },
                      undoable: false,
                      metadata: {
                        source: 'executive-agent',
                        pendingId: latestPending.id,
                        opIndex: index,
                      },
                    },
                  });
                } catch (error) {
                  const { rawMessage, userMessage } = buildUserSafeCalendarFailureMessage(error);
                  failures.push({
                    index,
                    kind: op.kind,
                    summary: op.eventDraft.summary ?? `Event ${index + 1}`,
                    message: userMessage,
                    rawMessage,
                  });
                }

                continue;
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
                  sendUpdates: bundlePlan.sendUpdates,
                  ifMatchEtag: currentEvent.etag ?? undefined,
                });

                const summary = currentEvent.summary ?? '(No title)';
                appliedItems.push(
                  describeBundleSuccess(op, {
                    summary,
                    start: currentEvent.start as GoogleEventTime | null | undefined,
                    end: currentEvent.end as GoogleEventTime | null | undefined,
                  }),
                );

                await prisma.actionHistory.create({
                  data: {
                    userId: input.userId,
                    actionType: ActionHistoryType.CALENDAR_EVENT_DELETED,
                    actionSummary: `Deleted calendar event: ${summary}`,
                    actionDetails: {
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                      sendUpdates: bundlePlan.sendUpdates,
                      createMeetLink: false,
                      start: currentEvent.start as Prisma.InputJsonValue,
                      end: currentEvent.end as Prisma.InputJsonValue,
                      attendees: summarizeAttendees(currentEvent.attendees),
                    } as Prisma.InputJsonObject,
                    undoable: false,
                    metadata: {
                      source: 'executive-agent',
                      pendingId: latestPending.id,
                      opIndex: index,
                    },
                  },
                });
              } catch (error) {
                const { rawMessage, userMessage } = buildUserSafeCalendarFailureMessage(error);
                failures.push({
                  index,
                  kind: op.kind,
                  summary: `Event ${index + 1}`,
                  message: userMessage,
                  rawMessage,
                });
              }
            }

            if (failures.length === 0) {
              await markPendingConsumed();
              return {
                ok: true,
                status: 'completed',
                message: buildCalendarBundleCompletionMessage({
                  items: appliedItems,
                }),
                appliedCount: appliedItems.length,
                appliedItems,
              };
            }

            const firstFailure = failures[0];
            await markPendingFailed({
              code: 'calendar_commit_failed',
              message: firstFailure?.rawMessage ?? 'Calendar mutation failed.',
              retryable: false,
              failedOpIndex: firstFailure?.index,
              partialSuccessCount: appliedItems.length,
            });

            return {
              ok: false,
              error: 'calendar_commit_failed',
              status: appliedItems.length > 0 ? 'partial' : 'failed',
              message:
                appliedItems.length > 0
                  ? buildCalendarBundleCompletionMessage({
                      items: appliedItems,
                      failureCount: failures.length,
                    })
                  : firstFailure?.message ?? 'I could not apply those calendar changes.',
              appliedCount: appliedItems.length,
              failedCount: failures.length,
              appliedItems,
              failures,
            };
          } catch (error) {
            if (isCalendarScopeError(error)) {
              await markPendingFailed({
                code: 'calendar_scope_missing',
                message: error instanceof Error ? error.message : 'Calendar write access missing.',
                retryable: true,
              });
              return {
                ok: false,
                error: 'calendar_scope_missing',
                message: 'Calendar write access is required. Please reconnect Google Calendar.',
                reauthUrl: generateReauthUrl([REQUIRED_SCOPES.CALENDAR_EVENTS]),
              };
            }

            const failure = buildUserSafeCalendarFailureMessage(error);
            await markPendingFailed({
              code: 'calendar_commit_failed',
              message: failure.rawMessage,
              retryable: false,
            });
            return {
              ok: false,
              error: 'calendar_commit_failed',
              message: failure.userMessage,
            };
          }
        },
      },

  };
}
