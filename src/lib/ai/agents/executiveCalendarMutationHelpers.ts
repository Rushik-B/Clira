import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  addDaysToDateOnly,
  endOfDayInTimezone,
  getDateOnlyInTimezone,
  normalizeIsoDateInputToUtc,
  startOfDayInTimezone,
} from '@/lib/utils/timezone';
import {
  CalendarCreatorPlanSchema,
  type CalendarCreatorPlanDTO,
  type CalendarMutationBundlePlanDTO,
  type CalendarMutationOperationDTO,
  type CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';

export type CalendarMutationTarget = {
  calendarId: string;
  eventId: string;
  etag?: string;
};

const PendingCalendarChangeTargetSchema = z
  .object({
    calendarId: z.string(),
    eventId: z.string(),
    etag: z.string().optional(),
  })
  .strict();

const PendingCalendarFailureSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    failedOpIndex: z.number().int().min(0).optional(),
    partialSuccessCount: z.number().int().min(0).optional(),
  })
  .strict();

const PendingCalendarChangePayloadSchema = z
  .object({
    plan: CalendarCreatorPlanSchema,
    failure: PendingCalendarFailureSchema.optional(),
    userTimezone: z.string(),
    userRequest: z.string(),
  })
  .strict();

export type PendingCalendarFailure = z.infer<typeof PendingCalendarFailureSchema>;
export type PendingCalendarChangePayload = z.infer<typeof PendingCalendarChangePayloadSchema>;

export type PendingCalendarChangeRecordLike = {
  plan: Prisma.JsonValue;
  resolvedTarget: Prisma.JsonValue | null;
  failure?: Prisma.JsonValue | null;
  userTimezone: string;
  userRequest: string;
};

function coerceResolvedTargets(record: PendingCalendarChangeRecordLike): CalendarMutationTarget[] {
  const rawResolvedTarget = record.resolvedTarget ?? undefined;
  if (!rawResolvedTarget) {
    return [];
  }

  if (Array.isArray(rawResolvedTarget)) {
    const parsed = z.array(PendingCalendarChangeTargetSchema).safeParse(rawResolvedTarget);
    return parsed.success ? parsed.data : [];
  }

  const parsed = PendingCalendarChangeTargetSchema.safeParse(rawResolvedTarget);
  return parsed.success ? [parsed.data] : [];
}

function coerceLegacyPlanToBundle(
  plan: Exclude<CalendarCreatorPlanDTO, { action: 'bundle' | 'clarify' }>,
  resolvedTargets: CalendarMutationTarget[],
): CalendarMutationBundlePlanDTO {
  if (plan.action === 'create') {
    const drafts = plan.eventDrafts?.length ? plan.eventDrafts : plan.eventDraft ? [plan.eventDraft] : [];
    return {
      action: 'bundle',
      confidence: plan.confidence,
      requiresConfirmation: plan.requiresConfirmation,
      sendUpdates: plan.sendUpdates,
      createMeetLink: plan.createMeetLink,
      calendarId: plan.calendarId,
      userPreviewText: plan.userPreviewText,
      ops: drafts.map((draft) => ({
        kind: 'create',
        eventDraft: draft,
        createMeetLink: plan.createMeetLink,
      })),
    };
  }

  if (plan.action === 'update') {
    const targets = plan.targets?.length ? plan.targets : plan.target ? [plan.target] : [];
    const drafts = plan.eventDrafts?.length ? plan.eventDrafts : plan.eventDraft ? [plan.eventDraft] : [];
    const destinationCalendarIds = plan.destinationCalendarIds?.length
      ? plan.destinationCalendarIds
      : plan.destinationCalendarId
        ? [plan.destinationCalendarId]
        : [];

    const ops: CalendarMutationOperationDTO[] = targets.map((target, index) => {
      const resolvedTarget = resolvedTargets[index];
      const normalizedTarget =
        resolvedTarget ??
        ('eventId' in target
          ? {
              calendarId: target.calendarId ?? plan.calendarId ?? 'primary',
              eventId: target.eventId,
            }
          : target);
      return {
        kind: 'update',
        target: normalizedTarget,
        eventDraft: drafts[index] ?? plan.eventDraft ?? {},
        destinationCalendarId: destinationCalendarIds[index] ?? undefined,
        createMeetLink: plan.createMeetLink,
      };
    });

    return {
      action: 'bundle',
      confidence: plan.confidence,
      requiresConfirmation: plan.requiresConfirmation,
      sendUpdates: plan.sendUpdates,
      createMeetLink: plan.createMeetLink,
      calendarId: plan.calendarId,
      userPreviewText: plan.userPreviewText,
      ops,
    };
  }

  const targets = plan.targets?.length ? plan.targets : plan.target ? [plan.target] : [];
  const ops: CalendarMutationOperationDTO[] = targets.map((target, index) => {
    const resolvedTarget = resolvedTargets[index];
    const normalizedTarget =
      resolvedTarget ??
      ('eventId' in target
        ? {
            calendarId: target.calendarId ?? plan.calendarId ?? 'primary',
            eventId: target.eventId,
          }
        : target);
    return {
      kind: 'delete',
      target: normalizedTarget,
    };
  });

  return {
    action: 'bundle',
    confidence: plan.confidence,
    requiresConfirmation: plan.requiresConfirmation,
    sendUpdates: plan.sendUpdates,
    createMeetLink: plan.createMeetLink,
    calendarId: plan.calendarId,
    userPreviewText: plan.userPreviewText,
    ops,
  };
}

