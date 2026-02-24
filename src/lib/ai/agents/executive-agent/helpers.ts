import crypto from 'crypto';
import { createDeadlineController } from '@/lib/ai/callLlm';
import { logger } from '@/lib/logger';
import { extractToolCallsSummary } from '@/lib/ai/agents/executiveToolCallSummary';
import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import type {
  CalendarEventDraftDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import {
  MESSAGING_FIRST_TOOL_MAX_BUDGET_MS,
  MESSAGING_MIN_SUBAGENT_BUDGET_MS,
  MESSAGING_SUBSEQUENT_TOOL_RESERVE_MS,
  MESSAGING_TOOL_RESPONSE_BUFFER_MS,
} from './constants';
import type { ExecutiveAgentInput } from './types';

export function truncate(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

/**
 * Formats a relative time string (e.g., "2 hours ago", "yesterday", "3 days ago").
 */
export function formatRelativeTime(msAgo: number): string {
  const seconds = Math.floor(msAgo / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  return 'just now';
}

export function extractLatestToolResult(toolResults: unknown, toolName: string): Record<string, unknown> | null {
  if (!Array.isArray(toolResults)) return null;

  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const candidate = toolResults[i];
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const name = record.toolName ?? record.name ?? record.tool;
    if (name !== toolName) continue;

    const result = record.result;
    if (result && typeof result === 'object') {
      return result as Record<string, unknown>;
    }
  }

  return null;
}

export function buildTerminalFallbackResponse(toolResults: unknown): string {
  const sendResult = extractLatestToolResult(toolResults, 'send_email');
  if (sendResult) {
    if (sendResult.success === true) return 'Sent!';
    const message = sendResult.message;
    if (typeof message === 'string' && message.trim()) return message;
    return 'I could not send that email. Please try again.';
  }

  const commitResult = extractLatestToolResult(toolResults, 'commit_calendar_change');
  if (commitResult) {
    const message = commitResult.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (commitResult.ok === true) return 'Calendar change completed.';
    return 'I could not complete that calendar change.';
  }

  return "I couldn't generate a response. Please try again.";
}

export function isDateTimeTime(value: CalendarEventDraftDTO['start']): value is { dateTime: string; timeZone: string } {
  return Boolean(value && 'dateTime' in value);
}

export function isDateOnlyTime(value: CalendarEventDraftDTO['start']): value is { date: string } {
  return Boolean(value && 'date' in value);
}

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateEventDraftTimes(
  draft: CalendarEventDraftDTO,
  action: 'create' | 'update',
): { ok: true } | { ok: false; message: string } {
  const start = draft.start;
  const end = draft.end;

  if (!start && !end) {
    return action === 'update'
      ? { ok: true }
      : { ok: false, message: 'Missing start/end times.' };
  }

  if ((start && !end) || (!start && end)) {
    if (action === 'create') {
      return { ok: false, message: 'Both start and end are required when specifying event times.' };
    }

    const timeValue = start ?? end;
    if (!timeValue) return { ok: true };

    if (isDateTimeTime(timeValue)) {
      if (!timeValue.timeZone) return { ok: false, message: 'Timed events require a timezone.' };
      const dt = new Date(timeValue.dateTime);
      if (Number.isNaN(dt.getTime())) return { ok: false, message: 'Invalid dateTime format.' };
      return { ok: true };
    }

    if (isDateOnlyTime(timeValue)) {
      const parsed = parseDateOnly(timeValue.date);
      if (!parsed) return { ok: false, message: 'Invalid date-only format. Use YYYY-MM-DD.' };
      return { ok: true };
    }

    return { ok: false, message: 'Invalid event time format.' };
  }

  if (!start || !end) {
    return { ok: false, message: 'Missing start/end times.' };
  }

  if (isDateTimeTime(start) !== isDateTimeTime(end)) {
    return { ok: false, message: 'Start and end must both be dateTime or both be date-only.' };
  }

  if (isDateTimeTime(start) && isDateTimeTime(end)) {
    if (!start.timeZone || !end.timeZone) {
      return { ok: false, message: 'Timed events require a timezone.' };
    }

    const startDt = new Date(start.dateTime);
    const endDt = new Date(end.dateTime);
    if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
      return { ok: false, message: 'Invalid dateTime format.' };
    }

    if (startDt >= endDt) {
      return { ok: false, message: 'End time must be after the start time.' };
    }

    return { ok: true };
  }

  if (isDateOnlyTime(start) && isDateOnlyTime(end)) {
    const startDate = parseDateOnly(start.date);
    const endDate = parseDateOnly(end.date);
    if (!startDate || !endDate) {
      return { ok: false, message: 'Invalid date-only format. Use YYYY-MM-DD.' };
    }

    if (start.date >= end.date) {
      return {
        ok: false,
        message: 'All-day events require an exclusive end date after the start date.',
      };
    }

    return { ok: true };
  }

  return { ok: false, message: 'Invalid event time format.' };
}

export type GoogleEventTime = {
  dateTime?: string | null;
  date?: string | null;
  timeZone?: string | null;
};

export function addDaysDateOnly(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date) throw new Error('Invalid date-only format. Use YYYY-MM-DD.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveGoogleEventTime(value: GoogleEventTime | null | undefined): { dateTime: string } | { date: string } | null {
  if (!value) return null;
  if (typeof value.dateTime === 'string' && value.dateTime.trim()) return { dateTime: value.dateTime };
  if (typeof value.date === 'string' && value.date.trim()) return { date: value.date };
  return null;
}

export function normalizeUpdateDraftTimesForPatch({
  draft,
  currentEvent,
}: {
  draft: CalendarEventDraftDTO;
  currentEvent: { start?: GoogleEventTime | null; end?: GoogleEventTime | null };
}): { ok: true; patch: CalendarEventDraftDTO } | { ok: false; message: string } {
  const start = draft.start;
  const end = draft.end;

  if (!start && !end) return { ok: true, patch: draft };

  if (start && end) {
    const validation = validateEventDraftTimes(draft, 'update');
    return validation.ok ? { ok: true, patch: draft } : { ok: false, message: validation.message };
  }

  const currentStart = resolveGoogleEventTime(currentEvent.start);
  const currentEnd = resolveGoogleEventTime(currentEvent.end);
  if (!currentStart) return { ok: false, message: 'Current event is missing a start time.' };
  if (!currentEnd) return { ok: false, message: 'Current event is missing an end time.' };

  // If only end is provided, validate it against the current start time.
  if (!start && end) {
    if (isDateTimeTime(end)) {
      if (!('dateTime' in currentStart)) {
        return {
          ok: false,
          message: 'Cannot update a timed end time on an all-day event without specifying both start and end.',
        };
      }
      const startMs = Date.parse(currentStart.dateTime);
      const endMs = Date.parse(end.dateTime);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { ok: false, message: 'Invalid dateTime format.' };
      if (endMs <= startMs) return { ok: false, message: 'End time must be after the start time.' };
      return { ok: true, patch: draft };
    }

    if (isDateOnlyTime(end)) {
      if (!('date' in currentStart)) {
        return {
          ok: false,
          message: 'Cannot update an all-day end date on a timed event without specifying both start and end.',
        };
      }
      if (end.date <= currentStart.date) {
        return {
          ok: false,
          message: 'All-day events require an exclusive end date after the start date.',
        };
      }
      return { ok: true, patch: draft };
    }

    return { ok: false, message: 'Invalid event time format.' };
  }

  // If only start is provided, preserve the original duration by computing end.
  if (start && !end) {
    if (isDateTimeTime(start)) {
      if (!('dateTime' in currentStart) || !('dateTime' in currentEnd)) {
        return {
          ok: false,
          message: 'Cannot preserve duration when changing an all-day event to a timed event without specifying both start and end.',
        };
      }

      const currentStartMs = Date.parse(currentStart.dateTime);
      const currentEndMs = Date.parse(currentEnd.dateTime);
      if (Number.isNaN(currentStartMs) || Number.isNaN(currentEndMs)) {
        return { ok: false, message: 'Current event has invalid dateTime values.' };
      }

      const durationMs = currentEndMs - currentStartMs;
      if (durationMs <= 0) return { ok: false, message: 'Current event duration is invalid.' };

      const newStartMs = Date.parse(start.dateTime);
      if (Number.isNaN(newStartMs)) return { ok: false, message: 'Invalid dateTime format.' };

      const newEndDateTime = new Date(newStartMs + durationMs).toISOString();

      return {
        ok: true,
        patch: {
          ...draft,
          end: {
            dateTime: newEndDateTime,
            timeZone: start.timeZone,
          },
        },
      };
    }

    if (isDateOnlyTime(start)) {
      if (!('date' in currentStart) || !('date' in currentEnd)) {
        return {
          ok: false,
          message: 'Cannot preserve duration when changing a timed event to an all-day event without specifying both start and end.',
        };
      }

      const startDate = parseDateOnly(currentStart.date);
      const endDate = parseDateOnly(currentEnd.date);
      if (!startDate || !endDate) return { ok: false, message: 'Current event has invalid date-only values.' };

      const durationDays = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
      if (durationDays <= 0) return { ok: false, message: 'Current all-day event duration is invalid.' };

      let newEndDate: string;
      try {
        newEndDate = addDaysDateOnly(start.date, durationDays);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Invalid date-only format.' };
      }

      return {
        ok: true,
        patch: {
          ...draft,
          end: { date: newEndDate },
        },
      };
    }

    return { ok: false, message: 'Invalid event time format.' };
  }

  return { ok: false, message: 'Invalid event time format.' };
}

export function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function summarizeAttendees(
  attendees?: Array<{ email?: string | null }>,
): { count: number; domains: string[] } {
  const withEmail = attendees?.filter((a) => typeof a.email === 'string') ?? [];
  if (withEmail.length === 0) {
    return { count: 0, domains: [] };
  }

  const domains = Array.from(
    new Set(
      withEmail
        .map((attendee) => (attendee.email as string).split('@')[1])
        .filter((domain): domain is string => Boolean(domain)),
    ),
  );

  return {
    count: withEmail.length,
    domains,
  };
}

export function isCalendarScopeError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status !== 403) return false;

  const errors =
    (error as { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } })?.response?.data
      ?.error?.errors ?? [];
  return errors.some((item) =>
    ['insufficientPermissions', 'forbidden', 'insufficientScopes'].includes(item.reason ?? ''),
  );
}

