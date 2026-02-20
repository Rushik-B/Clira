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

const PendingCalendarChangePayloadSchema = z
  .object({
    plan: CalendarCreatorPlanSchema,
    resolvedTarget: PendingCalendarChangeTargetSchema.optional(),
    resolvedTargets: z.array(PendingCalendarChangeTargetSchema).min(1).optional(),
    userTimezone: z.string(),
    userRequest: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.resolvedTarget && value.resolvedTargets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide only one of resolvedTarget or resolvedTargets.',
        path: ['resolvedTargets'],
      });
    }
  });

export type PendingCalendarChangePayload = z.infer<typeof PendingCalendarChangePayloadSchema>;

export type PendingCalendarChangeRecordLike = {
  plan: Prisma.JsonValue;
  resolvedTarget: Prisma.JsonValue | null;
  userTimezone: string;
  userRequest: string;
};

export function parsePendingCalendarChangeRecord(
  record: PendingCalendarChangeRecordLike,
): PendingCalendarChangePayload | null {
  const rawResolvedTarget = record.resolvedTarget ?? undefined;
  const payloadInput = Array.isArray(rawResolvedTarget)
    ? {
        plan: record.plan,
        resolvedTargets: rawResolvedTarget,
        userTimezone: record.userTimezone,
        userRequest: record.userRequest,
      }
    : {
        plan: record.plan,
        resolvedTarget: rawResolvedTarget,
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

