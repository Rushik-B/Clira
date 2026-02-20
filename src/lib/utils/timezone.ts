export type ZonedTimeComponents = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type DateOnlyComponents = { year: number; month: number; day: number };

export function getZonedTimeComponents(date: Date, timeZone: string): ZonedTimeComponents {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
  };
}

export function getUserReferenceDate(now: Date, timeZone: string): Date {
  const userNow = getZonedTimeComponents(now, timeZone);
  return new Date(
    Date.UTC(userNow.year, userNow.month - 1, userNow.day, userNow.hour, userNow.minute, userNow.second),
  );
}

export function getDateOnlyInTimezone(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedTimeComponents(date, timeZone);
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateOnlyComponents(dateOnly: string): DateOnlyComponents | null {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const parts = parseDateOnlyComponents(dateOnly);
  if (!parts) {
    throw new Error(`Invalid date-only string: "${dateOnly}" (expected YYYY-MM-DD)`);
  }

  const dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yyyy = String(dt.getUTCFullYear()).padStart(4, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function startOfTodayInTimezone(now: Date, timeZone: string): Date {
  const today = getDateOnlyInTimezone(now, timeZone);
  return startOfDayInTimezone(today, timeZone);
}

export function endOfTodayInTimezone(now: Date, timeZone: string): Date {
  const today = getDateOnlyInTimezone(now, timeZone);
  return endOfDayInTimezone(today, timeZone);
}

/**
 * Converts user local time components (represented as a UTC Date) to a true UTC timestamp.
 * Iteratively adjusts for timezone offset including DST transitions.
 */
export function convertUserLocalTimeToUtc(userLocalTimeAsUtc: Date, timeZone: string): Date {
  const targetTime = userLocalTimeAsUtc.getTime();
  let guess = new Date(targetTime);

  for (let i = 0; i < 4; i += 1) {
    const guessComponents = getZonedTimeComponents(guess, timeZone);

    const guessWallClockAsUtc = Date.UTC(
      guessComponents.year,
      guessComponents.month - 1,
      guessComponents.day,
      guessComponents.hour,
      guessComponents.minute,
      guessComponents.second,
    );

    const error = targetTime - guessWallClockAsUtc;
    if (Math.abs(error) < 1000) break;
    guess = new Date(guess.getTime() + error);
  }

  return guess;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date-only string → Timezone-aware UTC Date helpers
//
// These solve the common bug where `new Date("2026-02-02").setHours(23,59,59)`
// uses the SERVER's timezone instead of the USER's timezone.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts year/month/day from a date-only string or Date object.
 * Handles ISO date strings like "2026-02-02" (parsed as UTC midnight).
 */
function extractDateComponents(dateInput: string | Date): { year: number; month: number; day: number } {
  if (typeof dateInput === 'string') {
    // For date-only strings like "2026-02-02", parse as UTC to avoid timezone shift
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10) - 1, // 0-indexed for Date.UTC
        day: parseInt(match[3], 10),
      };
    }
    // Fallback: parse and use UTC components
    const d = new Date(dateInput);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
  }
  // For Date objects, use UTC components
  return { year: dateInput.getUTCFullYear(), month: dateInput.getUTCMonth(), day: dateInput.getUTCDate() };
}

/**
 * Returns a UTC Date representing the START of the given day (00:00:00.000)
 * in the specified timezone.
 *
 * @example
 * // "2026-02-02" at midnight in Los Angeles = Feb 2, 2026 08:00:00 UTC
 * startOfDayInTimezone("2026-02-02", "America/Los_Angeles")
 *
 * @param dateInput - Date string (e.g., "2026-02-02") or Date object
 * @param timeZone - IANA timezone (e.g., "America/Los_Angeles")
 * @returns UTC Date for midnight of that day in the user's timezone
 */
export function startOfDayInTimezone(dateInput: string | Date, timeZone: string): Date {
  const { year, month, day } = extractDateComponents(dateInput);
  // Create "fake UTC" representing user's local midnight
  const userLocalMidnight = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  // Convert to real UTC
  return convertUserLocalTimeToUtc(userLocalMidnight, timeZone);
}

/**
 * Returns a UTC Date representing the END of the given day (23:59:59.999)
 * in the specified timezone.
 *
 * @example
 * // "2026-02-02" at 11:59:59 PM in Los Angeles = Feb 3, 2026 07:59:59.999 UTC
 * endOfDayInTimezone("2026-02-02", "America/Los_Angeles")
 *
 * @param dateInput - Date string (e.g., "2026-02-02") or Date object
 * @param timeZone - IANA timezone (e.g., "America/Los_Angeles")
 * @returns UTC Date for 23:59:59.999 of that day in the user's timezone
 */
export function endOfDayInTimezone(dateInput: string | Date, timeZone: string): Date {
  const { year, month, day } = extractDateComponents(dateInput);
  // Create "fake UTC" representing user's local end of day
  const userLocalEndOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  // Convert to real UTC
  return convertUserLocalTimeToUtc(userLocalEndOfDay, timeZone);
}

const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_NO_TZ_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ISO_UTC_DAY_START_REGEX = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0{1,3})?(?:Z|[+-]00:00)$/;
const ISO_UTC_DAY_END_REGEX = /^(\d{4}-\d{2}-\d{2})T23:59:59(?:\.\d{1,3})?(?:Z|[+-]00:00)$/;

