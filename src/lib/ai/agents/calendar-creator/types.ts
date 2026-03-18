export type AvailableCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

export type ResolvedCalendarEvent = {
  eventId: string;
  calendarId: string;
  name: string;
  start: string;
  end: string;
};

export type CalendarCreatorCurrentTime = {
  utcNow: string;
  userTimezone: string;
  userLocalNow: string;
  dayOfWeek: string;
};

export type CalendarCreatorContext = {
  request: string;
  currentTime: CalendarCreatorCurrentTime;
  availableCalendars?: AvailableCalendar[];
  resolvedEvents?: ResolvedCalendarEvent[];
  abortSignal?: AbortSignal;
  deadlineAt?: number;
};
