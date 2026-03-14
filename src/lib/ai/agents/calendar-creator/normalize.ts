import { z } from 'zod';
import {
  CalendarCreatorLlmSchema,
  CalendarCreatorPlanSchema,
  type CalendarCreatorPlanDTO,
  type CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import { buildCalendarPlanPreview } from './preview';
import { resolveCalendarId } from './context';
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
): boolean {
  if (!target.lookupRange) {
    return true;
  }

  const rangeStart = Date.parse(target.lookupRange.startDate);
  const rangeEnd = Date.parse(target.lookupRange.endDate);
  const eventStart = Date.parse(event.start);
  const eventEnd = Date.parse(event.end);

  if (
    Number.isNaN(rangeStart) ||
    Number.isNaN(rangeEnd) ||
    Number.isNaN(eventStart) ||
    Number.isNaN(eventEnd)
  ) {
    return true;
  }

  return eventStart <= rangeEnd && eventEnd >= rangeStart;
}

function resolveTargetFromPreResolvedEvents(
  target: CalendarTargetDTO,
  resolvedEvents: ResolvedCalendarEvent[] | undefined,
  fallbackCalendarId: string,
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
      isResolvedEventWithinRange(event, target) &&
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
  context: Pick<CalendarCreatorContext, 'availableCalendars' | 'resolvedEvents' | 'currentTime'>,
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
    const updates = (raw.updateItems ?? []).map((item) => ({
      target: resolveTargetFromPreResolvedEvents(
        item.target,
        context.resolvedEvents,
        shared.calendarId,
      ),
      eventDraft: item.eventDraft,
    }));

    if (updates.length === 0) {
      return createClarifyPlan(shared, 'Which event should I update, and what should change?');
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