/**
 * Formats conversation history for inclusion in the prompt.
 * Includes tool call metadata and timestamps to provide context about past actions and time gaps.
 */
export function formatConversationHistory(
  history: ConversationMessageDTO[],
  currentTime: Date,
  userTimezone: string,
): string {
  if (!history || history.length === 0) {
    return '(No prior messages in this conversation)';
  }

  return history
    .slice(-15) // Keep last 15 messages for context
    .map((msg, idx) => {
      const role = msg.role === 'USER' ? 'User' : 'Clira';
      const content = truncate(msg.content, 500);

      // Calculate time since this message
      const msgTime = new Date(msg.createdAt);
      const msAgo = currentTime.getTime() - msgTime.getTime();
      const relativeTime = formatRelativeTime(msAgo);

      // Format absolute time in user's timezone
      let absoluteTime = '';
      try {
        absoluteTime = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: userTimezone,
        }).format(msgTime);
      } catch {
        absoluteTime = msgTime.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
      }

      // Extract tool call context from metadata if available
      let toolContext = '';
      if (msg.role === 'ASSISTANT' && msg.metadata) {
        const toolCalls = extractToolCallsSummary(msg.metadata);
        if (toolCalls) {
          toolContext = `\n  └─ Tools used: ${toolCalls}`;
        }
      }

      return `[${idx + 1}] ${role} (${absoluteTime}, ${relativeTime}): ${content}${toolContext}`;
    })
    .join('\n\n');
}

