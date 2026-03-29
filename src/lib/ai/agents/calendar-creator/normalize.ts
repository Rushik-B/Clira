import { z } from 'zod';
import {
  CalendarCreatorLlmSchema,
  CalendarCreatorPlanSchema,
  type CalendarCreatorPlanDTO,
  type CalendarMutationOperationDTO,
  type CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import { normalizeIsoDateInputToUtc } from '@/lib/utils/timezone';
import { buildCalendarPlanPreview } from './preview';
import { findCalendarId, resolveCalendarId } from './context';
import type {
  CalendarCreatorContext,
  ResolvedCalendarEvent,
} from './types';

type LlmPlanOutput = z.infer<typeof CalendarCreatorLlmSchema>;

function normalizeLookupText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isResolvedEventWithinRange(
  event: ResolvedCalendarEvent,
  target: Extract<CalendarTargetDTO, { lookupQuery: string }>,
  userTimezone: string,
): boolean {
  if (!target.lookupRange) {
    return true;
  }

  try {
    const rangeStart = normalizeIsoDateInputToUtc(
      target.lookupRange.startDate,
      userTimezone,
      'start',
    ).getTime();
    const rangeEnd = normalizeIsoDateInputToUtc(
      target.lookupRange.endDate,
      userTimezone,
      'end',
    ).getTime();
    const eventStart = normalizeIsoDateInputToUtc(event.start, userTimezone, 'start').getTime();
    const eventEnd = normalizeIsoDateInputToUtc(event.end, userTimezone, 'start').getTime();

    return eventStart <= rangeEnd && eventEnd >= rangeStart;
  } catch {
    return true;
  }
}

function resolveTargetFromPreResolvedEvents(
  target: CalendarTargetDTO,
  resolvedEvents: ResolvedCalendarEvent[] | undefined,
  fallbackCalendarId: string,
  userTimezone: string,
): CalendarTargetDTO {
  if (!('lookupQuery' in target) || !resolvedEvents || resolvedEvents.length === 0) {
    return 'eventId' in target
      ? {
          calendarId: target.calendarId ?? fallbackCalendarId,
          eventId: target.eventId,
        }
      : target;
  }

  const normalizedQuery = normalizeLookupText(target.lookupQuery);
  const matches = resolvedEvents.filter(
    (event) =>
      isResolvedEventWithinRange(event, target, userTimezone) &&
      (normalizeLookupText(event.name) === normalizedQuery ||
        normalizeLookupText(event.name).includes(normalizedQuery) ||
        normalizedQuery.includes(normalizeLookupText(event.name))),
  );

  if (matches.length !== 1) {
    return target;
  }

  const match = matches[0]!;
  return {
    calendarId: match.calendarId,
    eventId: match.eventId,
  };
}

function createClarifyPlan(
  shared: {
    confidence: number;
    sendUpdates: 'none' | 'all' | 'externalOnly';
    createMeetLink: boolean;
    calendarId: string;
  },
  question: string,
): CalendarCreatorPlanDTO {
  const plan: CalendarCreatorPlanDTO = {
    action: 'clarify',
    confidence: shared.confidence,
    requiresConfirmation: false,
    sendUpdates: shared.sendUpdates,
    createMeetLink: shared.createMeetLink,
    calendarId: shared.calendarId,
    clarifyingQuestions: [question],
    userPreviewText: question,
  };

  return CalendarCreatorPlanSchema.parse(plan);
}

function buildBundlePlan(
  shared: {
    confidence: number;
    sendUpdates: 'none' | 'all' | 'externalOnly';
    createMeetLink: boolean;
    calendarId: string;
  },
  ops: CalendarMutationOperationDTO[],
  context: Pick<
    CalendarCreatorContext,
    'availableCalendars' | 'resolvedEvents' | 'currentTime'
  >,
): CalendarCreatorPlanDTO {
  const plan: CalendarCreatorPlanDTO = {
    action: 'bundle',
    confidence: shared.confidence,
    requiresConfirmation: true,
    sendUpdates: shared.sendUpdates,
    createMeetLink: shared.createMeetLink,
    calendarId: shared.calendarId,
    ops,
    userPreviewText: '',
  };

  const previewText = buildCalendarPlanPreview(plan, context);
  return CalendarCreatorPlanSchema.parse({
    ...plan,
    userPreviewText: previewText,
  });
}

export function mapLlmOutputToPlan(
  raw: LlmPlanOutput,
  context: Pick<
    CalendarCreatorContext,
    'availableCalendars' | 'resolvedEvents' | 'currentTime' | 'request'
  >,
): CalendarCreatorPlanDTO {
  const shared = {
    confidence: raw.confidence ?? 70,
    sendUpdates: raw.sendUpdates ?? 'none',
    createMeetLink: raw.createMeetLink ?? false,
    calendarId: resolveCalendarId(
      raw.calendarId,
      context.availableCalendars,
      'primary',
    ),
  } satisfies {
    confidence: number;
    sendUpdates: 'none' | 'all' | 'externalOnly';
    createMeetLink: boolean;
    calendarId: string;
  };

  if (raw.action === 'clarify') {
    const questions = raw.clarifyingQuestions?.filter(Boolean) ?? [];
    return createClarifyPlan(
      shared,
      questions[0] ?? 'What should I do on your calendar?',
    );
  }

  const requestLooksLikeCalendarContainerChange =
    /\bcalendar\b|\bmove\b|\bmoved\b|\bwrong\b/i.test(context.request);

  const normalizedOps: CalendarMutationOperationDTO[] = [];

  if (raw.action === 'bundle') {
    for (const op of raw.ops ?? []) {
      if (op.kind === 'create') {
        const itemCalendarId = resolveCalendarId(
          op.eventDraft.calendarId ?? shared.calendarId,
          context.availableCalendars,
          shared.calendarId,
        );

        normalizedOps.push({
          kind: 'create',
          eventDraft:
            itemCalendarId === shared.calendarId
              ? op.eventDraft
              : {
                  ...op.eventDraft,
                  calendarId: itemCalendarId,
                },
          createMeetLink: op.createMeetLink ?? shared.createMeetLink,
        });
        continue;
      }

      if (op.kind === 'update') {
        const destinationCalendarId = op.destinationCalendarId
          ? findCalendarId(op.destinationCalendarId, context.availableCalendars)
          : undefined;

        if (destinationCalendarId === null) {
          return createClarifyPlan(
            shared,
            'I could not match one of those destination calendars. Tell me the exact calendar name you want for each event.',
          );
        }

        if (
          requestLooksLikeCalendarContainerChange &&
          typeof op.eventDraft.location === 'string' &&
          /\bcalendar\b/i.test(op.eventDraft.location.trim())
        ) {
          return createClarifyPlan(
            shared,
            'Tell me which calendar each event should go to. Calendar choice is separate from the event details.',
          );
        }

        normalizedOps.push({
          kind: 'update',
          target: resolveTargetFromPreResolvedEvents(
            op.target,
            context.resolvedEvents,
            shared.calendarId,
            context.currentTime.userTimezone,
          ),
          eventDraft: op.eventDraft,
          destinationCalendarId: destinationCalendarId ?? undefined,
          createMeetLink: op.createMeetLink ?? shared.createMeetLink,
        });
        continue;
      }

      normalizedOps.push({
        kind: 'delete',
        target: resolveTargetFromPreResolvedEvents(
          op.target,
          context.resolvedEvents,
          shared.calendarId,
          context.currentTime.userTimezone,
        ),
      });
    }
  } else if (raw.action === 'create') {
    for (const draft of raw.createItems ?? []) {
      const itemCalendarId = resolveCalendarId(
        draft.calendarId ?? shared.calendarId,
        context.availableCalendars,
        shared.calendarId,
      );

      normalizedOps.push({
        kind: 'create',
        eventDraft:
          itemCalendarId === shared.calendarId
            ? draft
            : {
                ...draft,
                calendarId: itemCalendarId,
              },
        createMeetLink: shared.createMeetLink,
      });
    }
  } else if (raw.action === 'update') {
    for (const item of raw.updateItems ?? []) {
      const destinationCalendarId = item.destinationCalendarId
        ? findCalendarId(item.destinationCalendarId, context.availableCalendars)
        : undefined;

      if (destinationCalendarId === null) {
        return createClarifyPlan(
          shared,
          'I could not match one of those destination calendars. Tell me the exact calendar name you want for each event.',
        );
      }

      if (
        requestLooksLikeCalendarContainerChange &&
        typeof item.eventDraft.location === 'string' &&
        /\bcalendar\b/i.test(item.eventDraft.location.trim())
      ) {
        return createClarifyPlan(
          shared,
          'Tell me which calendar each event should go to. Calendar choice is separate from the event details.',
        );
      }

      normalizedOps.push({
        kind: 'update',
        target: resolveTargetFromPreResolvedEvents(
          item.target,
          context.resolvedEvents,
          shared.calendarId,
          context.currentTime.userTimezone,
        ),
        eventDraft: item.eventDraft,
        destinationCalendarId: destinationCalendarId ?? undefined,
        createMeetLink: item.createMeetLink ?? shared.createMeetLink,
      });
    }
  } else if (raw.action === 'delete') {
    for (const target of raw.deleteTargets ?? []) {
      normalizedOps.push({
        kind: 'delete',
        target: resolveTargetFromPreResolvedEvents(
          target,
          context.resolvedEvents,
          shared.calendarId,
          context.currentTime.userTimezone,
        ),
      });
    }
  }

  if (normalizedOps.length === 0) {
    return createClarifyPlan(shared, 'What should I do on your calendar?');
  }

  return buildBundlePlan(shared, normalizedOps, context);
}
