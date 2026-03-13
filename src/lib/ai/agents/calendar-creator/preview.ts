import type {
  CalendarCreatorPlanDTO,
  CalendarEventDraftDTO,
  CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import type {
  AvailableCalendar,
  CalendarCreatorContext,
  ResolvedCalendarEvent,
} from './types';
import {
  buildCalendarPreviewMessage,
  describeResolvedCalendarEvent,
} from '@/lib/ai/calendar-user-facing';
import { getCalendarLabel } from './context';

function formatDateTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const minute = date.getUTCMinutes();

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: minute === 0 ? undefined : '2-digit',
    timeZone,
  }).format(date);
}

function formatDateOnly(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatEventWindow(
  start: CalendarEventDraftDTO['start'] | undefined,
  end: CalendarEventDraftDTO['end'] | undefined,
  fallbackTimeZone: string,
): string | null {
  if (!start) return null;

  if ('date' in start) {
    if (!end || !('date' in end)) {
      return `${formatDateOnly(start.date)} (all day)`;
    }

    const startLabel = formatDateOnly(start.date);
    const endDateExclusive = new Date(`${end.date}T00:00:00Z`);
    if (!Number.isNaN(endDateExclusive.getTime())) {
      endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() - 1);
      const inclusiveEnd = endDateExclusive.toISOString().slice(0, 10);
      if (inclusiveEnd === start.date) {
        return `${startLabel} (all day)`;
      }
      return `${startLabel} to ${formatDateOnly(inclusiveEnd)} (all day)`;
    }

    return `${startLabel} to ${formatDateOnly(end.date)} (all day)`;
  }

  const timeZone = start.timeZone || fallbackTimeZone;
  const startLabel = formatDateTime(start.dateTime, timeZone);
  if (!end || !('dateTime' in end)) {
    return startLabel;
  }

  return `${startLabel} to ${formatDateTime(end.dateTime, end.timeZone || timeZone)}`;
}

function findResolvedEvent(
  target: CalendarTargetDTO | undefined,
  resolvedEvents: ResolvedCalendarEvent[] | undefined,
): ResolvedCalendarEvent | null {
  if (!target || !resolvedEvents || resolvedEvents.length === 0) {
    return null;
  }

  if ('eventId' in target) {
    return (
      resolvedEvents.find(
        (event) =>
          event.eventId === target.eventId &&
          (!target.calendarId || event.calendarId === target.calendarId),
      ) ?? null
    );
  }

  const normalizedQuery = target.lookupQuery.trim().toLowerCase();
  const matches = resolvedEvents.filter((event) => {
    const normalizedName = event.name.trim().toLowerCase();
    return (
      normalizedName === normalizedQuery ||
      normalizedName.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedName)
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function summarizeCreateDraft(
  draft: CalendarEventDraftDTO,
  calendars: AvailableCalendar[] | undefined,
  fallbackTimeZone: string,
  fallbackCalendarId: string | undefined,
): string {
  const summary = draft.summary ?? '(Untitled event)';
  const when = formatEventWindow(draft.start, draft.end, fallbackTimeZone);
  const calendarLabel = getCalendarLabel(
    (draft as { calendarId?: string }).calendarId ?? fallbackCalendarId,
    calendars,
  );
  const timeLabel = when ? ` on ${when}` : '';
  return `"${summary}"${timeLabel} in ${calendarLabel}`;
}

function summarizeUpdateChanges(
  draft: CalendarEventDraftDTO,
  fallbackTimeZone: string,
): string {
  const changes: string[] = [];

  if (draft.summary) {
    changes.push(`rename to "${draft.summary}"`);
  }

  const when = formatEventWindow(draft.start, draft.end, fallbackTimeZone);
  if (when) {
    changes.push(`move to ${when}`);
  }

  if (draft.location) {
    changes.push(`set location to "${draft.location}"`);
  }

  if (draft.description) {
    changes.push('update notes');
  }

  if (draft.attendees) {
    changes.push('update attendees');
  }

  if (changes.length === 0) {
    return 'apply the requested changes';
  }

  return changes.join('; ');
}

function summarizeTarget(
  target: CalendarTargetDTO,
  resolvedEvents: ResolvedCalendarEvent[] | undefined,
): string {
  const resolved = findResolvedEvent(target, resolvedEvents);
  if (resolved) {
    return `"${resolved.name}"`;
  }

  if ('eventId' in target) {
    return 'that event';
  }

  return `"${target.lookupQuery}"`;
}

export function buildCalendarPlanPreview(
  plan: CalendarCreatorPlanDTO,
  context: Pick<CalendarCreatorContext, 'availableCalendars' | 'resolvedEvents' | 'currentTime'>,
): string {
  const fallbackTimeZone = context.currentTime.userTimezone;

  if (plan.action === 'clarify') {
    return plan.clarifyingQuestions[0] ?? 'What should I do on your calendar?';
  }

  if (plan.action === 'create') {
    const drafts = plan.eventDrafts?.length ? plan.eventDrafts : plan.eventDraft ? [plan.eventDraft] : [];
    const items = drafts.map((draft) =>
      summarizeCreateDraft(draft, context.availableCalendars, fallbackTimeZone, plan.calendarId),
    );

    return buildCalendarPreviewMessage('create', items);
  }

  if (plan.action === 'update') {
    const targets = plan.targets?.length ? plan.targets : plan.target ? [plan.target] : [];
    const drafts = plan.eventDrafts?.length ? plan.eventDrafts : plan.eventDraft ? [plan.eventDraft] : [];
    const items = targets.map((target, index) => {
      const draft = drafts[index] ?? plan.eventDraft;
      const targetSummary = summarizeTarget(target, context.resolvedEvents);
      const changeSummary = draft
        ? summarizeUpdateChanges(draft, fallbackTimeZone)
        : 'apply the requested changes';
      return `${targetSummary} -> ${changeSummary}`;
    });

    return buildCalendarPreviewMessage('update', items);
  }

  const targets = plan.targets?.length ? plan.targets : plan.target ? [plan.target] : [];
  const items = targets.map((target) => {
    const resolved = findResolvedEvent(target, context.resolvedEvents);
    if (resolved) {
      return describeResolvedCalendarEvent(
        {
          name: resolved.name,
          start: resolved.start,
          end: resolved.end,
        },
        fallbackTimeZone,
      );
    }

    return summarizeTarget(target, context.resolvedEvents);
  });

  return buildCalendarPreviewMessage('delete', items);
}