/**
 * Generates a deterministic customId for memory deduplication.
 * Based on userId + normalized content to prevent duplicate memories.
 */
export function generateMemoryCustomId(
  userId: string,
  channel: ProgressUpdateChannel,
  content: string,
): string {
  const normalized = content
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200); // Limit to first 200 chars for hashing
  const hash = crypto
    .createHash('sha256')
    .update(`${userId}:${channel}:${normalized}`)
    .digest('hex')
    .slice(0, 16);
  return `${channel}-ea-${hash}`;
}

export function resolveProgressChannel(input: ExecutiveAgentInput): ProgressUpdateChannel {
  return input.progressContext?.channel ?? 'whatsapp';
}

export function resolveRetrievalProfile(
  channel: ProgressUpdateChannel,
): 'default' | 'messaging' {
  return channel === 'web' ? 'default' : 'messaging';
}

/**
 * Collects tool names from execution results for telemetry.
 */
export function collectToolNamesFromExecution({
  toolCalls,
  toolResults,
  steps,
}: {
  toolCalls: unknown;
  toolResults: unknown;
  steps: unknown;
}): Set<string> {
  const names = new Set<string>();

  const collectFromArray = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const candidate =
        (item as Record<string, unknown>).toolName ??
        (item as Record<string, unknown>).name ??
        (item as Record<string, unknown>).tool;
      if (typeof candidate === 'string' && candidate.length > 0) {
        names.add(candidate);
      }
    }
  };

  collectFromArray(toolCalls);
  collectFromArray(toolResults);

  if (Array.isArray(steps)) {
    for (const step of steps) {
      collectFromArray((step as Record<string, unknown>)?.toolCalls);
      collectFromArray((step as Record<string, unknown>)?.toolResults);
    }
  }

  return names;
}

