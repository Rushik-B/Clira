import { normalizeIsoDateInputToUtc } from '@/lib/utils/timezone';

type CalendarAction = 'create' | 'update' | 'delete';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LIST_ITEM_LIMIT = 5;

export type UserFacingResolvedCalendarEvent = {
  name: string;
  start: string;
  end: string;
};

export type UserFacingGoogleEventTime = {
  dateTime?: string | null;
  date?: string | null;
  timeZone?: string | null;
};

export type UserFacingGoogleCalendarEvent = {
  summary: string;
  start?: UserFacingGoogleEventTime | null;
  end?: UserFacingGoogleEventTime | null;
};

function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateTime(value: string, timeZone: string): Date | null {
  if (!value || DATE_ONLY_PATTERN.test(value)) return null;
  try {
    const date = normalizeIsoDateInputToUtc(value, timeZone, 'start');
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function formatDateOnlyLabel(value: string): string {
  const date = parseDateOnly(value);
  if (!date) return value;

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatDateLabel(value: string, timeZone: string): string {
  const date = parseDateTime(value, timeZone);
  if (!date) return value;

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(date);
}

function formatTimeLabel(value: string, timeZone: string): string {
  const date = parseDateTime(value, timeZone);
  if (!date) return value;

  const minute = Number(
    new Intl.DateTimeFormat('en-US', { minute: 'numeric', timeZone }).format(date),
  );

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: minute === 0 ? undefined : '2-digit',
    timeZone,
  }).format(date);
}

function getLocalDayKey(value: string, timeZone: string): string | null {
  const date = parseDateTime(value, timeZone);
  if (!date) return null;

  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date);
}

function describeTimedWindow(
  start: string,
  end: string | undefined,
  timeZone: string,
): string {
  if (!end) {
    return `on ${formatDateLabel(start, timeZone)} at ${formatTimeLabel(start, timeZone)}`;
  }

  const startDay = getLocalDayKey(start, timeZone);
  const endDay = getLocalDayKey(end, timeZone);

  if (startDay && endDay && startDay === endDay) {
    return `on ${formatDateLabel(start, timeZone)} from ${formatTimeLabel(start, timeZone)} to ${formatTimeLabel(end, timeZone)}`;
  }

  return `from ${formatDateLabel(start, timeZone)} ${formatTimeLabel(start, timeZone)} to ${formatDateLabel(end, timeZone)} ${formatTimeLabel(end, timeZone)}`;
}

function describeDateOnlyWindow(
  start: string,
  end: string | undefined,
  endIsExclusive: boolean,
): string {
  if (!end) {
    return `on ${formatDateOnlyLabel(start)} (all day)`;
  }

  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  if (!startDate || !endDate) {
    return start === end ? `on ${start}` : `from ${start} to ${end}`;
  }

  const inclusiveEnd = new Date(endDate);
  if (endIsExclusive) {
    inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
  }

  const inclusiveEndValue = inclusiveEnd.toISOString().slice(0, 10);
  if (inclusiveEndValue === start) {
    return `on ${formatDateOnlyLabel(start)} (all day)`;
  }

  return `from ${formatDateOnlyLabel(start)} to ${formatDateOnlyLabel(inclusiveEndValue)} (all day)`;
}

function describeLooseWindow(start: string, end: string | undefined): string {
  if (!start) return '';
  if (!end || end === start) return start;
  return `${start} to ${end}`;
}

function formatResolvedEventWindow(
  event: UserFacingResolvedCalendarEvent,
  fallbackTimeZone: string,
): string {
  if (DATE_ONLY_PATTERN.test(event.start)) {
    return describeDateOnlyWindow(event.start, DATE_ONLY_PATTERN.test(event.end) ? event.end : undefined, false);
  }

  if (parseDateTime(event.start, fallbackTimeZone)) {
    return describeTimedWindow(
      event.start,
      parseDateTime(event.end, fallbackTimeZone) ? event.end : undefined,
      fallbackTimeZone,
    );
  }

  const looseWindow = describeLooseWindow(event.start, event.end);
  return looseWindow ? `(${looseWindow})` : '';
}

