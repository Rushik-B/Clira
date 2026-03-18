import { z } from 'zod';
import {
  CalendarCreatorLlmSchema,
  CalendarCreatorPlanSchema,
  type CalendarCreatorPlanDTO,
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

  if (raw.action === 'create') {
    const drafts = (raw.createItems ?? []).map((draft) => {
      const itemCalendarId = resolveCalendarId(
        draft.calendarId ?? shared.calendarId,
        context.availableCalendars,
        shared.calendarId,
      );
      return itemCalendarId === shared.calendarId
        ? draft
        : {
            ...draft,
            calendarId: itemCalendarId,
          };
    });

    if (drafts.length === 0) {
      return createClarifyPlan(shared, 'What event should I create?');
    }

    const plan: CalendarCreatorPlanDTO =
      drafts.length === 1
        ? {
            action: 'create',
            confidence: shared.confidence,
            requiresConfirmation: true,
            sendUpdates: shared.sendUpdates,
            createMeetLink: shared.createMeetLink,
            calendarId: shared.calendarId,
            eventDraft: drafts[0],
            userPreviewText: '',
          }
        : {
            action: 'create',
            confidence: shared.confidence,
            requiresConfirmation: true,
            sendUpdates: shared.sendUpdates,
            createMeetLink: shared.createMeetLink,
            calendarId: shared.calendarId,
            eventDrafts: drafts,
            userPreviewText: '',
          };

    const previewText = buildCalendarPlanPreview(plan, context);
    return CalendarCreatorPlanSchema.parse({
      ...plan,
      userPreviewText: previewText,
    });
  }

  if (raw.action === 'update') {
    const requestLooksLikeCalendarContainerChange =
      /\bcalendar\b|\bmove\b|\bmoved\b|\bwrong\b/i.test(context.request);

    const updates = (raw.updateItems ?? []).map((item) => ({
      target: resolveTargetFromPreResolvedEvents(
        item.target,
        context.resolvedEvents,
        shared.calendarId,
        context.currentTime.userTimezone,
      ),
      eventDraft: item.eventDraft,
      destinationCalendarId: item.destinationCalendarId
        ? findCalendarId(item.destinationCalendarId, context.availableCalendars)
        : undefined,
    }));

    if (updates.length === 0) {
      return createClarifyPlan(shared, 'Which event should I update, and what should change?');
    }

    const hasSuspiciousCalendarAsLocation = updates.some((item) => {
      const location = item.eventDraft.location?.trim();
      return (
        requestLooksLikeCalendarContainerChange &&
        typeof location === 'string' &&
        /\bcalendar\b/i.test(location)
      );
    });

    if (hasSuspiciousCalendarAsLocation) {
      return createClarifyPlan(
        shared,
        'Tell me which calendar each event should go to. Calendar choice is separate from the event details.',
      );
    }

    if (updates.some((item) => item.destinationCalendarId === null)) {
      return createClarifyPlan(
        shared,
        'I could not match one of those destination calendars. Tell me the exact calendar name you want for each event.',
      );
    }

    const plan: CalendarCreatorPlanDTO =
      updates.length === 1
        ? {
            action: 'update',
            confidence: shared.confidence,
            requiresConfirmation: true,
            sendUpdates: shared.sendUpdates,
            createMeetLink: shared.createMeetLink,
            calendarId: shared.calendarId,
            target: updates[0]!.target,
            eventDraft: updates[0]!.eventDraft,
            destinationCalendarId: updates[0]!.destinationCalendarId ?? undefined,
            userPreviewText: '',
          }
        : {
            action: 'update',
            confidence: shared.confidence,
            requiresConfirmation: true,
            sendUpdates: shared.sendUpdates,
            createMeetLink: shared.createMeetLink,
            calendarId: shared.calendarId,
            targets: updates.map((item) => item.target),
            eventDrafts: updates.map((item) => item.eventDraft),
            destinationCalendarIds: updates.some((item) => item.destinationCalendarId !== undefined)
              ? updates.map((item) => item.destinationCalendarId ?? undefined)
              : undefined,
            userPreviewText: '',
          };

    const previewText = buildCalendarPlanPreview(plan, context);
    return CalendarCreatorPlanSchema.parse({
      ...plan,
      userPreviewText: previewText,
    });
  }

  const targets = (raw.deleteTargets ?? []).map((target) =>
    resolveTargetFromPreResolvedEvents(
      target,
      context.resolvedEvents,
      shared.calendarId,
      context.currentTime.userTimezone,
    ),
  );

  if (targets.length === 0) {
    return createClarifyPlan(shared, 'Which event should I delete?');
  }

  const plan: CalendarCreatorPlanDTO =
    targets.length === 1
      ? {
          action: 'delete',
          confidence: shared.confidence,
          requiresConfirmation: true,
          sendUpdates: shared.sendUpdates,
          createMeetLink: shared.createMeetLink,
          calendarId: shared.calendarId,
          target: targets[0],
          userPreviewText: '',
        }
      : {
          action: 'delete',
          confidence: shared.confidence,
          requiresConfirmation: true,
          sendUpdates: shared.sendUpdates,
          createMeetLink: shared.createMeetLink,
          calendarId: shared.calendarId,
          targets,
          userPreviewText: '',
        };

  const previewText = buildCalendarPlanPreview(plan, context);
  return CalendarCreatorPlanSchema.parse({
    ...plan,
    userPreviewText: previewText,
  });
}
