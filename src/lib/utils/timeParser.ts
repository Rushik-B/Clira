import * as chrono from 'chrono-node';
import { convertUserLocalTimeToUtc, getUserReferenceDate } from '@/lib/utils/timezone';

export type TimeParseConfidence = 'high' | 'medium' | 'low';

export type TimeParseResult = {
  date: Date;
  confidence: TimeParseConfidence;
  originalText: string;
};

export type TimeParseOptions = {
  now?: Date;
  timeZone?: string;
};

const MERIDIEM_REGEX = /\b(am|pm|a\.m\.|p\.m\.|morning|afternoon|evening|night|noon|midnight)\b/i;
const TIME_HINT_REGEX = /(\d{1,2}:\d{2})|(\b(at|around|by|before|after)\s+\d{1,2}\b)/i;
const ISO_WITH_TZ_REGEX = /(z|[+-]\d{2}:\d{2})$/i;

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function hasMeridiem(text: string): boolean {
  return MERIDIEM_REGEX.test(text);
}

function hasTimeHint(text: string): boolean {
  return TIME_HINT_REGEX.test(text) || /\b(noon|midnight)\b/i.test(text);
}

export function parseReminderTime(input: string, options: TimeParseOptions = {}): TimeParseResult | null {
  const originalText = input.trim();
  if (!originalText) return null;

  if (ISO_WITH_TZ_REGEX.test(originalText)) {
    const absoluteDate = new Date(originalText);
    if (Number.isNaN(absoluteDate.getTime())) return null;
    return {
      date: absoluteDate,
      confidence: 'high',
      originalText,
    };
  }

  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? 'UTC';
  const referenceDate = getUserReferenceDate(now, timeZone);

  const parsedResults = chrono.parse(originalText, referenceDate, { forwardDate: true });
  let confidence: TimeParseConfidence = 'high';

  if (parsedResults.length === 0) {
    const fallbackDate = new Date(originalText);
    if (Number.isNaN(fallbackDate.getTime())) return null;
    return {
      date: fallbackDate,
      confidence: 'low',
      originalText,
    };
  }

  let parsedLocal = parsedResults[0]?.start?.date();
  if (!parsedLocal || Number.isNaN(parsedLocal.getTime())) return null;

  const needsInference = hasTimeHint(originalText) && !hasMeridiem(originalText);
  if (needsInference) {
    const nowHour = referenceDate.getUTCHours();
    const targetHour = parsedLocal.getUTCHours();

    if (nowHour >= 22 && targetHour < 8) {
      parsedLocal = addDays(parsedLocal, 1);
      confidence = 'medium';
    } else if (nowHour >= 12 && targetHour >= 1 && targetHour <= 11) {
      parsedLocal = addHours(parsedLocal, 12);
      confidence = 'medium';
    } else if (nowHour < 12 && targetHour > nowHour) {
      // Keep same-day morning; no adjustment needed.
    } else if (targetHour <= nowHour) {
      parsedLocal = addDays(parsedLocal, 1);
      confidence = 'medium';
    }
  }

  while (parsedLocal.getTime() <= referenceDate.getTime()) {
    parsedLocal = addDays(parsedLocal, 1);
    confidence = confidence === 'high' ? 'medium' : confidence;
  }

  const utcDate = convertUserLocalTimeToUtc(parsedLocal, timeZone);

  return {
    date: utcDate,
    confidence,
    originalText,
  };
}