/**
 * Creates a stop condition for terminal tool calls.
 */
export function stopWhenToolCalled(toolName: string) {
  return ({ steps }: { steps: unknown[] }) => {
    if (!Array.isArray(steps)) return false;
    for (const step of steps) {
      const calls = (step as Record<string, unknown>)?.toolCalls;
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        const name =
          (call as Record<string, unknown>)?.toolName ??
          (call as Record<string, unknown>)?.name;
        if (name === toolName) return true;
      }
    }
    return false;
  };
}

export function buildToolBudgetExceededResult(toolName: string, reason: string, counts: { total: number; tool: number }) {
  return {
    ok: false,
    error: 'tool_budget_exceeded',
    tool: toolName,
    reason,
    counts,
    hint: 'Answer with available context or ask a single clarifying question.',
  };
}

type AgentToolDefinition = {
  execute?: (args: unknown) => Promise<unknown>;
  [key: string]: unknown;
};

type ToolTimingMetadata = {
  elapsed_ms: number;
  ms_since_last_progress_update: number;
  time_left_ms: number | null;
};

export function didSendProgressUpdate(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  return (result as Record<string, unknown>).sent === true;
}

export function attachTimingMetadata(result: unknown, timing: ToolTimingMetadata): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      _timing: timing,
    };
  }

  return {
    result,
    _timing: timing,
  };
}

export function wrapToolsWithTimingMetadata({
  tools,
  agentStartedAt,
  timeLeftMs,
  getLastProgressSentAt,
  setLastProgressSentAt,
}: {
  tools: Record<string, unknown>;
  agentStartedAt: number;
  timeLeftMs: () => number | null;
  getLastProgressSentAt: () => number;
  setLastProgressSentAt: (sentAt: number) => void;
}): Record<string, unknown> {
  const wrappedTools: Record<string, unknown> = {};

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const tool = toolDefinition as AgentToolDefinition;
    if (!tool || typeof tool !== 'object' || typeof tool.execute !== 'function') {
      wrappedTools[toolName] = toolDefinition;
      continue;
    }

    const execute = tool.execute;
    wrappedTools[toolName] = {
      ...tool,
      execute: async (args: unknown) => {
        const result = await execute(args);
        const now = Date.now();

        if (toolName === 'send_progress_update') {
          if (didSendProgressUpdate(result)) {
            setLastProgressSentAt(now);
          }
          return result;
        }

        const lastProgressSentAt = getLastProgressSentAt();
        const timing: ToolTimingMetadata = {
          elapsed_ms: now - agentStartedAt,
          ms_since_last_progress_update: now - (lastProgressSentAt || agentStartedAt),
          time_left_ms: timeLeftMs(),
        };

        return attachTimingMetadata(result, timing);
      },
    };
  }

  return wrappedTools;
}