/**
 * Normalizes an ISO-like date input to a real UTC Date for querying APIs.
 *
 * Supports:
 * - Date-only strings: "YYYY-MM-DD" (interpreted as that day in the user's timezone)
 * - ISO date-times WITHOUT a timezone: "YYYY-MM-DDTHH:mm[:ss[.SSS]]"
 *   (interpreted as user-local wall clock time, avoiding server-TZ parsing bugs)
 * - ISO date-times WITH timezone (Z / +/-HH:MM): treated as absolute instants
 *
 * Additionally, it special-cases a common LLM mistake:
 * - "YYYY-MM-DDT00:00:00Z" and "YYYY-MM-DDT23:59:59Z" are treated as date-only boundaries
 *   in the user's timezone (so "today" means user-local day, not UTC day).
 */
export function normalizeIsoDateInputToUtc(
  input: string,
  timeZone: string,
  boundary: 'start' | 'end',
): Date {
  const value = input.trim();
  if (!value) {
    throw new Error('Date input is empty');
  }

  if (ISO_DATE_ONLY_REGEX.test(value)) {
    return boundary === 'start' ? startOfDayInTimezone(value, timeZone) : endOfDayInTimezone(value, timeZone);
  }

  if (boundary === 'start') {
    const m = value.match(ISO_UTC_DAY_START_REGEX);
    if (m) return startOfDayInTimezone(m[1]!, timeZone);
  } else {
    const m = value.match(ISO_UTC_DAY_END_REGEX);
    if (m) return endOfDayInTimezone(m[1]!, timeZone);
  }

  const noTzMatch = value.match(ISO_DATE_TIME_NO_TZ_REGEX);
  if (noTzMatch) {
    const year = Number.parseInt(noTzMatch[1]!, 10);
    const month = Number.parseInt(noTzMatch[2]!, 10);
    const day = Number.parseInt(noTzMatch[3]!, 10);
    const hour = Number.parseInt(noTzMatch[4]!, 10);
    const minute = Number.parseInt(noTzMatch[5]!, 10);
    const second = noTzMatch[6] ? Number.parseInt(noTzMatch[6], 10) : 0;
    const ms = noTzMatch[7]
      ? Number.parseInt(noTzMatch[7].padEnd(3, '0').slice(0, 3), 10)
      : 0;

    const userWallClockAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
    return convertUserLocalTimeToUtc(userWallClockAsUtc, timeZone);
  }

  const absolute = new Date(value);
  if (Number.isNaN(absolute.getTime())) {
    throw new Error(`Invalid ISO date input: "${input}"`);
  }
  return absolute;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a Date in the specified timezone as a human-readable string.
 *
 * @example
 * formatDateTimeInTimeZone(new Date(), "America/Los_Angeles")
 * // "Jan 15, 2026, 09:30 AM PST"
 */
export function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString('en-US');
  }
}