export function parsePendingCalendarChangeRecord(
  record: PendingCalendarChangeRecordLike,
): PendingCalendarChangePayload | null {
  const parsedPlan = CalendarCreatorPlanSchema.safeParse(record.plan);
  if (!parsedPlan.success) {
    return null;
  }

  const resolvedTargets = coerceResolvedTargets(record);
  const normalizedPlan =
    parsedPlan.data.action === 'bundle' || parsedPlan.data.action === 'clarify'
      ? parsedPlan.data
      : coerceLegacyPlanToBundle(parsedPlan.data, resolvedTargets);

  const failureParsed = record.failure
    ? PendingCalendarFailureSchema.safeParse(record.failure)
    : null;

  const payloadInput = {
    plan: normalizedPlan,
    failure: failureParsed?.success ? failureParsed.data : undefined,
    userTimezone: record.userTimezone,
    userRequest: record.userRequest,
  };

  const parsed = PendingCalendarChangePayloadSchema.safeParse(payloadInput);
  return parsed.success ? parsed.data : null;
}

export function isCalendarTargetById(
  target: CalendarTargetDTO,
): target is Extract<CalendarTargetDTO, { eventId: string }> {
  return 'eventId' in target;
}

export function isCalendarTargetLookup(
  target: CalendarTargetDTO,
): target is Extract<CalendarTargetDTO, { lookupQuery: string }> {
  return 'lookupQuery' in target;
}

export function createClarifyCalendarPlan(
  basePlan: CalendarCreatorPlanDTO,
  clarifyingQuestions: string[],
  userPreviewText: string,
): CalendarCreatorPlanDTO {
  return {
    action: 'clarify',
    confidence: basePlan.confidence,
    requiresConfirmation: false,
    sendUpdates: basePlan.sendUpdates,
    createMeetLink: basePlan.createMeetLink,
    calendarId: basePlan.calendarId,
    clarifyingQuestions,
    userPreviewText,
  };
}

export function coercePlanToBundle(
  plan: CalendarCreatorPlanDTO,
): CalendarMutationBundlePlanDTO | null {
  if (plan.action === 'bundle') {
    return plan;
  }

  if (plan.action === 'clarify') {
    return null;
  }

  return coerceLegacyPlanToBundle(plan, []);
}

function buildMutationMatchKey(name: string, start: string, end: string): string {
  return `${name.toLowerCase().trim()}|${start.toLowerCase().trim()}|${end.toLowerCase().trim()}`;
}

export type CalendarMutationCandidate = {
  calendarId: string;
  eventId: string;
  etag?: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  relevanceScore: number;
  matchReason: string;
};

export function buildMutationCandidates(
  matches: Array<{
    name: string;
    start: string;
    end: string;
    isAllDay: boolean;
    relevanceScore: number;
    matchReason: string;
  }>,
  snapshotEvents: Array<{
    calendarId: string;
    eventId: string;
    etag?: string;
    name: string;
    start: string;
    end: string;
    isAllDay: boolean;
  }>,
): CalendarMutationCandidate[] {
  const eventMap = new Map<string, Array<(typeof snapshotEvents)[number]>>();

  for (const event of snapshotEvents) {
    const key = buildMutationMatchKey(event.name, event.start, event.end);
    const list = eventMap.get(key) ?? [];
    list.push(event);
    eventMap.set(key, list);
  }

  const candidates: CalendarMutationCandidate[] = [];

  for (const match of matches) {
    const key = buildMutationMatchKey(match.name, match.start, match.end);
    const eventsForKey = eventMap.get(key) ?? [];
    for (const event of eventsForKey) {
      candidates.push({
        calendarId: event.calendarId,
        eventId: event.eventId,
        etag: event.etag,
        summary: event.name,
        start: event.start,
        end: event.end,
        isAllDay: event.isAllDay,
        relevanceScore: match.relevanceScore,
        matchReason: match.matchReason,
      });
    }
  }

  return candidates;
}

export function resolveMutationSearchRange({
  startDate,
  endDate,
  userTimezone,
}: {
  startDate?: string;
  endDate?: string;
  userTimezone: string;
}): { startDate: Date; endDate: Date } | { error: string } {
  const now = new Date();
  const userToday = getDateOnlyInTimezone(now, userTimezone);
  const defaultStart = startOfDayInTimezone(addDaysToDateOnly(userToday, -30), userTimezone);
  const defaultEnd = endOfDayInTimezone(addDaysToDateOnly(userToday, 90), userTimezone);

  if (!startDate && !endDate) {
    return { startDate: defaultStart, endDate: defaultEnd };
  }

  try {
    const normalizedStart = startDate
      ? normalizeIsoDateInputToUtc(startDate, userTimezone, 'start')
      : startOfDayInTimezone(getDateOnlyInTimezone(defaultStart, userTimezone), userTimezone);
    const normalizedEnd = endDate
      ? normalizeIsoDateInputToUtc(endDate, userTimezone, 'end')
      : endOfDayInTimezone(getDateOnlyInTimezone(normalizedStart, userTimezone), userTimezone);

    if (normalizedStart > normalizedEnd) {
      return { error: 'End date must be on or after the start date.' };
    }

    return { startDate: normalizedStart, endDate: normalizedEnd };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid date range.',
    };
  }
}
