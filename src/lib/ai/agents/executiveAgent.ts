/**
 * Executive Agent (EA) for messaging channels
 *
 * A tool-using agent that processes messages from WhatsApp, Twilio SMS, and
 * in-app chat. Helps users draft, refine, and send emails through natural
 * conversation. The EA acts as a personal executive assistant with access
 * to email history, calendar, and user memory.
 *
 * Pattern: Uses callTextWithTools() for multi-step agent reasoning with tools.
 *
 * Tools (17):
 * 1. search_inbox_context - Retrieves ranked email evidence packs (quick/deep)
 * 2. search_memory - Searches user's personal memory graph
 * 3. check_calendar - Analyzes calendar availability
 * 4. search_calendar - Searches for specific events in the calendar
 * 5. append_to_supermemory - Stores user preferences/facts to memory
 * 6. add_email_alert - Creates an email alert that triggers messaging notifications
 * 7. remove_email_alert - Deletes an email alert by ID or description match
 * 8. list_email_alerts - Lists active email alerts
 * 9. add_reminder - Creates a time-based reminder
 * 10. list_reminders - Lists upcoming reminders
 * 11. snooze_reminder - Snoozes a reminder
 * 12. dismiss_reminder - Marks a reminder completed or dismissed
 * 13. cancel_reminder - Cancels a reminder
 * 14. plan_calendar_change - Proposes a calendar change (create/update/delete) with confirmation gating
 * 15. commit_calendar_change - Finalizes a proposed calendar change (confirm/cancel)
 * 16. send_email - Terminal tool: sends email immediately via Gmail (requires explicit user permission)
 * 17. send_progress_update - Sends short progress updates mid-run (channel-aware)
 */

