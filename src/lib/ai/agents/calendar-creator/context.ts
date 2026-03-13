import { readPromptFile } from '@/lib/prompts';
import type {
  AvailableCalendar,
  CalendarCreatorContext,
  ResolvedCalendarEvent,
} from './types';

export const EARLY_EXIT_BUFFER_MS = 3_000;

export function isTimeLow(deadlineAt?: number, bufferMs = EARLY_EXIT_BUFFER_MS): boolean {
  return typeof deadlineAt === 'number' && deadlineAt - Date.now() < bufferMs;
}

function formatAvailableCalendars(calendars?: AvailableCalendar[]): string {
  if (!calendars || calendars.length === 0) {
    return '(No calendar list available. Default to primary.)';
  }

  return calendars
    .map((calendar) => {
      const primaryTag = calendar.primary ? ' primary=yes' : ' primary=no';
      return `- [calendar id="${calendar.id}" name="${calendar.summary}" access="${calendar.accessRole}"${primaryTag}]`;
    })
    .join('\n');
}

function formatResolvedEvents(events?: ResolvedCalendarEvent[]): string {
  if (!events || events.length === 0) {
    return '(No pre-resolved events available.)';
  }

  return events
    .map(
      (event) =>
        `- [resolved_event id="${event.eventId}" calendarId="${event.calendarId}" name="${event.name}" start="${event.start}" end="${event.end}"]`,
    )
    .join('\n');
}

export function buildCalendarCreatorPrompt(context: CalendarCreatorContext): string {
  const template = readPromptFile('core-processing/calendarCreatorPrompt.md');

  return template
    .replace('{utcNow}', context.currentTime.utcNow)
    .replace('{userTimezone}', context.currentTime.userTimezone)
    .replace('{userLocalNow}', context.currentTime.userLocalNow)
    .replace('{dayOfWeek}', context.currentTime.dayOfWeek)
    .replace('{userRequest}', context.request)
    .replace('{availableCalendars}', formatAvailableCalendars(context.availableCalendars))
    .replace('{resolvedEvents}', formatResolvedEvents(context.resolvedEvents));
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveCalendarId(
  candidate: string | undefined,
  calendars: AvailableCalendar[] | undefined,
  fallback = 'primary',
): string {
  if (!candidate || !candidate.trim()) {
    return calendars?.find((calendar) => calendar.primary)?.id ?? fallback;
  }

  if (!calendars || calendars.length === 0) {
    return fallback;
  }

  const normalizedCandidate = normalizeLookupValue(candidate);

  const exactIdMatch = calendars.find(
    (calendar) => normalizeLookupValue(calendar.id) === normalizedCandidate,
  );
  if (exactIdMatch) {
    return exactIdMatch.id;
  }

  const exactNameMatch = calendars.find(
    (calendar) => normalizeLookupValue(calendar.summary) === normalizedCandidate,
  );
  if (exactNameMatch) {
    return exactNameMatch.id;
  }

  const fuzzyNameMatch = calendars.find((calendar) => {
    const normalizedSummary = normalizeLookupValue(calendar.summary);
    return (
      normalizedSummary.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedSummary)
    );
  });
  if (fuzzyNameMatch) {
    return fuzzyNameMatch.id;
  }

  return calendars.find((calendar) => calendar.primary)?.id ?? fallback;
}

export function getCalendarLabel(
  calendarId: string | undefined,
  calendars: AvailableCalendar[] | undefined,
): string {
  const resolvedId = calendarId ?? calendars?.find((calendar) => calendar.primary)?.id ?? 'primary';
  const match = calendars?.find((calendar) => calendar.id === resolvedId);
  return match?.summary ?? resolvedId;
}