function resolveGoogleWindowValue(
  value: UserFacingGoogleEventTime | null | undefined,
): { kind: 'date'; value: string } | { kind: 'dateTime'; value: string; timeZone?: string | null } | null {
  if (!value) return null;
  if (typeof value.dateTime === 'string' && value.dateTime.trim()) {
    return {
      kind: 'dateTime',
      value: value.dateTime,
      timeZone: value.timeZone,
    };
  }
  if (typeof value.date === 'string' && value.date.trim()) {
    return {
      kind: 'date',
      value: value.date,
    };
  }
  return null;
}

function formatGoogleEventWindow(
  event: UserFacingGoogleCalendarEvent,
  fallbackTimeZone: string,
): string {
  const start = resolveGoogleWindowValue(event.start);
  const end = resolveGoogleWindowValue(event.end);

  if (!start) return '';

  if (start.kind === 'date') {
    return describeDateOnlyWindow(start.value, end?.kind === 'date' ? end.value : undefined, true);
  }

  return describeTimedWindow(
    start.value,
    end?.kind === 'dateTime' ? end.value : undefined,
    start.timeZone || fallbackTimeZone,
  );
}

function formatListItems(items: string[]): string {
  if (items.length <= LIST_ITEM_LIMIT) {
    return items.map((item, index) => `${index + 1}) ${item}`).join('\n');
  }

  const visibleItems = items.slice(0, LIST_ITEM_LIMIT);
  const hiddenCount = items.length - visibleItems.length;
  return `${visibleItems.map((item, index) => `${index + 1}) ${item}`).join('\n')}\n...and ${hiddenCount} more.`;
}

export function describeResolvedCalendarEvent(
  event: UserFacingResolvedCalendarEvent,
  fallbackTimeZone: string,
): string {
  const summary = event.name?.trim() || '(Untitled event)';
  const window = formatResolvedEventWindow(event, fallbackTimeZone);
  if (!window) return `"${summary}"`;
  if (window.startsWith('(')) return `"${summary}" ${window}`;
  return `"${summary}" ${window}`;
}

export function describeGoogleCalendarEvent(
  event: UserFacingGoogleCalendarEvent,
  fallbackTimeZone: string,
): string {
  const summary = event.summary?.trim() || '(Untitled event)';
  const window = formatGoogleEventWindow(event, fallbackTimeZone);
  return window ? `"${summary}" ${window}` : `"${summary}"`;
}

export function buildCalendarPreviewMessage(action: CalendarAction, items: string[]): string {
  if (items.length === 1) {
    if (action === 'create') {
      return `**Ready to add**\n\n${items[0]}\n\nReply **confirm** and I'll put it on your calendar.`;
    }

    if (action === 'update') {
      return `**Ready to update**\n\n${items[0]}\n\nReply **confirm** and I'll make that change.`;
    }

    return `**Ready to delete**\n\n${items[0]}\n\nReply **confirm** and I'll delete it.`;
  }

  const list = formatListItems(items);

  if (action === 'create') {
    return `**Ready to add ${items.length} events**\n\n${list}\n\nReply **confirm** and I'll add them.`;
  }

  if (action === 'update') {
    return `**Ready to update ${items.length} events**\n\n${list}\n\nReply **confirm** and I'll apply those changes.`;
  }

  return `**Ready to delete ${items.length} events**\n\n${list}\n\nReply **confirm** and I'll delete them.`;
}

export function buildCalendarCompletionMessage(params: {
  action: CalendarAction;
  items: string[];
  failureCount?: number;
}): string {
  const { action, items, failureCount = 0 } = params;

  if (items.length === 0) {
    if (action === 'create') return 'No calendar events were created.';
    if (action === 'update') return 'No calendar events were updated.';
    return 'No calendar events were deleted.';
  }

  const singularVerb = action === 'create' ? 'Added' : action === 'update' ? 'Updated' : 'Deleted';
  const pluralVerb = action === 'create' ? 'added' : action === 'update' ? 'updated' : 'deleted';

  if (items.length === 1 && failureCount === 0) {
    return `**All set.**\n\n${singularVerb} ${items[0]}.`;
  }

  const list = formatListItems(items);
  const eventLabel = items.length === 1 ? 'event' : 'events';

  if (failureCount > 0) {
    const failureLabel =
      failureCount === 1 ? '1 other change did not go through' : `${failureCount} other changes did not go through`;
    return `**Partially done.**\n\nI ${pluralVerb} ${items.length} ${eventLabel}, but ${failureLabel}:\n\n${list}`;
  }

  return `**All set.**\n\nI ${pluralVerb} these ${items.length} ${eventLabel}:\n\n${list}`;
}