import { z } from 'zod';
import crypto from 'crypto';
import { readPromptFile } from '@/lib/prompts';
import { callTextWithTools, createDeadlineController } from '@/lib/ai/callLlm';
import { LlmError } from '@/lib/ai/errors';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { CalendarService } from '@/lib/services/core/calendarService';
import { parseReminderTime } from '@/lib/utils/timeParser';
import {
  startOfDayInTimezone,
  endOfDayInTimezone,
  endOfTodayInTimezone,
  getDateOnlyInTimezone,
  addDaysToDateOnly,
  formatDateTimeInTimeZone,
  normalizeIsoDateInputToUtc,
} from '@/lib/utils/timezone';
import {
  type Prisma,
  ActionHistoryType,
  PendingCalendarChangeStatus,
} from '@prisma/client';
import {
  getCalendarSnapshot,
  getCalendarMutationSnapshot,
  gatherMemoryContextForReply,
  type CalendarMutationSnapshotResult,
} from '@/lib/services/core/replyContextTools';
import { runCalendarAnalysis } from '@/lib/ai/agents/calendarAnalysisSubagent';
import { runCalendarSearch } from '@/lib/ai/agents/calendarSearchSubagent';
import { runCalendarCreatorAgent, type AvailableCalendar } from '@/lib/ai/agents/calendarCreatorAgent';
import { runEmailRetrieval } from '@/lib/ai/agents/emailRetrievalSubagent';
import { extractToolCallsSummary } from '@/lib/ai/agents/executiveToolCallSummary';
import {
  type CalendarMutationTarget,
  buildMutationCandidates,
  createClarifyCalendarPlan,
  isCalendarTargetById,
  isCalendarTargetLookup,
  parsePendingCalendarChangeRecord,
  resolveMutationSearchRange,
} from '@/lib/ai/agents/executiveCalendarMutationHelpers';
import { getSupermemoryClient, isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import {
  createSendProgressUpdateTool,
  type ProgressUpdateContext,
} from '@/lib/ai/tools/sendProgressUpdate';
import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import { generateReauthUrl, REQUIRED_SCOPES } from '@/lib/auth/scope-utils';
import {
  type ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import {
  type CalendarCreatorPlanDTO,
  type CalendarEventDraftDTO,
  type CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveAgentInput {
  userId: string;
  userEmail: string;
  userRequest: string;
  conversationId: string;
  conversationHistory: ConversationMessageDTO[];
  abortSignal?: AbortSignal;
  progressContext?: ProgressUpdateContext;
}

export interface ExecutiveAgentOutput {
  response: string;
  memoryStored: boolean;
  status: 'ok' | 'fallback';
  error?: string;
  /** Tool call metadata for conversation history */
  metadata?: Prisma.InputJsonObject;
}

/** Deadline for the full agent run (WhatsApp, Twilio SMS, in-app chat). */
const MESSAGING_DEADLINE_MS = 120_000;
/** Reserve for executive to process tool result and produce reply. */
const MESSAGING_TOOL_RESPONSE_BUFFER_MS = 3_500;
/** Cap the first tool to keep time for follow-up tools. */
const MESSAGING_FIRST_TOOL_MAX_BUDGET_MS = 30_000;
/** Reserve time for subsequent tools after the first. */
const MESSAGING_SUBSEQUENT_TOOL_RESERVE_MS = 15_000;
/** Skip subagent if remaining budget would be below this. */
const MESSAGING_MIN_SUBAGENT_BUDGET_MS = 8_000;
/** plan_calendar_change can process many events; give it ample time. */
const PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS = 35_000;
/** search_calendar can have complex semantic search; give it ample time. */
const CALENDAR_SEARCH_MIN_BUDGET_MS = 35_000;
const MESSAGING_MAX_STEPS = 6; // A bit relaxed for worst case situations
const MESSAGING_MAX_TOOL_CALLS_TOTAL = 10;
const PENDING_CALENDAR_CHANGE_TTL_MS = 10 * 60 * 1000;

const MESSAGING_TOOL_BUDGETS_BASE: Record<string, number> = {
  search_inbox_context: 2,
  search_calendar: 2,
  check_calendar: 1,
  search_memory: 3,
  append_to_supermemory: 2,
  add_email_alert: 2,
  remove_email_alert: 2,
  list_email_alerts: 2,
  plan_calendar_change: 2,
  commit_calendar_change: 1,
  add_reminder: 2,
  list_reminders: 2,
  snooze_reminder: 2,
  dismiss_reminder: 2,
  cancel_reminder: 2,
  send_email: 1,
  send_progress_update: 3,
};

const MESSAGING_INBOX_CALL_LIMITS: Record<'quick' | 'deep', number> = {
  quick: 2,
  deep: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function truncate(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

/**
 * Formats a relative time string (e.g., "2 hours ago", "yesterday", "3 days ago").
 */
function formatRelativeTime(msAgo: number): string {
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

type PendingCalendarChangeRecord = {
  id: string;
  plan: Prisma.JsonValue;
  resolvedTarget: Prisma.JsonValue | null;
  userTimezone: string;
  userRequest: string;
  expiresAt: Date;
  status: PendingCalendarChangeStatus;
  createdAt: Date;
};

function extractLatestToolResult(toolResults: unknown, toolName: string): Record<string, unknown> | null {
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

function buildTerminalFallbackResponse(toolResults: unknown): string {
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

function isDateTimeTime(value: CalendarEventDraftDTO['start']): value is { dateTime: string; timeZone: string } {
  return Boolean(value && 'dateTime' in value);
}

function isDateOnlyTime(value: CalendarEventDraftDTO['start']): value is { date: string } {
  return Boolean(value && 'date' in value);
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateEventDraftTimes(
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

type GoogleEventTime = {
  dateTime?: string | null;
  date?: string | null;
  timeZone?: string | null;
};

function addDaysDateOnly(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date) throw new Error('Invalid date-only format. Use YYYY-MM-DD.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveGoogleEventTime(value: GoogleEventTime | null | undefined): { dateTime: string } | { date: string } | null {
  if (!value) return null;
  if (typeof value.dateTime === 'string' && value.dateTime.trim()) return { dateTime: value.dateTime };
  if (typeof value.date === 'string' && value.date.trim()) return { date: value.date };
  return null;
}

function normalizeUpdateDraftTimesForPatch({
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

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function summarizeAttendees(
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

function isCalendarScopeError(error: unknown): boolean {
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
function formatConversationHistory(
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
function generateMemoryCustomId(
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

function resolveProgressChannel(input: ExecutiveAgentInput): ProgressUpdateChannel {
  return input.progressContext?.channel ?? 'whatsapp';
}

function resolveRetrievalProfile(
  channel: ProgressUpdateChannel,
): 'default' | 'messaging' {
  return channel === 'web' ? 'default' : 'messaging';
}

/**
 * Collects tool names from execution results for telemetry.
 */
function collectToolNamesFromExecution({
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
function stopWhenToolCalled(toolName: string) {
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

function buildToolBudgetExceededResult(toolName: string, reason: string, counts: { total: number; tool: number }) {
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

function didSendProgressUpdate(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  return (result as Record<string, unknown>).sent === true;
}

function attachTimingMetadata(result: unknown, timing: ToolTimingMetadata): Record<string, unknown> {
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

function wrapToolsWithTimingMetadata({
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

function computeAdaptiveSubagentBudget(timeLeftMs: number, toolCallIndex: number) {
  const available = Math.max(0, timeLeftMs - MESSAGING_TOOL_RESPONSE_BUFFER_MS);
  if (toolCallIndex === 0) {
    const reserved = Math.max(0, available - MESSAGING_SUBSEQUENT_TOOL_RESERVE_MS);
    return Math.min(reserved, MESSAGING_FIRST_TOOL_MAX_BUDGET_MS);
  }
  return available;
}

function computeSubagentBudget(timeLeftMs: number | null, toolCallIndex: number) {
  if (timeLeftMs === null) {
    return { budgetMs: null, tooLow: false };
  }

  const budgetMs = computeAdaptiveSubagentBudget(timeLeftMs, toolCallIndex);
  return { budgetMs, tooLow: budgetMs < MESSAGING_MIN_SUBAGENT_BUDGET_MS };
}

async function runWithSubagentBudget<T>({
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

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Builder
// ─────────────────────────────────────────────────────────────────────────────

interface PromptContext {
  prompt: string;
  userTimezone: string;
  currentTimeUtc: string;
  currentTimeUserTz: string;
  dayOfWeek: string;
  currentDateUserTzDateOnly: string;
}

type SearchInboxContextArgs = {
  mode?: 'quick' | 'deep';
  intent: string;
  constraints?: {
    sender?: string;
    recipient?: string;
    keywords?: string[];
    subject?: string;
    timeWindow?: 'recent' | 'last_month' | 'last_year' | 'all_time';
    startDate?: string;
    endDate?: string;
    hasAttachment?: boolean;
  };
};

async function buildExecutiveAgentPrompt(
  input: ExecutiveAgentInput,
  channel: ProgressUpdateChannel,
): Promise<PromptContext> {
  const template = readPromptFile('whatsapp/executiveAgentPrompt.md');

  // Fetch user settings for timezone
  const userSettings = await prisma.userSettings.findUnique({
    where: { userId: input.userId },
    select: { calendarTimezone: true },
  });

  const userTimezone = userSettings?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE;
  const now = new Date();
  const currentTimeUtc = now.toISOString();
  let currentDateUserTzDateOnly = currentTimeUtc.split('T')[0]!;

  let currentTimeUserTz = currentTimeUtc;
  let dayOfWeek = '';

  try {
    currentDateUserTzDateOnly = getDateOnlyInTimezone(now, userTimezone);
    currentTimeUserTz = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: userTimezone,
    }).format(now);

    dayOfWeek = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: userTimezone,
    }).format(now);
  } catch {
    dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  }

  // Fetch memory context: include user request so recall questions get relevant memories (e.g. "stat prof name")
  let memoryContext = '(No memories stored yet)';
  if (isSupermemoryConfigured()) {
    try {
      const requestSnippet = truncate(input.userRequest.trim(), 80);
      const memoryQuery =
        requestSnippet.length > 0
          ? `${requestSnippet} user preferences facts contacts names roles`
          : 'user preferences communication style facts contacts';
      const memories = await gatherMemoryContextForReply({
        userId: input.userId,
        query: memoryQuery,
        limit: 6,
        threshold: 0.3,
      });
      if (memories.length > 0) {
        memoryContext = memories
          .map((m) => `- ${truncate(m.content, 200)}`)
          .join('\n');
      }
    } catch (error) {
      logger.debug('[executiveAgent] Failed to fetch memory context:', error);
    }
  }

  // Calculate time since last message (if any)
  let timeSinceLastMessage = '';
  if (input.conversationHistory && input.conversationHistory.length > 0) {
    const lastMessage = input.conversationHistory[input.conversationHistory.length - 1];
    const lastMsgTime = new Date(lastMessage.createdAt);
    const msSinceLastMsg = now.getTime() - lastMsgTime.getTime();
    timeSinceLastMessage = formatRelativeTime(msSinceLastMsg);
  } else {
    timeSinceLastMessage = 'This is the first message in this conversation.';
  }

  const prompt = template
    .replace('{currentTimeUtc}', currentTimeUtc)
    .replace('{userTimezone}', userTimezone)
    .replace('{currentTimeUserTz}', currentTimeUserTz)
    .replace('{dayOfWeek}', dayOfWeek)
    .replace('{currentDateUserTzDateOnly}', currentDateUserTzDateOnly)
    .replace('{timeSinceLastMessage}', timeSinceLastMessage)
    .replace('{userEmail}', input.userEmail)
    .replace('{userRequest}', input.userRequest)
    .replace('{messagingChannel}', channel)
    .replace('{conversationHistory}', formatConversationHistory(input.conversationHistory, now, userTimezone))
    .replace('{memoryContext}', memoryContext);

  return {
    prompt,
    userTimezone,
    currentTimeUtc,
    currentTimeUserTz,
    dayOfWeek,
    currentDateUserTzDateOnly,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Executive Agent Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executive Agent (EA) for messaging conversations.
 *
 * Handles natural language requests to draft, refine, and send emails.
 * Uses tool calling to access email history, calendar, and memory.
 */
export class ExecutiveAgent {
  private memoryStored = false;

  /**
   * Processes a user's message and returns a response.
   */
  async process(input: ExecutiveAgentInput): Promise<ExecutiveAgentOutput> {
    this.memoryStored = false;
    const resolvedChannel = resolveProgressChannel(input);
    const retrievalProfile = resolveRetrievalProfile(resolvedChannel);

    const promptContext = await buildExecutiveAgentPrompt(input, resolvedChannel);
    const { prompt, userTimezone, currentTimeUtc, currentTimeUserTz, dayOfWeek } = promptContext;
    const pendingRecordForPrompt = await prisma.pendingCalendarChange.findFirst({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        status: PendingCalendarChangeStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        plan: true,
        resolvedTarget: true,
        userTimezone: true,
        userRequest: true,
        expiresAt: true,
        status: true,
        createdAt: true,
      },
    });
    const pendingPayloadForPrompt = pendingRecordForPrompt
      ? parsePendingCalendarChangeRecord(pendingRecordForPrompt as PendingCalendarChangeRecord)
      : null;
    const pendingCalendarInstruction = pendingRecordForPrompt && pendingPayloadForPrompt
      ? `Active pending calendar change exists (pendingId=${pendingRecordForPrompt.id}, action=${pendingPayloadForPrompt.plan.action}, expiresAt=${pendingRecordForPrompt.expiresAt.toISOString()}).`
      : 'No active pending calendar change exists.';

    const toolAbort = createDeadlineController({
      abortSignal: input.abortSignal,
      deadlineMs: MESSAGING_DEADLINE_MS,
    });
    const toolAbortSignal = toolAbort.signal ?? input.abortSignal;

    // ═══════════════════════════════════════════════════════════════════════════
    // Tool Definitions
    // ═══════════════════════════════════════════════════════════════════════════

    const inboxCallTracker = {
      quickCalls: 0,
      deepCalls: 0,
    };
    let subagentCallIndex = 0;

    const reminderRecurrenceSchema = z.object({
      type: z.enum(['daily', 'weekly', 'monthly']),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
      dayOfMonth: z.number().int().min(1).max(31).optional(),
      until: z.string().optional(),
    });
    const reminderClosedStatuses = new Set(['DISMISSED', 'COMPLETED', 'MISSED', 'CANCELLED']);
    const reminderNonCancelableStatuses = new Set(['DELIVERED', 'DISMISSED', 'COMPLETED', 'MISSED', 'CANCELLED']);

    const tools: Record<string, unknown> = {
      // ─────────────────────────────────────────────────────────────────────────
      // Tool 1: Search Inbox Context
      // ─────────────────────────────────────────────────────────────────────────
      search_inbox_context: {
        description:
          'Search the user inbox and return a compact evidence pack with ranked matches, quotes, and coverage. ' +
          'Use deep for analytical, quantitative, or aggregative questions (totals, counts, sums, patterns, temporal summaries, or any question requiring data from many emails)—deep returns broader coverage for accurate calculation. Use quick for simple lookup (one email, recent thread, contact). Also use deep for exact wording, attachments, or when quick results are weak. This tool does not dump raw emails. You may perform any analysis over the evidence (aggregations, calculations, inference) and report clearly.',
        inputSchema: z
          .object({
            mode: z.enum(['quick', 'deep']).optional().describe('Use "deep" for analytical/aggregative questions or broad coverage; "quick" for simple lookup. Default: quick.'),
            intent: z
              .string()
              .min(1)
              .max(500)
              .describe('Natural language description of the email to find'),
            constraints: z
              .object({
                sender: z.string().optional().describe('Sender email or name'),
                recipient: z.string().optional().describe('Recipient email or name'),
                keywords: z.array(z.string()).max(8).optional().describe('Keywords or phrases'),
                subject: z.string().optional().describe('Subject hint or fragment'),
                timeWindow: z
                  .enum(['recent', 'last_month', 'last_year', 'all_time'])
                  .optional()
                  .describe('Time window hint'),
                startDate: z.string().optional().describe('ISO start date'),
                endDate: z.string().optional().describe('ISO end date'),
                hasAttachment: z.boolean().optional().describe('Require attachments'),
              })
              .optional(),
          }),
        execute: async (args: SearchInboxContextArgs) => {
          const mode = args.mode ?? 'quick';
          const intent = args.intent?.trim() || input.userRequest;
          const totalCalls = inboxCallTracker.quickCalls + inboxCallTracker.deepCalls;
          const modeCalls = mode === 'deep' ? inboxCallTracker.deepCalls : inboxCallTracker.quickCalls;
          const modeLimit = MESSAGING_INBOX_CALL_LIMITS[mode];

          if (modeCalls >= modeLimit) {
            logger.warn(
              `[executiveAgent] search_inbox_context budget exceeded: mode=${mode} calls=${modeCalls} limit=${modeLimit}`,
            );
            return buildToolBudgetExceededResult(
              'search_inbox_context',
              `Max ${mode} inbox searches reached.`,
              { total: totalCalls, tool: modeCalls },
            );
          }

          if (mode === 'deep') {
            inboxCallTracker.deepCalls += 1;
          } else {
            inboxCallTracker.quickCalls += 1;
          }

          logger.info(
            `[executiveAgent] search_inbox_context: mode=${mode} intent="${truncate(intent, 80)}"`,
          );

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          return runWithSubagentBudget({
            toolName: 'search_inbox_context',
            counts: { total: totalCalls, tool: modeCalls },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            run: (budgetContext) =>
              runEmailRetrieval(
                {
                  intent,
                  mode,
                  constraints: args.constraints,
                  profile: retrievalProfile,
                },
                {
                  userId: input.userId,
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 2: Search Memory
      // ─────────────────────────────────────────────────────────────────────────
      search_memory: {
        description:
          'Search the user\'s personal memory for relevant context. ' +
          'Memories include: names and roles (professors, managers, contacts), preferences, facts, communication style. ' +
          'Use this when: the user asks a RECALL question (e.g. "what\'s my stat prof\'s name?", "who\'s my manager?", "what did I tell you about X?"). ' +
          'Call search_memory first; only say you don\'t know if the search returns nothing.',
        inputSchema: z.object({
          query: z.string().min(1).max(200).describe('Natural language search query'),
          limit: z.number().int().min(1).max(10).optional().describe('Max memories to return (default: 5)'),
        }),
        execute: async (args: { query: string; limit?: number }) => {
          logger.info(`[executiveAgent] search_memory: "${truncate(args.query, 50)}"`);

          if (!isSupermemoryConfigured()) {
            return { query: args.query, count: 0, memories: [], note: 'Memory system not configured' };
          }

          const memories = await gatherMemoryContextForReply({
            userId: input.userId,
            query: args.query,
            limit: args.limit ?? 5,
            threshold: 0.4,
          });

          return {
            query: args.query,
            count: memories.length,
            memories: memories.map((m) => ({
              content: truncate(m.content, 400),
              relevanceScore: m.score,
            })),
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 3: Check Calendar
      // ─────────────────────────────────────────────────────────────────────────
      check_calendar: {
        description:
          'Analyze calendar availability for scheduling. Returns free slots, conflicts, and recommendations. ' +
          'Use this when: user wants to schedule a meeting, needs availability, or email involves dates/times. ' +
          'IMPORTANT: Dates are interpreted in the USER\'S timezone. Prefer date-only strings ("YYYY-MM-DD") for day-based queries.',
        inputSchema: z.object({
          startDate: z
            .string()
            .describe('Start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          endDate: z
            .string()
            .describe('End date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          durationNeeded: z.string().optional().describe('Meeting duration (e.g., "30 minutes", "1 hour")'),
          preferences: z.string().optional().describe('Scheduling preferences (e.g., "prefer mornings")'),
        }),
        execute: async (args: {
          startDate: string;
          endDate: string;
          durationNeeded?: string;
          preferences?: string;
        }) => {
          logger.info(`[executiveAgent] check_calendar: ${args.startDate} to ${args.endDate}`);
          let normalizedStartDate: Date;
          let normalizedEndDate: Date;
          try {
            normalizedStartDate = normalizeIsoDateInputToUtc(args.startDate, userTimezone, 'start');
            normalizedEndDate = normalizeIsoDateInputToUtc(args.endDate, userTimezone, 'end');
          } catch {
            return {
              freeSlots: [],
              conflicts: [],
              recommendation: 'Invalid date format. Use ISO format like "2026-01-20".',
            };
          }

          if (normalizedStartDate > normalizedEndDate) {
            return {
              freeSlots: [],
              conflicts: [],
              recommendation:
                'End date must be on or after start date. Please use a valid range (e.g. start "2026-01-20", end "2026-01-25").',
            };
          }

          const calendarSnapshot = await getCalendarSnapshot({
            userId: input.userId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          });

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          return runWithSubagentBudget({
            toolName: 'check_calendar',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            run: (budgetContext) =>
              runCalendarAnalysis(
                {
                  startDate: args.startDate,
                  endDate: args.endDate,
                  durationNeeded: args.durationNeeded,
                  preferences: args.preferences,
                },
                {
                  calendarSnapshot,
                  emailContext: {
                    subject: 'WhatsApp scheduling request',
                    fromEmail: input.userEmail,
                    bodySnippet: truncate(input.userRequest, 200),
                  },
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone: userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek: dayOfWeek,
                  },
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 4: Search Calendar
      // ─────────────────────────────────────────────────────────────────────────
      search_calendar: {
        description:
          'Search for specific events in the user\'s calendar using natural language queries. ' +
          'Returns semantically relevant events with ranking and insights. ' +
          'Use this when: user asks to find specific meetings/events, wants to recall past events, ' +
          'needs to check if a particular meeting happened, or wants to find events with specific people or topics. ' +
          'IMPORTANT: Dates are interpreted in the USER\'S timezone. Prefer date-only strings ("YYYY-MM-DD") for full-day ranges. ' +
          'Examples: "events today" -> startDate="YYYY-MM-DD", endDate="YYYY-MM-DD" (user-local). ' +
          'Other examples: "find my meetings with John last week", "show me all-day events in January", "when did I last meet with the team?"',
        inputSchema: z.object({
          query: z.string().min(1).max(500).describe('Natural language search query describing what events to find'),
          startDate: z
            .string()
            .optional()
            .describe('Start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          endDate: z
            .string()
            .optional()
            .describe('End date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          maxResults: z.number().int().min(1).max(50).optional().describe('Maximum number of matching events to return (default: 10)'),
          minRelevance: z.number().min(0).max(100).optional().describe('Minimum relevance score (0-100) for results (default: 40)'),
        }),
        execute: async (args: {
          query: string;
          startDate?: string;
          endDate?: string;
          maxResults?: number;
          minRelevance?: number;
        }) => {
          logger.info(`[executiveAgent] search_calendar: "${truncate(args.query, 50)}"`);

          // Default date range: 30 days ago to today (in user's timezone)
          const now = new Date();
          const userToday = getDateOnlyInTimezone(now, userTimezone);

          // Compute normalized start date
          let normalizedStartDate: Date;
          if (args.startDate) {
            try {
              normalizedStartDate = normalizeIsoDateInputToUtc(args.startDate, userTimezone, 'start');
            } catch {
              return {
                events: [],
                summary: 'Invalid start date format. Use ISO format like "2026-01-20".',
                reasoning: 'Date parsing failed',
                meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
              };
            }
          } else {
            // Default: 30 days ago at start of day in user's timezone
            const thirtyDaysAgo = addDaysToDateOnly(userToday, -30);
            normalizedStartDate = startOfDayInTimezone(thirtyDaysAgo, userTimezone);
          }

          // Compute normalized end date
          let normalizedEndDate: Date;
          if (args.endDate) {
            try {
              normalizedEndDate = normalizeIsoDateInputToUtc(args.endDate, userTimezone, 'end');
            } catch {
              return {
                events: [],
                summary: 'Invalid end date format. Use ISO format like "2026-01-20".',
                reasoning: 'Date parsing failed',
                meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
              };
            }
          } else {
            // Default: end of today in user's timezone
            const endOfToday = endOfTodayInTimezone(now, userTimezone);
            if (args.startDate && normalizedStartDate > endOfToday) {
              // startDate is in the future — "end of today" would create an invalid range (start > end).
              // Default to end of startDate's day so we search that full day.
              const startDateOnly = getDateOnlyInTimezone(normalizedStartDate, userTimezone);
              normalizedEndDate = endOfDayInTimezone(startDateOnly, userTimezone);
            } else {
              normalizedEndDate = endOfToday;
            }
          }

          if (normalizedStartDate > normalizedEndDate) {
            return {
              events: [],
              summary: 'Invalid date range: end date must be on or after start date.',
              reasoning: 'Date range validation failed',
              meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
            };
          }

          const calendarSnapshot = await getCalendarSnapshot({
            userId: input.userId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          });

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          return runWithSubagentBudget({
            toolName: 'search_calendar',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            minBudgetMs: CALENDAR_SEARCH_MIN_BUDGET_MS,
            uncappedBudget: true,
            run: (budgetContext) =>
              runCalendarSearch(
                {
                  query: args.query,
                  startDate: args.startDate,
                  endDate: args.endDate,
                  maxResults: args.maxResults,
                  minRelevance: args.minRelevance,
                },
                {
                  calendarSnapshot,
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone: userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek: dayOfWeek,
                  },
                  userContext: {
                    userEmail: input.userEmail,
                    requestContext: truncate(input.userRequest, 500),
                  },
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 5: Plan Calendar Change
      // ─────────────────────────────────────────────────────────────────────────
      plan_calendar_change: {
        description:
          'Plan a calendar change (create/update/delete) with a confirmation-required preview. ' +
          'Always return a user-facing preview and a pending change for explicit confirmation. ' +
          'Use for calendar mutations only; never execute changes directly. ' +
          'When the plan moves or reschedules specific events: call search_calendar exactly once with one combined query (all event names) and one date range, then pass the returned events as resolvedEvents. Do not call search_calendar multiple times for the same plan. Required for performance.',
        inputSchema: z.object({
          request: z.string().min(1).max(1000).describe('User request describing the calendar change'),
          startDate: z
            .string()
            .optional()
            .describe('Optional start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local).'),
          endDate: z
            .string()
            .optional()
            .describe('Optional end date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local).'),
          forceNewPlan: z
            .boolean()
            .optional()
            .describe(
              'Set true ONLY when the user explicitly asks to modify an existing pending plan. If omitted/false and a pending change exists, the tool will return the existing pending change instead of creating a new one.',
            ),
          resolvedEvents: z
            .array(
              z.object({
                eventId: z.string(),
                calendarId: z.string(),
                name: z.string(),
                start: z.string(),
                end: z.string(),
              }),
            )
            .optional()
            .describe(
              'Events from a prior search_calendar call. When available, pass these so the planner can use eventId directly instead of lookupQuery.',
            ),
        }),
        execute: async (args: {
          request: string;
          startDate?: string;
          endDate?: string;
          forceNewPlan?: boolean;
          resolvedEvents?: Array<{ eventId: string; calendarId: string; name: string; start: string; end: string }>;
        }) => {
          const request = args.request?.trim() || input.userRequest;
          logger.info(`[executiveAgent] plan_calendar_change: "${truncate(request, 80)}"`);

          const existingPending = await prisma.pendingCalendarChange.findFirst({
            where: {
              userId: input.userId,
              conversationId: input.conversationId,
              status: { in: [PendingCalendarChangeStatus.PENDING, PendingCalendarChangeStatus.IN_PROGRESS] },
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              plan: true,
              resolvedTarget: true,
              userTimezone: true,
              userRequest: true,
              expiresAt: true,
              status: true,
              createdAt: true,
            },
          });

          if (existingPending && !args.forceNewPlan) {
            const pendingPayload = parsePendingCalendarChangeRecord(existingPending as PendingCalendarChangeRecord);
            if (!pendingPayload) {
              return {
                ok: false,
                error: 'invalid_pending_change',
                message:
                  'I found an existing pending calendar change, but it looks corrupted. Please ask me to plan it again.',
              };
            }

            const existingPlan = pendingPayload.plan;
            const previewText =
              existingPlan?.userPreviewText ??
              'I already have a pending calendar change. Reply "yes" to confirm or "no" to cancel.';

            return {
              ok: true,
              plan: existingPlan,
              previewText,
              pendingChange: {
                pendingId: existingPending.id,
                createdAt: existingPending.createdAt.toISOString(),
                expiresAt: existingPending.expiresAt.toISOString(),
                action: existingPlan?.action,
              },
              note:
                'Pending calendar change already exists. Confirm/cancel it, or explicitly ask to modify the plan.',
            };
          }

          // Fetch writable calendars so the subagent can pick the right one
          let availableCalendars: AvailableCalendar[] | undefined;
          try {
            const calService = await CalendarService.create({
              userId: input.userId,
              purpose: `${resolvedChannel}:calendar-list`,
              requester: 'executiveAgent.plan_calendar_change',
            });
            if (calService) {
              const calendars = await calService.listCalendars({ minAccessRole: 'writer' });
              availableCalendars = calendars.map((cal) => ({
                id: cal.id,
                summary: cal.summary,
                primary: cal.primary,
                accessRole: cal.accessRole,
              }));
            }
          } catch (error) {
            logger.warn('[executiveAgent] Failed to fetch calendar list for plan, falling back to primary', error);
          }

          const toolCallIndex = subagentCallIndex;
          subagentCallIndex += 1;

          const planResult = await runWithSubagentBudget({
            toolName: 'plan_calendar_change',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            minBudgetMs: PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS,
            uncappedBudget: true,
            run: (budgetContext) =>
              runCalendarCreatorAgent(
                { request },
                {
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek,
                  },
                  availableCalendars,
                  resolvedEvents: args.resolvedEvents,
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });

          if ((planResult as { ok?: boolean })?.ok === false) {
            return planResult;
          }

          const plan = planResult as CalendarCreatorPlanDTO;

          if (plan.action === 'clarify') {
            return {
              ok: true,
              plan,
              previewText: plan.userPreviewText,
            };
          }

          let resolvedTarget: CalendarMutationTarget | undefined;
          let resolvedTargets: CalendarMutationTarget[] | undefined;
          let resolvedPlan: CalendarCreatorPlanDTO = plan;

          type LookupResolvedRange = {
            startDate: Date;
            endDate: Date;
          };

          type LookupTargetResolution = {
            index: number;
            target: Extract<CalendarTargetDTO, { lookupQuery: string }>;
            range: LookupResolvedRange;
          };

          const buildOverlappingLookupGroups = (
            lookupTargets: LookupTargetResolution[],
          ): Array<{
            startDate: Date;
            endDate: Date;
            items: LookupTargetResolution[];
          }> => {
            if (lookupTargets.length === 0) return [];

            const sorted = [...lookupTargets].sort(
              (a, b) => a.range.startDate.getTime() - b.range.startDate.getTime(),
            );

            const groups: Array<{
              startDate: Date;
              endDate: Date;
              items: LookupTargetResolution[];
            }> = [];

            for (const item of sorted) {
              const lastGroup = groups[groups.length - 1];
              if (!lastGroup || item.range.startDate.getTime() > lastGroup.endDate.getTime()) {
                groups.push({
                  startDate: item.range.startDate,
                  endDate: item.range.endDate,
                  items: [item],
                });
                continue;
              }

              lastGroup.items.push(item);
              if (item.range.endDate.getTime() > lastGroup.endDate.getTime()) {
                lastGroup.endDate = item.range.endDate;
              }
            }

            return groups;
          };

          const resolveLookupTarget = async (
            target: Extract<CalendarTargetDTO, { lookupQuery: string }>,
            batchIndex?: number,
            options?: {
              resolvedRange?: LookupResolvedRange;
              mutationSnapshot?: CalendarMutationSnapshotResult;
            },
          ):
            Promise<
              | {
                  kind: 'resolved';
                  target: CalendarMutationTarget;
                  planTarget: { calendarId: string; eventId: string };
                }
              | { kind: 'clarify'; plan: CalendarCreatorPlanDTO; previewText: string }
              | { kind: 'error'; error: string; message: string }
            > => {
              const itemSuffix = batchIndex !== undefined ? ` for item ${batchIndex + 1}` : '';
              let resolvedRange = options?.resolvedRange;
              if (!resolvedRange) {
                const rangeResult = resolveMutationSearchRange({
                  startDate: target.lookupRange?.startDate ?? args.startDate,
                  endDate: target.lookupRange?.endDate ?? args.endDate,
                  userTimezone,
                });

                if ('error' in rangeResult) {
                  const clarifyPlan = createClarifyCalendarPlan(
                    plan,
                    [`Which dates should I search${itemSuffix}?`],
                    `I need a clearer date range to find that event${itemSuffix}. ${rangeResult.error}`,
                  );

                  return {
                    kind: 'clarify',
                    plan: clarifyPlan,
                    previewText: clarifyPlan.userPreviewText,
                  };
                }

                resolvedRange = rangeResult;
              }

              const mutationSnapshot =
                options?.mutationSnapshot ??
                (await getCalendarMutationSnapshot({
                  userId: input.userId,
                  startDate: resolvedRange.startDate,
                  endDate: resolvedRange.endDate,
                }));

              if (!mutationSnapshot.success) {
                return {
                  kind: 'error',
                  error: 'calendar_unavailable',
                  message: mutationSnapshot.error || 'Calendar access unavailable.',
                };
              }

              const searchSnapshot = {
                success: mutationSnapshot.success,
                timezone: mutationSnapshot.timezone,
                dateRange: mutationSnapshot.dateRange,
                dateRangeUtc: mutationSnapshot.dateRangeUtc,
                events: mutationSnapshot.events.map((event) => ({
                  eventId: event.eventId,
                  calendarId: event.calendarId,
                  name: event.name,
                  start: event.start,
                  end: event.end,
                  isAllDay: event.isAllDay,
                  description: event.description,
                  location: event.location,
                  attendees: event.attendees,
                })),
                error: mutationSnapshot.error,
              };

              const searchResult = await runCalendarSearch(
                {
                  query: target.lookupQuery,
                  startDate: target.lookupRange?.startDate ?? args.startDate,
                  endDate: target.lookupRange?.endDate ?? args.endDate,
                  maxResults: 10,
                  minRelevance: 40,
                },
                {
                  calendarSnapshot: searchSnapshot,
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek,
                  },
                  userContext: {
                    userEmail: input.userEmail,
                    requestContext: truncate(input.userRequest, 500),
                  },
                  abortSignal: toolAbortSignal,
                  deadlineAt: toolAbort.deadlineAt,
                },
              );

              const highConfidenceMatches = searchResult.events.filter(
                (event) => event.relevanceScore >= 60,
              );
              const matchesToUse =
                highConfidenceMatches.length > 0 ? highConfidenceMatches : searchResult.events;

              const candidates = buildMutationCandidates(matchesToUse, mutationSnapshot.events);
              const uniqueCandidates = Array.from(
                new Map(candidates.map((candidate) => [candidate.eventId, candidate])).values(),
              );

              if (uniqueCandidates.length === 0) {
                const clarifyPlan = createClarifyCalendarPlan(
                  plan,
                  [`Which event should I change${itemSuffix}?`],
                  `I couldn’t find a matching event${itemSuffix}. Which event should I update or delete?`,
                );

                return {
                  kind: 'clarify',
                  plan: clarifyPlan,
                  previewText: clarifyPlan.userPreviewText,
                };
              }

              if (uniqueCandidates.length > 1) {
                const lines = uniqueCandidates.slice(0, 5).map((candidate, index) => {
                  const dayNote = candidate.isAllDay ? ' (all day)' : '';
                  return `${index + 1}) ${candidate.summary} — ${candidate.start}${dayNote}`;
                });
                const question = `Which event should I ${plan.action}${itemSuffix}? Reply with the number.`;
                const previewText = `I found multiple matches. ${question}\n${lines.join('\n')}`;

                const clarifyPlan = createClarifyCalendarPlan(plan, [question], previewText);

                return {
                  kind: 'clarify',
                  plan: clarifyPlan,
                  previewText,
                };
              }

              const match = uniqueCandidates[0];
              return {
                kind: 'resolved',
                target: {
                  calendarId: match.calendarId,
                  eventId: match.eventId,
                  etag: match.etag,
                },
                planTarget: {
                  calendarId: match.calendarId,
                  eventId: match.eventId,
                },
              };
          };

          if (plan.action === 'update' || plan.action === 'delete') {
            if (plan.targets?.length) {
              const batchResolvedTargets: CalendarMutationTarget[] = [];
              const batchPlanTargets: Array<{ calendarId: string; eventId: string }> = [];
              const lookupTargets: LookupTargetResolution[] = [];

              for (const [index, target] of plan.targets.entries()) {
                if (isCalendarTargetById(target)) {
                  continue;
                }

                if (isCalendarTargetLookup(target)) {
                  const rangeResult = resolveMutationSearchRange({
                    startDate: target.lookupRange?.startDate ?? args.startDate,
                    endDate: target.lookupRange?.endDate ?? args.endDate,
                    userTimezone,
                  });

                  if ('error' in rangeResult) {
                    const itemSuffix = ` for item ${index + 1}`;
                    const clarifyPlan = createClarifyCalendarPlan(
                      plan,
                      [`Which dates should I search${itemSuffix}?`],
                      `I need a clearer date range to find that event${itemSuffix}. ${rangeResult.error}`,
                    );

                    return {
                      ok: true,
                      plan: clarifyPlan,
                      previewText: clarifyPlan.userPreviewText,
                    };
                  }

                  lookupTargets.push({
                    index,
                    target,
                    range: rangeResult,
                  });
                }
              }

              const lookupSnapshotsByIndex = new Map<number, CalendarMutationSnapshotResult>();
              if (lookupTargets.length > 0) {
                const lookupGroups = buildOverlappingLookupGroups(lookupTargets);
                const groupSnapshots = await Promise.all(
                  lookupGroups.map(async (group) => ({
                    group,
                    mutationSnapshot: await getCalendarMutationSnapshot({
                      userId: input.userId,
                      startDate: group.startDate,
                      endDate: group.endDate,
                    }),
                  })),
                );

                for (const { group, mutationSnapshot } of groupSnapshots) {
                  if (!mutationSnapshot.success) {
                    return {
                      ok: false,
                      error: 'calendar_unavailable',
                      message: mutationSnapshot.error || 'Calendar access unavailable.',
                    };
                  }

                  for (const item of group.items) {
                    lookupSnapshotsByIndex.set(item.index, mutationSnapshot);
                  }
                }
              }

              const lookupRangeByIndex = new Map<number, LookupResolvedRange>(
                lookupTargets.map((item) => [item.index, item.range]),
              );
              const lookupTargetByIndex = new Map<number, LookupTargetResolution>(
                lookupTargets.map((item) => [item.index, item]),
              );

              const lookupResolutions = await Promise.all(
                lookupTargets.map(async (item) => {
                  const lookupResolution = await resolveLookupTarget(item.target, item.index, {
                    resolvedRange: item.range,
                    mutationSnapshot: lookupSnapshotsByIndex.get(item.index),
                  });
                  return { index: item.index, lookupResolution };
                }),
              );

              const firstLookupFailure = lookupResolutions
                .filter(({ lookupResolution }) => lookupResolution.kind !== 'resolved')
                .sort((a, b) => a.index - b.index)[0];

              if (firstLookupFailure) {
                const { lookupResolution } = firstLookupFailure;
                if (lookupResolution.kind === 'error') {
                  return {
                    ok: false,
                    error: lookupResolution.error,
                    message: lookupResolution.message,
                  };
                }

                if (lookupResolution.kind === 'clarify') {
                  return {
                    ok: true,
                    plan: lookupResolution.plan,
                    previewText: lookupResolution.previewText,
                  };
                }

                return {
                  ok: false,
                  error: 'lookup_resolution_failed',
                  message: 'I could not resolve one of the target events. Please try again.',
                };
              }

              const lookupResolutionByIndex = new Map(
                lookupResolutions.map(({ index, lookupResolution }) => [index, lookupResolution]),
              );

              for (const [index, target] of plan.targets.entries()) {
                if (isCalendarTargetById(target)) {
                  const calendarId = target.calendarId ?? plan.calendarId ?? 'primary';
                  batchResolvedTargets.push({
                    calendarId,
                    eventId: target.eventId,
                  });
                  batchPlanTargets.push({
                    calendarId,
                    eventId: target.eventId,
                  });
                  continue;
                }

                if (isCalendarTargetLookup(target)) {
                  const lookupResolution = lookupResolutionByIndex.get(index);
                  if (!lookupResolution || lookupResolution.kind !== 'resolved') {
                    const lookupItem = lookupTargetByIndex.get(index);
                    const lookupRange = lookupRangeByIndex.get(index);
                    logger.warn(
                      '[executiveAgent] Missing resolved lookup target during batch plan resolution',
                      {
                        lookupQuery: lookupItem?.target.lookupQuery ?? target.lookupQuery,
                        hasRange: Boolean(lookupRange),
                        index,
                      },
                    );
                    return {
                      ok: false,
                      error: 'lookup_resolution_failed',
                      message: 'I could not resolve one of the target events. Please try again.',
                    };
                  }
                  batchResolvedTargets.push(lookupResolution.target);
                  batchPlanTargets.push(lookupResolution.planTarget);
                }
              }

              resolvedTargets = batchResolvedTargets;
              resolvedPlan = {
                ...plan,
                target: undefined,
                targets: batchPlanTargets,
              };
            } else if (plan.target) {
              if (isCalendarTargetById(plan.target)) {
                resolvedTarget = {
                  calendarId: plan.target.calendarId ?? plan.calendarId ?? 'primary',
                  eventId: plan.target.eventId,
                };
              } else if (isCalendarTargetLookup(plan.target)) {
                const lookupResolution = await resolveLookupTarget(plan.target);
                if (lookupResolution.kind === 'error') {
                  return {
                    ok: false,
                    error: lookupResolution.error,
                    message: lookupResolution.message,
                  };
                }
                if (lookupResolution.kind === 'clarify') {
                  return {
                    ok: true,
                    plan: lookupResolution.plan,
                    previewText: lookupResolution.previewText,
                  };
                }

                resolvedTarget = lookupResolution.target;
                resolvedPlan = {
                  ...plan,
                  targets: undefined,
                  target: lookupResolution.planTarget,
                };
              }
            }
          }

          if (
            (plan.action === 'update' || plan.action === 'delete') &&
            !resolvedTarget &&
            (!resolvedTargets || resolvedTargets.length === 0)
          ) {
            const clarifyPlan = createClarifyCalendarPlan(
              plan,
              ['Which event should I change?'],
              'Which event should I update or delete?',
            );

            return {
              ok: true,
              plan: clarifyPlan,
              previewText: clarifyPlan.userPreviewText,
            };
          }

          const now = new Date();
          const expiresAt = new Date(now.getTime() + PENDING_CALENDAR_CHANGE_TTL_MS);
          await prisma.pendingCalendarChange.updateMany({
            where: {
              userId: input.userId,
              conversationId: input.conversationId,
              status: PendingCalendarChangeStatus.PENDING,
            },
            data: {
              status: PendingCalendarChangeStatus.CANCELLED,
              cancelledAt: now,
            },
          });

          const resolvedTargetPayload = resolvedTargets?.length
            ? resolvedTargets
            : resolvedTarget ?? null;

          const pendingRecord = await prisma.pendingCalendarChange.create({
            data: {
              userId: input.userId,
              conversationId: input.conversationId,
              plan: resolvedPlan as Prisma.InputJsonValue,
              resolvedTarget: resolvedTargetPayload as Prisma.InputJsonValue,
              userTimezone,
              userRequest: request,
              expiresAt,
              status: PendingCalendarChangeStatus.PENDING,
            },
          });

          try {
            const eventCount = resolvedPlan.eventDrafts?.length
              ? resolvedPlan.eventDrafts.length
              : resolvedPlan.eventDraft
                ? 1
                : 0;
            await prisma.actionHistory.create({
              data: {
                userId: input.userId,
                actionType: ActionHistoryType.CALENDAR_CHANGE_PROPOSED,
                actionSummary: `Proposed calendar ${resolvedPlan.action}`,
                actionDetails: {
                  pendingId: pendingRecord.id,
                  action: resolvedPlan.action,
                  calendarId:
                    resolvedTarget?.calendarId ??
                    resolvedTargets?.[0]?.calendarId ??
                    resolvedPlan.calendarId ??
                    'primary',
                  eventId: resolvedTarget?.eventId ?? null,
                  eventIds: resolvedTargets?.map((target) => target.eventId) ?? undefined,
                  sendUpdates: resolvedPlan.sendUpdates,
                  createMeetLink: resolvedPlan.createMeetLink,
                  summary: resolvedPlan.eventDraft?.summary ?? null,
                  eventCount,
                  targetCount: resolvedTargets?.length ?? (resolvedTarget ? 1 : 0),
                  expiresAt: expiresAt.toISOString(),
                },
                undoable: false,
                metadata: {
                  source: 'executive-agent',
                  type: 'calendar-change-proposal',
                },
              },
            });
          } catch (error) {
            logger.warn('[executiveAgent] Failed to log calendar proposal', error);
          }

          return {
            ok: true,
            plan: resolvedPlan,
            previewText: resolvedPlan.userPreviewText,
            pendingChange: {
              pendingId: pendingRecord.id,
              createdAt: pendingRecord.createdAt.toISOString(),
              expiresAt: pendingRecord.expiresAt.toISOString(),
              action: resolvedPlan.action,
            },
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 6: Commit Calendar Change
      // ─────────────────────────────────────────────────────────────────────────
      commit_calendar_change: {
        description:
          'Finalize the latest pending calendar change. ' +
          'Use decision="confirm" only after explicit confirmation. Use decision="cancel" when the user declines.',
        inputSchema: z.object({
          decision: z.enum(['confirm', 'cancel']),
        }),
        execute: async (args: { decision: 'confirm' | 'cancel' }) => {
          const latestPending = await prisma.pendingCalendarChange.findFirst({
            where: {
              userId: input.userId,
              conversationId: input.conversationId,
              status: { in: [PendingCalendarChangeStatus.PENDING, PendingCalendarChangeStatus.IN_PROGRESS] },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              plan: true,
              resolvedTarget: true,
              userTimezone: true,
              userRequest: true,
              expiresAt: true,
              status: true,
              createdAt: true,
            },
          });

          if (!latestPending) {
            return {
              ok: false,
              error: 'pending_change_missing',
              message: 'No pending calendar change found. Please ask me to plan it again first.',
            };
          }

          if (Date.now() > latestPending.expiresAt.getTime()) {
            await prisma.pendingCalendarChange.updateMany({
              where: {
                id: latestPending.id,
                status: {
                  in: [PendingCalendarChangeStatus.PENDING, PendingCalendarChangeStatus.IN_PROGRESS],
                },
              },
              data: {
                status: PendingCalendarChangeStatus.EXPIRED,
              },
            });

            return {
              ok: false,
              error: 'pending_change_expired',
              message: 'That pending calendar change expired. Please ask me to plan it again.',
            };
          }

          if (latestPending.status === PendingCalendarChangeStatus.IN_PROGRESS) {
            return {
              ok: false,
              error: 'pending_change_in_progress',
              message: 'That calendar change is already being processed. Please wait a moment.',
            };
          }

          if (args.decision === 'cancel') {
            await prisma.pendingCalendarChange.updateMany({
              where: {
                id: latestPending.id,
                status: PendingCalendarChangeStatus.PENDING,
              },
              data: {
                status: PendingCalendarChangeStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            });

            return {
              ok: true,
              status: 'cancelled',
              message: 'Okay, I cancelled that pending calendar change.',
            };
          }

          const claim = await prisma.pendingCalendarChange.updateMany({
            where: {
              id: latestPending.id,
              status: PendingCalendarChangeStatus.PENDING,
            },
            data: {
              status: PendingCalendarChangeStatus.IN_PROGRESS,
            },
          });

          if (claim.count !== 1) {
            return {
              ok: false,
              error: 'pending_change_in_progress',
              message: 'That calendar change is already being processed.',
            };
          }

          const markPendingConsumed = async () => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.CONSUMED,
                consumedAt: new Date(),
              },
            });
          };

          const releasePending = async () => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.PENDING,
              },
            });
          };

          const cancelPending = async () => {
            await prisma.pendingCalendarChange.update({
              where: { id: latestPending.id },
              data: {
                status: PendingCalendarChangeStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            });
          };

          const pendingPayload = parsePendingCalendarChangeRecord(
            latestPending as PendingCalendarChangeRecord,
          );
          if (!pendingPayload) {
            await cancelPending();
            return {
              ok: false,
              error: 'invalid_pending_change',
              message: 'The pending calendar change is invalid. Please plan it again.',
            };
          }

          const plan = pendingPayload.plan;
          const calendarId = pendingPayload.resolvedTarget?.calendarId ?? plan.calendarId ?? 'primary';

          const calendarService = await CalendarService.create({
            userId: input.userId,
            purpose: `${resolvedChannel}:calendar-mutation`,
            requester: 'executiveAgent.commit_calendar_change',
          });

          if (!calendarService) {
            await releasePending();
            return {
              ok: false,
              error: 'calendar_unavailable',
              message: 'No calendar access available. Please reconnect your calendar.',
            };
          }

          try {
            if (plan.action === 'create') {
              const drafts = plan.eventDrafts?.length
                ? plan.eventDrafts
                : plan.eventDraft
                  ? [plan.eventDraft]
                  : [];

              if (drafts.length === 0) {
                await cancelPending();
                return { ok: false, error: 'invalid_plan', message: 'Missing event details for creation.' };
              }

              const createdEvents: Array<{
                eventId: string | null | undefined;
                htmlLink?: string | null;
                summary: string;
              }> = [];
              const failures: Array<{ index: number; summary: string; message: string }> = [];

              for (const [index, draft] of drafts.entries()) {
                const timeValidation = validateEventDraftTimes(draft, 'create');
                if (!timeValidation.ok) {
                  failures.push({
                    index,
                    summary: draft.summary ?? `Event ${index + 1}`,
                    message: timeValidation.message,
                  });
                  continue;
                }

                // Per-draft calendarId overrides plan-level default
                const draftCalendarId = (draft as { calendarId?: string }).calendarId ?? calendarId;

                const conferenceData = plan.createMeetLink
                  ? {
                      createRequest: {
                        requestId: crypto.randomUUID(),
                        conferenceSolutionKey: { type: 'hangoutsMeet' },
                      },
                    }
                  : undefined;

                // Strip calendarId from the draft before building requestBody
                // (calendarId is a path param for Google API, not an event field)
                const { calendarId: _draftCalId, ...draftWithoutCalendarId } = draft as Record<string, unknown>;

                const requestBody = stripUndefined({
                  ...draftWithoutCalendarId,
                  extendedProperties: {
                    private: {
                      cliraPendingId: latestPending.id,
                      cliraSource: 'calendarCreatorAgent',
                    },
                  },
                  conferenceData,
                } satisfies Record<string, unknown>);

                try {
                  const response = await calendarService.createEvent({
                    calendarId: draftCalendarId,
                    requestBody,
                    conferenceDataVersion: conferenceData ? 1 : undefined,
                    sendUpdates: plan.sendUpdates,
                  });

                  const event = response.data;
                  const summary = event.summary ?? draft.summary ?? '(No title)';

                  createdEvents.push({
                    eventId: event.id,
                    htmlLink: event.htmlLink,
                    summary,
                  });

                  await prisma.actionHistory.create({
                    data: {
                      userId: input.userId,
                      actionType: ActionHistoryType.CALENDAR_EVENT_CREATED,
                      actionSummary: `Created calendar event: ${summary}`,
                      actionDetails: {
                        calendarId: draftCalendarId,
                        eventId: event.id,
                        htmlLink: event.htmlLink,
                        sendUpdates: plan.sendUpdates,
                        createMeetLink: plan.createMeetLink,
                        start: event.start as Prisma.InputJsonValue,
                        end: event.end as Prisma.InputJsonValue,
                        attendees: summarizeAttendees(event.attendees),
                      },
                      undoable: false,
                      metadata: {
                        source: 'executive-agent',
                        pendingId: latestPending.id,
                      },
                    },
                  });
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Unknown error';
                  failures.push({
                    index,
                    summary: draft.summary ?? `Event ${index + 1}`,
                    message,
                  });
                }
              }

              if (createdEvents.length > 0) {
                await markPendingConsumed();
                const status = failures.length > 0 ? 'partial' : 'created';
                const message = failures.length > 0
                  ? `Created ${createdEvents.length} event(s), but ${failures.length} failed.`
                  : `Created ${createdEvents.length} calendar event(s).`;
                return {
                  ok: failures.length === 0,
                  status,
                  message,
                  createdCount: createdEvents.length,
                  failedCount: failures.length,
                  createdEvents,
                  failures,
                };
              }

              await releasePending();
              const firstFailure = failures[0]?.message ?? 'No events were created.';
              return {
                ok: false,
                error: 'calendar_commit_failed',
                message: `Could not create the event(s): ${firstFailure}`,
                failedCount: failures.length,
                failures,
              };
            }

            if (plan.action === 'update') {
              if (pendingPayload.resolvedTargets?.length) {
                if (!plan.eventDrafts || plan.eventDrafts.length !== pendingPayload.resolvedTargets.length) {
                  await cancelPending();
                  return {
                    ok: false,
                    error: 'invalid_plan',
                    message: 'Batch updates require matching targets and eventDrafts.',
                  };
                }

                const updatedEvents: Array<{
                  eventId: string | null | undefined;
                  htmlLink?: string | null;
                  summary: string;
                }> = [];
                const failures: Array<{ index: number; summary: string; message: string }> = [];

                for (const [index, target] of pendingPayload.resolvedTargets.entries()) {
                  const draft = plan.eventDrafts[index];
                  if (!draft) {
                    failures.push({
                      index,
                      summary: `Event ${index + 1}`,
                      message: 'Missing update fields for this target.',
                    });
                    continue;
                  }

                  const draftKeys = Object.entries(draft).filter(([, value]) => value !== undefined);
                  if (draftKeys.length === 0) {
                    failures.push({
                      index,
                      summary: draft.summary ?? `Event ${index + 1}`,
                      message: 'No update fields were provided.',
                    });
                    continue;
                  }

                  try {
                    const currentEventResponse = await calendarService.getEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                    });

                    const currentEvent = currentEventResponse.data;

                    const normalizedDraft = normalizeUpdateDraftTimesForPatch({
                      draft,
                      currentEvent: {
                        start: currentEvent.start as GoogleEventTime | null | undefined,
                        end: currentEvent.end as GoogleEventTime | null | undefined,
                      },
                    });

                    if (!normalizedDraft.ok) {
                      failures.push({
                        index,
                        summary: draft.summary ?? `Event ${index + 1}`,
                        message: normalizedDraft.message,
                      });
                      continue;
                    }

                    const timeValidation = validateEventDraftTimes(normalizedDraft.patch, 'update');
                    if (!timeValidation.ok) {
                      failures.push({
                        index,
                        summary: draft.summary ?? `Event ${index + 1}`,
                        message: timeValidation.message,
                      });
                      continue;
                    }

                    const conferenceData = plan.createMeetLink
                      ? {
                          createRequest: {
                            requestId: crypto.randomUUID(),
                            conferenceSolutionKey: { type: 'hangoutsMeet' },
                          },
                        }
                      : undefined;

                    const requestBody = stripUndefined({
                      ...normalizedDraft.patch,
                      extendedProperties: {
                        private: {
                          ...(currentEvent.extendedProperties?.private ?? {}),
                          cliraPendingId: latestPending.id,
                          cliraSource: 'calendarCreatorAgent',
                        },
                      },
                      conferenceData,
                    } satisfies Record<string, unknown>);

                    const response = await calendarService.patchEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                      requestBody,
                      conferenceDataVersion: conferenceData ? 1 : undefined,
                      sendUpdates: plan.sendUpdates,
                      ifMatchEtag: currentEvent.etag ?? target.etag,
                    });

                    const updatedEvent = response.data;
                    const summary = updatedEvent.summary ?? currentEvent.summary ?? draft.summary ?? '(No title)';

                    updatedEvents.push({
                      eventId: updatedEvent.id,
                      htmlLink: updatedEvent.htmlLink,
                      summary,
                    });

                    await prisma.actionHistory.create({
                      data: {
                        userId: input.userId,
                        actionType: ActionHistoryType.CALENDAR_EVENT_UPDATED,
                        actionSummary: `Updated calendar event: ${summary}`,
                        actionDetails: {
                          calendarId: target.calendarId,
                          eventId: target.eventId,
                          htmlLink: updatedEvent.htmlLink,
                          sendUpdates: plan.sendUpdates,
                          createMeetLink: plan.createMeetLink,
                          start: (updatedEvent.start ?? currentEvent.start) as Prisma.InputJsonValue,
                          end: (updatedEvent.end ?? currentEvent.end) as Prisma.InputJsonValue,
                          attendees: summarizeAttendees(updatedEvent.attendees ?? currentEvent.attendees),
                        },
                        undoable: false,
                        metadata: {
                          source: 'executive-agent',
                          pendingId: latestPending.id,
                        },
                      },
                    });
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    failures.push({
                      index,
                      summary: draft.summary ?? `Event ${index + 1}`,
                      message,
                    });
                  }
                }

                if (updatedEvents.length > 0) {
                  await markPendingConsumed();
                  const status = failures.length > 0 ? 'partial' : 'updated';
                  const message = failures.length > 0
                    ? `Updated ${updatedEvents.length} event(s), but ${failures.length} failed.`
                    : `Updated ${updatedEvents.length} calendar event(s).`;
                  return {
                    ok: failures.length === 0,
                    status,
                    message,
                    updatedCount: updatedEvents.length,
                    failedCount: failures.length,
                    updatedEvents,
                    failures,
                  };
                }

                await releasePending();
                const firstFailure = failures[0]?.message ?? 'No events were updated.';
                return {
                  ok: false,
                  error: 'calendar_commit_failed',
                  message: `Could not update the event(s): ${firstFailure}`,
                  failedCount: failures.length,
                  failures,
                };
              }

              if (!pendingPayload.resolvedTarget) {
                await cancelPending();
                return {
                  ok: false,
                  error: 'missing_target',
                  message: 'No event target found for this update.',
                };
              }

              if (!plan.eventDraft) {
                await cancelPending();
                return { ok: false, error: 'invalid_plan', message: 'Missing fields to update.' };
              }

              const draftKeys = Object.entries(plan.eventDraft).filter(([, value]) => value !== undefined);
              if (draftKeys.length === 0) {
                await cancelPending();
                return { ok: false, error: 'invalid_plan', message: 'No update fields were provided.' };
              }

              const currentEventResponse = await calendarService.getEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
              });

              const currentEvent = currentEventResponse.data;

              const normalizedDraft = normalizeUpdateDraftTimesForPatch({
                draft: plan.eventDraft,
                currentEvent: {
                  start: currentEvent.start as GoogleEventTime | null | undefined,
                  end: currentEvent.end as GoogleEventTime | null | undefined,
                },
              });

              if (!normalizedDraft.ok) {
                await cancelPending();
                return { ok: false, error: 'invalid_event_time', message: normalizedDraft.message };
              }

              const timeValidation = validateEventDraftTimes(normalizedDraft.patch, 'update');
              if (!timeValidation.ok) {
                await cancelPending();
                return { ok: false, error: 'invalid_event_time', message: timeValidation.message };
              }

              const conferenceData = plan.createMeetLink
                ? {
                    createRequest: {
                      requestId: crypto.randomUUID(),
                      conferenceSolutionKey: { type: 'hangoutsMeet' },
                    },
                  }
                : undefined;

              const requestBody = stripUndefined({
                ...normalizedDraft.patch,
                extendedProperties: {
                  private: {
                    ...(currentEvent.extendedProperties?.private ?? {}),
                    cliraPendingId: latestPending.id,
                    cliraSource: 'calendarCreatorAgent',
                  },
                },
                conferenceData,
              } satisfies Record<string, unknown>);

              const response = await calendarService.patchEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
                requestBody,
                conferenceDataVersion: conferenceData ? 1 : undefined,
                sendUpdates: plan.sendUpdates,
                ifMatchEtag: currentEvent.etag ?? pendingPayload.resolvedTarget.etag,
              });

              const updatedEvent = response.data;

              await markPendingConsumed();

              await prisma.actionHistory.create({
                data: {
                  userId: input.userId,
                  actionType: ActionHistoryType.CALENDAR_EVENT_UPDATED,
                  actionSummary: `Updated calendar event: ${updatedEvent.summary ?? currentEvent.summary ?? '(No title)'}`,
                  actionDetails: {
                    calendarId: pendingPayload.resolvedTarget.calendarId,
                    eventId: pendingPayload.resolvedTarget.eventId,
                    htmlLink: updatedEvent.htmlLink,
                    sendUpdates: plan.sendUpdates,
                    createMeetLink: plan.createMeetLink,
                    start: (updatedEvent.start ?? currentEvent.start) as Prisma.InputJsonValue,
                    end: (updatedEvent.end ?? currentEvent.end) as Prisma.InputJsonValue,
                    attendees: summarizeAttendees(updatedEvent.attendees ?? currentEvent.attendees),
                  },
                  undoable: false,
                  metadata: {
                    source: 'executive-agent',
                    pendingId: latestPending.id,
                  },
                },
              });

              return {
                ok: true,
                status: 'updated',
                message: 'Updated the calendar event.',
                eventId: updatedEvent.id,
                htmlLink: updatedEvent.htmlLink,
                summary: updatedEvent.summary ?? currentEvent.summary ?? '(No title)',
              };
            }

            if (plan.action === 'delete') {
              if (pendingPayload.resolvedTargets?.length) {
                const deletedEvents: Array<{
                  eventId: string;
                  summary: string;
                }> = [];
                const failures: Array<{ index: number; summary: string; message: string }> = [];

                for (const [index, target] of pendingPayload.resolvedTargets.entries()) {
                  try {
                    const currentEventResponse = await calendarService.getEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                    });
                    const currentEvent = currentEventResponse.data;

                    await calendarService.deleteEvent({
                      calendarId: target.calendarId,
                      eventId: target.eventId,
                      sendUpdates: plan.sendUpdates,
                      ifMatchEtag: currentEvent.etag ?? target.etag,
                    });

                    const summary = currentEvent.summary ?? '(No title)';
                    deletedEvents.push({
                      eventId: target.eventId,
                      summary,
                    });

                    await prisma.actionHistory.create({
                      data: {
                        userId: input.userId,
                        actionType: ActionHistoryType.CALENDAR_EVENT_DELETED,
                        actionSummary: `Deleted calendar event: ${summary}`,
                        actionDetails: {
                          calendarId: target.calendarId,
                          eventId: target.eventId,
                          sendUpdates: plan.sendUpdates,
                          createMeetLink: plan.createMeetLink,
                          start: currentEvent.start as Prisma.InputJsonValue,
                          end: currentEvent.end as Prisma.InputJsonValue,
                          attendees: summarizeAttendees(currentEvent.attendees),
                        } as Prisma.InputJsonObject,
                        undoable: false,
                        metadata: {
                          source: 'executive-agent',
                          pendingId: latestPending.id,
                        },
                      },
                    });
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    failures.push({
                      index,
                      summary: `Event ${index + 1}`,
                      message,
                    });
                  }
                }

                if (deletedEvents.length > 0) {
                  await markPendingConsumed();
                  const status = failures.length > 0 ? 'partial' : 'deleted';
                  const message = failures.length > 0
                    ? `Deleted ${deletedEvents.length} event(s), but ${failures.length} failed.`
                    : `Deleted ${deletedEvents.length} calendar event(s).`;
                  return {
                    ok: failures.length === 0,
                    status,
                    message,
                    deletedCount: deletedEvents.length,
                    failedCount: failures.length,
                    deletedEvents,
                    failures,
                  };
                }

                await releasePending();
                const firstFailure = failures[0]?.message ?? 'No events were deleted.';
                return {
                  ok: false,
                  error: 'calendar_commit_failed',
                  message: `Could not delete the event(s): ${firstFailure}`,
                  failedCount: failures.length,
                  failures,
                };
              }

              if (!pendingPayload.resolvedTarget) {
                await cancelPending();
                return {
                  ok: false,
                  error: 'missing_target',
                  message: 'No event target found for this deletion.',
                };
              }

              const currentEventResponse = await calendarService.getEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
              });
              const currentEvent = currentEventResponse.data;

              await calendarService.deleteEvent({
                calendarId: pendingPayload.resolvedTarget.calendarId,
                eventId: pendingPayload.resolvedTarget.eventId,
                sendUpdates: plan.sendUpdates,
                ifMatchEtag: currentEvent.etag ?? pendingPayload.resolvedTarget.etag,
              });

              await markPendingConsumed();

              await prisma.actionHistory.create({
                data: {
                  userId: input.userId,
                  actionType: ActionHistoryType.CALENDAR_EVENT_DELETED,
                  actionSummary: `Deleted calendar event: ${currentEvent.summary ?? '(No title)'}`,
                  actionDetails: {
                    calendarId: pendingPayload.resolvedTarget.calendarId,
                    eventId: pendingPayload.resolvedTarget.eventId,
                    sendUpdates: plan.sendUpdates,
                    createMeetLink: plan.createMeetLink,
                    start: currentEvent.start as Prisma.InputJsonValue,
                    end: currentEvent.end as Prisma.InputJsonValue,
                    attendees: summarizeAttendees(currentEvent.attendees),
                  } as Prisma.InputJsonObject,
                  undoable: false,
                  metadata: {
                    source: 'executive-agent',
                    pendingId: latestPending.id,
                  },
                },
              });

              return {
                ok: true,
                status: 'deleted',
                message: 'Deleted the calendar event.',
                eventId: pendingPayload.resolvedTarget.eventId,
                summary: currentEvent.summary ?? '(No title)',
              };
            }

            await cancelPending();
            return {
              ok: false,
              error: 'invalid_plan',
              message: 'Calendar change is not ready to commit.',
            };
          } catch (error) {
            if (isCalendarScopeError(error)) {
              await releasePending();
              return {
                ok: false,
                error: 'calendar_scope_missing',
                message: 'Calendar write access is required. Please reconnect Google Calendar.',
                reauthUrl: generateReauthUrl([REQUIRED_SCOPES.CALENDAR_EVENTS]),
              };
            }

            const message = error instanceof Error ? error.message : 'Unknown error';
            await releasePending();
            return {
              ok: false,
              error: 'calendar_commit_failed',
              message,
            };
          }
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 7: Append to Memory
      // ─────────────────────────────────────────────────────────────────────────
      append_to_supermemory: {
        description:
          'Store a fact to memory so you remember it in future conversations. Call in two cases: ' +
          '(1) When the user reveals names, roles, preferences, or facts—store them. ' +
          '(2) When you DISCOVER accurate, high-confidence facts from your tools (search_inbox_context, search_calendar)—e.g. you find "Dr. Smith" is the user\'s statistics professor from emails, or "Sarah" is their manager from calendar—store that too. ' +
          'High confidence only; don\'t guess. One atomic sentence per memory. Memory is deduped—storing the same fact twice is safe. You can\'t rely on the user to say everything.',
        inputSchema: z.object({
          content: z.string().min(1).max(300).describe('Atomic memory line (1 sentence describing a user fact)'),
          type: z
            .enum(['user_preference', 'user_fact', 'relationship_info', 'scheduling_preference', 'communication_style'])
            .default('user_preference')
            .describe('Category of the memory'),
        }),
        execute: async (args: { content: string; type: string }) => {
          logger.info(`[executiveAgent] append_to_supermemory: "${truncate(args.content, 50)}"`);

          if (!isSupermemoryConfigured()) {
            return { stored: false, reason: 'Memory system not configured' };
          }

          try {
            const customId = generateMemoryCustomId(input.userId, resolvedChannel, args.content);
            const client = getSupermemoryClient();

            await client.addDocument({
              content: args.content,
              customId,
              metadata: {
                type: args.type,
                source: resolvedChannel,
                timestamp: new Date().toISOString(),
              },
              containerTags: [input.userId],
              userId: input.userId,
            });

            this.memoryStored = true;
            logger.info(`[executiveAgent] Memory stored: customId=${customId}`);

            return { stored: true, customId };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.warn(`[executiveAgent] Memory storage failed: ${message}`);
            return { stored: false, reason: message };
          }
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 8: Add Email Alert
      // ─────────────────────────────────────────────────────────────────────────
      add_email_alert: {
        description:
          'Create an email notification alert. You will be notified via your linked messaging channel when matching emails arrive. ' +
          'Examples: "emails from my teacher", "emails about invoices", "emails from john@company.com", etc...',
        inputSchema: z.object({
          description: z
            .string()
            .min(5)
            .max(300)
            .describe('What emails to alert on (natural language)'),
        }),
        execute: async (args: { description: string }) => {
          const description = args.description.trim();
          if (description.length < 5) {
            return { success: false, message: 'Please provide a longer alert description.' };
          }

          const alert = await prisma.emailAlert.create({
            data: {
              userId: input.userId,
              description,
              isActive: true,
            },
          });

          logger.info(`[executiveAgent] Created email alert: ${alert.id}`);

          return {
            success: true,
            alertId: alert.id,
            description,
            message: `Got it! I'll notify you when emails matching "${description}" arrive.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 9: Remove Email Alert
      // ─────────────────────────────────────────────────────────────────────────
      remove_email_alert: {
        description:
          'Remove an email alert by ID or find by description. ' +
          'Use list_email_alerts first to see active alerts.',
        inputSchema: z.object({
          alertId: z.string().optional().describe('Alert ID to remove'),
          descriptionMatch: z.string().optional().describe('Find alert by partial description match'),
        }),
        execute: async (args: { alertId?: string; descriptionMatch?: string }) => {
          if (!args.alertId && !args.descriptionMatch) {
            return { success: false, message: 'Provide an alertId or descriptionMatch.' };
          }

          let alert: { id: string; description: string } | null = null;

          if (args.alertId) {
            alert = await prisma.emailAlert.findFirst({
              where: { id: args.alertId, userId: input.userId },
              select: { id: true, description: true },
            });
          } else if (args.descriptionMatch) {
            alert = await prisma.emailAlert.findFirst({
              where: {
                userId: input.userId,
                isActive: true,
                description: { contains: args.descriptionMatch, mode: 'insensitive' },
              },
              select: { id: true, description: true },
            });
          }

          if (!alert) {
            return { success: false, message: 'Alert not found.' };
          }

          await prisma.emailAlert.delete({ where: { id: alert.id } });
          logger.info(`[executiveAgent] Removed email alert: ${alert.id}`);

          return {
            success: true,
            alertId: alert.id,
            message: `Removed alert: "${alert.description}"`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 10: List Email Alerts
      // ─────────────────────────────────────────────────────────────────────────
      list_email_alerts: {
        description: 'List all active email alerts.',
        inputSchema: z.object({}),
        execute: async () => {
          const alerts = await prisma.emailAlert.findMany({
            where: { userId: input.userId, isActive: true },
            orderBy: { createdAt: 'desc' },
            select: { id: true, description: true, createdAt: true },
          });

          return {
            count: alerts.length,
            alerts: alerts.map((alert) => ({
              id: alert.id,
              description: alert.description,
              createdAt: alert.createdAt.toISOString(),
            })),
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 11: Add Reminder
      // ─────────────────────────────────────────────────────────────────────────
      add_reminder: {
        description:
          'Create a time-based reminder. Prefer natural language like "today 4pm", "tomorrow 9am", or "4:00 PM" (assumed in the user\'s timezone). ' +
          'Only use ISO timestamps if you are certain about timezone conversion: a trailing "Z" means UTC. ' +
          'Always ensure the time is in the future.',
        inputSchema: z.object({
          title: z.string().min(1).max(200).describe('Short reminder title'),
          scheduledAt: z.string().min(1).max(200).describe('Reminder time (natural language preferred; ISO UTC allowed)'),
          context: z.string().max(1000).optional().describe('Additional context or urgency notes'),
          recurrence: reminderRecurrenceSchema.optional(),
          linkedEmailId: z.string().optional(),
          linkedEventId: z.string().optional(),
        }),
        execute: async (args: {
          title: string;
          scheduledAt: string;
          context?: string;
          recurrence?: z.infer<typeof reminderRecurrenceSchema>;
          linkedEmailId?: string;
          linkedEventId?: string;
        }) => {
          const title = args.title.trim();
          if (!title) {
            return { success: false, message: 'Reminder title is required.' };
          }

          const now = new Date();
          const parsed = parseReminderTime(args.scheduledAt, { now, timeZone: userTimezone });
          if (!parsed || Number.isNaN(parsed.date.getTime())) {
            return { success: false, message: 'Could not parse the reminder time. Try a specific time.' };
          }
          if (parsed.date.getTime() <= now.getTime()) {
            return { success: false, message: 'That time is in the past. Provide a future time.' };
          }

          if (args.recurrence?.until) {
            const untilDate = new Date(args.recurrence.until);
            if (Number.isNaN(untilDate.getTime())) {
              return { success: false, message: 'Recurrence "until" must be a valid ISO date.' };
            }
            if (untilDate.getTime() <= parsed.date.getTime()) {
              return { success: false, message: 'Recurrence "until" must be after the scheduled time.' };
            }
          }

          const reminder = await prisma.reminder.create({
            data: {
              userId: input.userId,
              title,
              context: args.context?.trim() || undefined,
              scheduledAt: parsed.date,
              recurrence: args.recurrence ?? undefined,
              linkedEmailId: args.linkedEmailId,
              linkedEventId: args.linkedEventId,
            },
          });

          const scheduledAtLocal = formatDateTimeInTimeZone(reminder.scheduledAt, userTimezone);

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_CREATED',
              actionSummary: `Reminder created: ${title}`,
              actionDetails: {
                reminderId: reminder.id,
                scheduledAt: reminder.scheduledAt.toISOString(),
                scheduledAtLocal,
                recurrence: args.recurrence ?? undefined,
                confidence: parsed.confidence,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: reminder.id,
            scheduledAt: reminder.scheduledAt.toISOString(),
            scheduledAtLocal,
            confidence: parsed.confidence,
            message: `Got it. I'll remind you on ${scheduledAtLocal}.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 12: List Reminders
      // ─────────────────────────────────────────────────────────────────────────
      list_reminders: {
        description: 'List upcoming reminders (pending and snoozed by default).',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(20).optional().describe('Max reminders to return (default: 5)'),
          includeCompleted: z.boolean().optional().describe('Include completed/dismissed/cancelled reminders'),
        }),
        execute: async (args: { limit?: number; includeCompleted?: boolean }) => {
          const limit = Math.min(args.limit ?? 5, 20);
          const includeCompleted = args.includeCompleted ?? false;

          const reminders = await prisma.reminder.findMany({
            where: {
              userId: input.userId,
              ...(includeCompleted ? {} : { status: { in: ['PENDING', 'SNOOZED'] } }),
            },
            orderBy: { scheduledAt: 'asc' },
            take: limit,
          });

          return {
            count: reminders.length,
            reminders: reminders.map((reminder) => {
              const dueAt = reminder.status === 'SNOOZED' && reminder.snoozedUntil
                ? reminder.snoozedUntil
                : reminder.scheduledAt;
              return {
                id: reminder.id,
                title: reminder.title,
                status: reminder.status,
                scheduledAt: dueAt.toISOString(),
                scheduledAtLocal: formatDateTimeInTimeZone(dueAt, userTimezone),
              };
            }),
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 13: Snooze Reminder
      // ─────────────────────────────────────────────────────────────────────────
      snooze_reminder: {
        description: 'Snooze a reminder until a new time.',
        inputSchema: z.object({
          reminderId: z.string().min(1),
          snoozeUntil: z.string().min(1).max(200).describe('Snooze until (ISO UTC or natural language)'),
        }),
        execute: async (args: { reminderId: string; snoozeUntil: string }) => {
          const now = new Date();
          const parsed = parseReminderTime(args.snoozeUntil, { now, timeZone: userTimezone });
          if (!parsed || Number.isNaN(parsed.date.getTime())) {
            return { success: false, message: 'Could not parse the snooze time. Try a specific time.' };
          }
          if (parsed.date.getTime() <= now.getTime()) {
            return { success: false, message: 'Snooze time must be in the future.' };
          }

          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminderClosedStatuses.has(reminder.status)) {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: 'SNOOZED',
              snoozedUntil: parsed.date,
              snoozeCount: { increment: 1 },
            },
          });

          const snoozedLocal = formatDateTimeInTimeZone(parsed.date, userTimezone);

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_SNOOZED',
              actionSummary: `Reminder snoozed: ${reminder.title}`,
              actionDetails: {
                reminderId: reminder.id,
                snoozedUntil: parsed.date.toISOString(),
                snoozedUntilLocal: snoozedLocal,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            snoozedUntil: parsed.date.toISOString(),
            snoozedUntilLocal: snoozedLocal,
            message: `Snoozed until ${snoozedLocal}.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 14: Dismiss Reminder
      // ─────────────────────────────────────────────────────────────────────────
      dismiss_reminder: {
        description: 'Dismiss a reminder (optionally mark as completed).',
        inputSchema: z.object({
          reminderId: z.string().min(1),
          markCompleted: z.boolean().optional(),
        }),
        execute: async (args: { reminderId: string; markCompleted?: boolean }) => {
          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminder.status === 'CANCELLED' || reminder.status === 'MISSED') {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const markCompleted = args.markCompleted ?? false;
          const status = markCompleted ? 'COMPLETED' : 'DISMISSED';

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status,
              dismissedAt: new Date(),
              snoozedUntil: null,
            },
          });

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_DISMISSED',
              actionSummary: `${markCompleted ? 'Reminder completed' : 'Reminder dismissed'}: ${reminder.title}`,
              actionDetails: {
                reminderId: reminder.id,
                status,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            status: updated.status,
            message: markCompleted ? 'Marked complete.' : 'Dismissed.',
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 15: Cancel Reminder
      // ─────────────────────────────────────────────────────────────────────────
      cancel_reminder: {
        description: 'Cancel a pending reminder the user no longer wants.',
        inputSchema: z.object({
          reminderId: z.string().min(1),
        }),
        execute: async (args: { reminderId: string }) => {
          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminderNonCancelableStatuses.has(reminder.status)) {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: 'CANCELLED',
              dismissedAt: new Date(),
              snoozedUntil: null,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            status: updated.status,
            message: `Cancelled reminder: ${reminder.title}`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 16: Send Email (TERMINAL - Requires Explicit Permission)
      // ─────────────────────────────────────────────────────────────────────────
      send_email: {
        description:
          'Send an email immediately via Gmail. TERMINAL action - ONLY call after user explicitly says "yes", "send it", "go ahead", or similar clear permission. ' +
          'This IMMEDIATELY SENDS the email - it is NOT a draft or preview. The email will be sent from the user\'s Gmail account. ' +
          'Always show the email details to the user first, wait for their explicit "send" approval, then call this tool. ' +
          'After calling this, provide a brief channel-appropriate confirmation message.',
        inputSchema: z.object({
          to: z.string().email().describe('Email recipient (primary)'),
          cc: z.array(z.string().email()).optional().describe('CC recipient(s)'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body'),
          inReplyTo: z.string().optional().describe('RFC 2822 In-Reply-To header for threading'),
          references: z.string().optional().describe('RFC 2822 References header for threading'),
          threadId: z.string().optional().describe('Gmail thread ID to attach email to'),
        }),
        execute: async (args: {
          to: string;
          cc?: string[];
          subject: string;
          body: string;
          inReplyTo?: string;
          references?: string;
          threadId?: string;
        }) => {
          logger.info(`[executiveAgent] send_email: to=${args.to} subject="${truncate(args.subject, 30)}"`);

          try {
            const gmailContext = await createGmailServiceForUser({
              userId: input.userId,
              purpose: `${resolvedChannel}:send-email`,
              requester: 'executiveAgent.send_email',
            });

            if (!gmailContext) {
              return {
                success: false,
                message: 'Gmail credentials not available. Please reconnect your Gmail account.',
              };
            }

            const result = await gmailContext.gmail.sendEmail({
              to: args.to,
              cc: args.cc,
              subject: args.subject,
              body: args.body,
              inReplyTo: args.inReplyTo,
              references: args.references,
              threadId: args.threadId,
            });

            logger.info(`[executiveAgent] Email sent: messageId=${result.id}`);

            return {
              success: true,
              messageId: result.id,
              threadId: result.threadId,
              message: `Email sent successfully to ${args.to}${args.cc && args.cc.length > 0 ? ` (CC: ${args.cc.join(', ')})` : ''}!`,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`[executiveAgent] Failed to send email: ${message}`);
            return {
              success: false,
              message: `Failed to send email: ${message}`,
            };
          }
        },
      },
    };

    if (input.progressContext) {
      tools.send_progress_update = createSendProgressUpdateTool(input.progressContext);
    }

    const startTime = Date.now();
    let lastProgressSentAt = 0;

    const timedTools = wrapToolsWithTimingMetadata({
      tools,
      agentStartedAt: startTime,
      timeLeftMs: () => toolAbort.timeLeftMs(),
      getLastProgressSentAt: () => lastProgressSentAt,
      setLastProgressSentAt: (sentAt: number) => {
        lastProgressSentAt = sentAt;
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Execute Agent
    // ═══════════════════════════════════════════════════════════════════════════

    try {
      const systemPrompt =
        'You are Clira, an Executive AI Agent helping the user over messaging. ' +
        'You are warm, casual, confident, and high-agency (like a top-tier human EA). ' +
        'NEVER sound robotic or use phrases like "as an AI" or "I don\'t have feelings". ' +
        'Keep responses SHORT by default. Ask clarifying questions only when truly needed. ' +
        'Be proactive and decisive ("want me to send it now?"). ' +
        '**TIME AWARENESS (CRITICAL):** Always be aware of the CURRENT time shown in the prompt context. ' +
        'If the last message was sent hours or days ago, you are responding at a DIFFERENT time. ' +
        'Pay attention to: (1) What time of day it is NOW (morning/afternoon/evening/night), ' +
        '(2) What day it is NOW (today, not yesterday), (3) How much time has passed since the last message. ' +
        'If it\'s a new day or significantly different time, acknowledge it naturally (e.g., "Good morning" if it\'s morning after a night conversation, or "Hey" if it\'s been a while). ' +
        'Learn the user over time: call append_to_supermemory (1) when they reveal names, roles, preferences, or facts, and (2) when you discover accurate, high-confidence facts from your tools (inbox, calendar)—e.g. you find who their professor or manager is from emails/calendar. Don\'t rely only on what the user says. ' +
        'When the user asks a recall question (e.g. "what\'s my stat prof\'s name?", "who\'s my manager?"), call search_memory first; only say you don\'t know if search returns nothing. ' +
        'Use send_progress_update naturally like texting a friend: ' +
        'when you need to dig deeper after a weak first result, ' +
        'when you\'re adding another tool (e.g., checking calendar after inbox), ' +
        'or when the request clearly needs multiple steps. ' +
        'MANDATORY: On the first call of search_calendar or plan_calendar_change in this turn, call send_progress_update first with one short natural sentence (e.g. "Checking your calendar…"); only once per tool per turn. ' +
        'Tool results include _timing (elapsed_ms, ms_since_last_progress_update, time_left_ms). If ms_since_last_progress_update > 15000 and you plan another tool call, send a quick progress update first. ' +
        'Avoid robotic "starting search" updates and never mention tool names. ' +
        'When drafting emails: gather context first (search_inbox_context, calendar, memory), then propose the draft to the user. ' +
        'For analytical or quantitative questions over emails (totals, counts, patterns, aggregations), use search_inbox_context with mode=deep, then analyze the evidence and report. ' +
        'ONLY call send_email after the user explicitly says "yes", "send it", "go ahead", or similar clear approval. NEVER assume permission. The email will be SENT IMMEDIATELY. ' +
        `Pending calendar state: ${pendingCalendarInstruction} ` +
        'Calendar change workflow: ' +
        '(1) If no pending change exists: call plan_calendar_change to create one. For move/reschedule requests, call plan_calendar_change ONCE with the complete plan (all events and new times). Do not call it again to refine unless the user explicitly asks for changes. ' +
        '(2) If a pending change exists and user confirms (approvals: "yes", "yessirr", "yup", "yeah", "sure", "send it", "confirm", "do it", "lock it in", "go ahead"): call commit_calendar_change with decision="confirm". DO NOT call plan_calendar_change again. ' +
        '(3) If a pending change exists and user declines ("no", "cancel", "don\'t"): call commit_calendar_change with decision="cancel". ' +
        '(4) If a pending change exists but approval is ambiguous: ask a short confirmation question WITHOUT calling plan_calendar_change again. ' +
        'NEVER call plan_calendar_change when an active pending change already exists unless the user explicitly requests a modification to the plan. If (and only if) they explicitly request a modification, call plan_calendar_change with forceNewPlan=true. ' +
        'Use search_memory when the user asks to recall something about themselves or their contacts. ' +
        'If asked directly whether you\'re an AI, be honest but don\'t volunteer it. ' +
        'If conversation goes off-topic, politely redirect: "noted, but let\'s tackle that inbox!" ' +
        'Latency discipline is critical: decide the minimum context needed before calling tools. ' +
        'Tool strategy (do this silently): ' +
        '(1) If the request is about schedule/events/availability, use ONE calendar tool first (search_calendar for events; check_calendar only for free/busy/scheduling). ' +
        '(2) For plan_calendar_change that moves or reschedules specific events: call search_calendar exactly ONCE with one combined query (all event names) and one date range, then call plan_calendar_change with resolvedEvents from that single result. Never use 2+ search_calendar calls for the same plan. Do not call plan_calendar_change without resolvedEvents when the plan updates named events. ' +
        '(3) If the request is about finding/summarizing emails, use ONE inbox search first (quick for lookup, deep for aggregation). ' +
        '(4) Only use ONE fallback tool if it meaningfully improves the answer. ' +
        'Do not repeat a tool call unless the user provides new constraints in the same message. Do not use search_calendar with generic queries like "*" when you already have a sufficient result. ' +
        'If a tool returns empty results or a budget limit, ask ONE clarifying question and stop.';

      // Only stop on send_email. commit_calendar_change must not be terminal so the
      // model always gets a final response turn with the commit result.
      const stopConditions = [stopWhenToolCalled('send_email')];

      // Disable Gemini thinking for reminder and alert notification flows (These flows dont need much thinking, so it is faster, cheaper and lower latency now).
      const isNotificationFlow =
        input.userRequest.startsWith('REMINDER DELIVERY:') ||
        input.userRequest.startsWith('ALERT NOTIFICATION:');
      const providerOptions = isNotificationFlow
        ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
        : undefined;

      const { text, toolCalls, toolResults, steps, toolBudget } = await callTextWithTools({
        model: models.execAgent(),
        system: systemPrompt,
        prompt,
        tools: timedTools,
        maxSteps: MESSAGING_MAX_STEPS,
        maxToolCallsTotal: MESSAGING_MAX_TOOL_CALLS_TOTAL,
        maxToolCallsPerTool: MESSAGING_TOOL_BUDGETS_BASE,
        deadlineMs: MESSAGING_DEADLINE_MS,
        stopWhen: stopConditions,
        temperature: 0.7,
        op: `${resolvedChannel}.executive`,
        concurrency: { key: `${resolvedChannel}.executive`, maxConcurrency: 4 },
        retry: { maxAttempts: 3, baseDelayMs: 500 },
        abortSignal: toolAbortSignal,
        providerOptions,
      });

      // Collect telemetry
      const toolNames = collectToolNamesFromExecution({ toolCalls, toolResults, steps });
      logger.info(`[executiveAgent] Tools used: ${Array.from(toolNames).join(', ') || '(none)'}`);
      logger.info(
        `[executiveAgent] Completed in ${Date.now() - startTime}ms totalTools=${toolBudget?.totalCalls ?? 0}`,
      );

      // Clean up response text. Model can be empty when we stop on send_email or
      // budget-exceeded before it could reply.
      let response = (text || '').trim();
      if (!response) {
        response = buildTerminalFallbackResponse(toolResults);
        logger.info(`[executiveAgent] Empty model text, using fallback: ${response}`);
      }

      // Build metadata with tool call information for conversation history
      const metadata: Record<string, Prisma.InputJsonValue> = {};
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        metadata.toolCalls = toolCalls as Prisma.InputJsonValue;
      }
      if (Array.isArray(toolResults) && toolResults.length > 0) {
        metadata.toolResults = toolResults as Prisma.InputJsonValue;
      }
      if (Array.isArray(steps) && steps.length > 0) {
        metadata.steps = steps as Prisma.InputJsonValue;
      }
      if (toolBudget) {
        metadata.toolBudget = toolBudget as Prisma.InputJsonValue;
      }

      return {
        response,
        memoryStored: this.memoryStored,
        status: 'ok',
        metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonObject) : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const isAbort =
        (error instanceof LlmError && error.code === 'abort') ||
        (error instanceof Error &&
          (error.name === 'AbortError' || /aborted|abort|cancel|superseded/i.test(message)));
      const isDeadline = /deadline exceeded/i.test(message);

      if (isAbort && !isDeadline) {
        // Common in WhatsApp: user sends a second message which supersedes the in-flight run.
        // Bubble up so the message processor can swallow and avoid confusing fallback text.
        logger.debug(`[executiveAgent] Run aborted: ${message}`);
        throw error;
      }

      logger.error(`[executiveAgent] Error: ${message}`);

      // Graceful fallback response
      return {
        response: isDeadline
          ? 'I hit a time limit. Should I check your inbox or your calendar?'
          : "Hmm, something went wrong on my end. Can you try that again?",
        memoryStored: false,
        status: 'fallback',
        error: message,
      };
    } finally {
      toolAbort.cleanup();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

let _agentInstance: ExecutiveAgent | null = null;

/**
 * Gets the singleton ExecutiveAgent instance.
 */
export function getExecutiveAgent(): ExecutiveAgent {
  if (!_agentInstance) {
    _agentInstance = new ExecutiveAgent();
  }
  return _agentInstance;
}