export function computeAdaptiveSubagentBudget(timeLeftMs: number, toolCallIndex: number) {
  const available = Math.max(0, timeLeftMs - MESSAGING_TOOL_RESPONSE_BUFFER_MS);
  if (toolCallIndex === 0) {
    const reserved = Math.max(0, available - MESSAGING_SUBSEQUENT_TOOL_RESERVE_MS);
    return Math.min(reserved, MESSAGING_FIRST_TOOL_MAX_BUDGET_MS);
  }
  return available;
}

export function computeSubagentBudget(timeLeftMs: number | null, toolCallIndex: number) {
  if (timeLeftMs === null) {
    return { budgetMs: null, tooLow: false };
  }

  const budgetMs = computeAdaptiveSubagentBudget(timeLeftMs, toolCallIndex);
  return { budgetMs, tooLow: budgetMs < MESSAGING_MIN_SUBAGENT_BUDGET_MS };
}

export async function runWithSubagentBudget<T>({
  toolName,
  counts,
  timeLeftMs,
  abortSignal,
  toolCallIndex,
  minBudgetMs,
  uncappedBudget,
  run,
}: {
  toolName: string;
  counts: { total: number; tool: number };
  timeLeftMs: number | null;
  abortSignal?: AbortSignal;
  toolCallIndex: number;
  /** Optional minimum budget for tools that need more time (e.g. plan_calendar_change). */
  minBudgetMs?: number;
  /** When true with minBudgetMs, use minBudgetMs as-is without capping by available time. */
  uncappedBudget?: boolean;
  run: (params: { abortSignal?: AbortSignal; deadlineAt?: number; budgetMs?: number }) => Promise<T>;
}): Promise<T | ReturnType<typeof buildToolBudgetExceededResult>> {
  let { budgetMs, tooLow } = computeSubagentBudget(timeLeftMs, toolCallIndex);
  if (typeof minBudgetMs === 'number' && budgetMs !== null && budgetMs < minBudgetMs) {
    if (uncappedBudget) {
      budgetMs = minBudgetMs;
    } else {
      const available = timeLeftMs !== null ? Math.max(0, timeLeftMs - MESSAGING_TOOL_RESPONSE_BUFFER_MS) : 0;
      budgetMs = Math.min(minBudgetMs, available);
    }
    tooLow = budgetMs < MESSAGING_MIN_SUBAGENT_BUDGET_MS;
  }

  if (tooLow) {
    logger.warn(
      `[executiveAgent] ${toolName} skipped: timeLeftMs=${timeLeftMs ?? 'n/a'} budgetMs=${budgetMs ?? 'n/a'} toolCallIndex=${toolCallIndex}`,
    );
    return buildToolBudgetExceededResult(
      toolName,
      `Insufficient time left (${timeLeftMs ?? 'n/a'}ms)`,
      counts,
    );
  }

  if (budgetMs === null) {
    return run({ abortSignal });
  }

  logger.info(
    `[executiveAgent] subagent budget tool=${toolName} timeLeftMs=${timeLeftMs} budgetMs=${budgetMs} toolCallIndex=${toolCallIndex} (buffer=${MESSAGING_TOOL_RESPONSE_BUFFER_MS})`,
  );

  const deadline = createDeadlineController({ abortSignal, deadlineMs: budgetMs });
  try {
    return await run({
      abortSignal: deadline.signal ?? abortSignal,
      deadlineAt: deadline.deadlineAt,
      budgetMs,
    });
  } finally {
    deadline.cleanup();
  }
}
