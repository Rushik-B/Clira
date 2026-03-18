import crypto from 'crypto';
import { createDeadlineController } from '@/lib/ai/callLlm';
import { logger } from '@/lib/logger';
import { extractToolCallsSummary } from '@/lib/ai/agents/executiveToolCallSummary';
import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import {
  CALENDAR_REMINDER_MAX_OVERRIDES,
  type CalendarEventDraftDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import {
  formatDateTimeInTimeZone,
  normalizeIsoDateInputToUtc,
} from '@/lib/utils/timezone';
import type {
  ExecutivePromptMessage,
  ExecutiveTurnFeatures,
  ExecutiveWorkingState,
  ToolPackId,
} from './types';
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

export function extractLatestToolResult(
  toolResults: unknown,
  toolName: string,
): Record<string, unknown> | null {
  if (!Array.isArray(toolResults)) return null;

  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const candidate = toolResults[i];
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const name = record.toolName ?? record.name ?? record.tool;
    if (name !== toolName) continue;

    // AI SDK v5+ uses `output`; older versions used `result`. Support both.
    const payload = record.result ?? record.output;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  }

  return null;
}

export function unwrapToolExecutionResult(
  result: unknown,
): Record<string, unknown> | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }

  const record = result as Record<string, unknown>;
  if (record.result && typeof record.result === 'object' && !Array.isArray(record.result)) {
    return record.result as Record<string, unknown>;
  }
  if (record.output && typeof record.output === 'object' && !Array.isArray(record.output)) {
    return record.output as Record<string, unknown>;
  }

  return record;
}

export function extractUserFacingToolText(
  toolName: string,
  result: unknown,
): string | null {
  const resolved = unwrapToolExecutionResult(result);
  if (!resolved) return null;

  if (toolName === 'send_email') {
    if (resolved.success === true) return 'Sent!';
    const message = resolved.message;
    return typeof message === 'string' && message.trim() ? message : null;
  }

  if (toolName === 'deliver_content_reference') {
    const message = resolved.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (resolved.success === true) return 'Delivered.';
    return null;
  }

  if (toolName === 'commit_calendar_change') {
    const message = resolved.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (resolved.ok === true) return 'Calendar change completed.';
    return null;
  }

  if (toolName === 'commit_mcp_action' || toolName === 'cancel_mcp_action') {
    const message = resolved.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (resolved.ok === true) return 'External action completed.';
    return null;
  }

  if (toolName === 'plan_mcp_action') {
    const previewText = typeof resolved.previewText === 'string' ? resolved.previewText : null;
    if (previewText && previewText.trim()) return previewText;

    const message = resolved.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (resolved.ok === true) return 'I staged that external action.';
    return null;
  }

  if (toolName === 'plan_calendar_change') {
    const previewText =
      (typeof resolved.previewText === 'string' ? resolved.previewText : null) ??
      (typeof resolved.plan === 'object' &&
      resolved.plan !== null &&
      typeof (resolved.plan as Record<string, unknown>).userPreviewText === 'string'
        ? ((resolved.plan as Record<string, unknown>).userPreviewText as string)
        : null);
    if (typeof previewText === 'string' && previewText.trim()) return previewText;

    const message = resolved.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (resolved.ok === true) return 'I planned that calendar change.';
    return null;
  }

  return null;
}

export function extractRequestedMcpConnectionIdsFromExecution(params: {
  toolResults: unknown;
  steps?: unknown;
}): string[] {
  const result = extractLatestToolResultFromExecution({
    toolResults: params.toolResults,
    steps: params.steps,
    toolName: 'request_mcp_server_tools',
  });

  const requestedConnectionIds = Array.isArray(result?.requestedConnectionIds)
    ? result.requestedConnectionIds.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      )
    : [];

  return Array.from(new Set(requestedConnectionIds));
}

export function extractRequestedPackIdsFromExecution(params: {
  toolResults: unknown;
  steps?: unknown;
}): ToolPackId[] {
  const result = extractLatestToolResultFromExecution({
    toolResults: params.toolResults,
    steps: params.steps,
    toolName: 'request_tool_pack_exposure',
  });

  const requestedPackIds = Array.isArray(result?.requestedPackIds)
    ? result.requestedPackIds.filter(
        (value): value is ToolPackId =>
          typeof value === 'string' &&
          [
            'safe_context_pack',
            'calendar_mutation_pack',
            'reminder_alert_pack',
            'settings_mutation_pack',
            'email_send_pack',
          ].includes(value),
      )
    : [];

  return Array.from(new Set(requestedPackIds));
}

function extractLatestToolResultFromExecution(params: {
  toolResults: unknown;
  steps?: unknown;
  toolName: string;
}): Record<string, unknown> | null {
  const direct = extractLatestToolResult(params.toolResults, params.toolName);
  if (direct) return direct;

  if (!Array.isArray(params.steps)) return null;

  for (let i = params.steps.length - 1; i >= 0; i -= 1) {
    const step = params.steps[i];
    if (!step || typeof step !== 'object') continue;
    const stepToolResults = (step as Record<string, unknown>).toolResults;
    const nested = extractLatestToolResult(stepToolResults, params.toolName);
    if (nested) return nested;
  }

  return null;
}

type TerminalFallbackResolution = {
  response: string;
  source: 'tool_result' | 'working_state' | 'generic_fallback';
};

function normalizeSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCaseItemLabel(value: string): string {
  const normalized = normalizeSentence(value).replace(/[:.]+$/g, '');
  if (!normalized) return '';

  return normalized
    .split(/\s+/)
    .map((part) => {
      if (/^[A-Z0-9-]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function isDueDateLookupRequest(userRequest: string | undefined): boolean {
  if (!userRequest) return false;
  return /\bdue\b|\bdeadline\b|\bwhen is it due\b/i.test(userRequest);
}

function deriveCoursePrefix(userRequest: string | undefined, subject: string, bodyText: string): string | null {
  const combined = `${userRequest ?? ''} ${subject} ${bodyText}`;
  const match = combined.match(/\bCMPT\s*([0-9]{3,4})\b/i) ?? combined.match(/\b([0-9]{3,4})\b/);
  if (!match) return null;
  const courseNumber = match[1] ?? match[0];
  if (!/^[0-9]{3,4}$/.test(courseNumber)) return null;
  return `CMPT ${courseNumber}`;
}

function extractItemLabel(subject: string, bodyText: string): string | null {
  const combined = `${subject}\n${bodyText}`;
  const itemMatch = combined.match(/\b(assignment\s+\d+|project proposal|project milestone|milestone\s+\d+|assignment|project|milestone)\b/i);
  if (!itemMatch) return null;
  const label = titleCaseItemLabel(itemMatch[1]);
  return label || null;
}

function extractDueDateAnswerFromText(
  bodyText: string,
  subject: string,
  userRequest: string | undefined,
): string | null {
  const normalizedBody = normalizeSentence(bodyText);
  if (!normalizedBody) return null;

  const dueDateMatch =
    normalizedBody.match(/\b(?:it\s+will\s+be\s+)?due\s+on\s+([^.!\n]+)/i) ??
    normalizedBody.match(/\bis\s+due\s+on\s+([^.!\n]+)/i) ??
    normalizedBody.match(/\bdue\s+([^.!\n]+)/i);
  if (!dueDateMatch) return null;

  const duePhrase = normalizeSentence(dueDateMatch[1]).replace(/[.]+$/g, '');
  if (!duePhrase) return null;

  const itemLabel = extractItemLabel(subject, normalizedBody);
  const coursePrefix = deriveCoursePrefix(userRequest, subject, normalizedBody);
  if (itemLabel && coursePrefix && !itemLabel.toLowerCase().includes(coursePrefix.toLowerCase())) {
    return `${coursePrefix} ${itemLabel} is due on ${duePhrase}.`;
  }
  if (itemLabel) {
    return `${itemLabel} is due on ${duePhrase}.`;
  }
  if (coursePrefix) {
    return `${coursePrefix} is due on ${duePhrase}.`;
  }
  return `It is due on ${duePhrase}.`;
}

function extractSearchInboxContextAnswer(
  result: Record<string, unknown> | null,
  userRequest: string | undefined,
): string | null {
  if (!result || !isDueDateLookupRequest(userRequest)) return null;

  const expandedThreads = Array.isArray(result.expandedThreads)
    ? result.expandedThreads.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === 'object' && !Array.isArray(value),
      )
    : [];

  for (const thread of expandedThreads) {
    const messages = Array.isArray(thread.messages)
      ? thread.messages.filter(
          (value): value is Record<string, unknown> =>
            Boolean(value) && typeof value === 'object' && !Array.isArray(value),
        )
      : [];

    for (const message of messages) {
      const bodyText = typeof message.bodyText === 'string' ? message.bodyText : '';
      const subject = typeof message.subject === 'string' ? message.subject : '';
      const answer = extractDueDateAnswerFromText(bodyText, subject, userRequest);
      if (answer) return answer;
    }
  }

  return null;
}

function extractSearchCalendarAnswer(
  result: Record<string, unknown> | null,
  userRequest: string | undefined,
): string | null {
  if (!result || !isDueDateLookupRequest(userRequest)) return null;

  const events = Array.isArray(result.events)
    ? result.events.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === 'object' && !Array.isArray(value),
      )
    : [];
  if (events.length === 0) return null;

  const event = events[0]!;
  const name = typeof event.name === 'string' ? normalizeSentence(event.name) : 'That item';
  const start = typeof event.start === 'string' ? normalizeSentence(event.start) : null;
  if (!start) return null;
  return `${name} is due on ${start}.`;
}

function extractToolBackedSafeContextResponse(params: {
  toolResults: unknown;
  steps?: unknown;
  userRequest?: string;
}): string | null {
  const inboxResult = extractLatestToolResultFromExecution({
    toolResults: params.toolResults,
    steps: params.steps,
    toolName: 'search_inbox_context',
  });
  const inboxAnswer = extractSearchInboxContextAnswer(inboxResult, params.userRequest);
  if (inboxAnswer) return inboxAnswer;

  const calendarResult = extractLatestToolResultFromExecution({
    toolResults: params.toolResults,
    steps: params.steps,
    toolName: 'search_calendar',
  });
  return extractSearchCalendarAnswer(calendarResult, params.userRequest);
}

function joinHumanList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function summarizeWorkingStateCoverage(
  completedSteps: readonly string[],
  selectedPack?: ToolPackId | null,
): string[] {
  const coverage = new Set<string>();

  for (const step of completedSteps) {
    if (
      step === 'search_inbox_context' ||
      step === 'list_inbox_emails' ||
      step === 'read_email_attachment_content' ||
      step === 'read_email_pdf_attachment'
    ) {
      coverage.add('inbox');
      continue;
    }

    if (
      step === 'search_calendar' ||
      step === 'check_calendar' ||
      step === 'plan_calendar_change' ||
      step === 'commit_calendar_change'
    ) {
      coverage.add('calendar');
      continue;
    }

    if (step === 'search_memory' || step === 'append_to_supermemory') {
      coverage.add('memory');
      continue;
    }

    if (
      step === 'add_reminder' ||
      step === 'list_reminders' ||
      step === 'snooze_reminder' ||
      step === 'dismiss_reminder' ||
      step === 'cancel_reminder' ||
      step === 'add_email_alert' ||
      step === 'remove_email_alert' ||
      step === 'list_email_alerts'
    ) {
      coverage.add('reminders');
      continue;
    }

    if (step === 'send_email') {
      coverage.add('draft');
      continue;
    }
  }

  if (coverage.size === 0) {
    if (selectedPack === 'safe_context_pack') return ['context'];
    if (selectedPack === 'reminder_alert_pack') return ['reminders'];
    if (selectedPack === 'media_delivery_pack') return ['delivery'];
    if (selectedPack === 'settings_mutation_pack') return ['settings'];
  }

  return [...coverage];
}

function buildTimedOutWorkingStateResponse(context?: {
  selectedPack?: ToolPackId | null;
  workingState?: ExecutiveWorkingState | null;
  timedOut?: boolean;
}): string | null {
  if (!context?.timedOut) return null;

  const workingState = context.workingState;
  const coverage = summarizeWorkingStateCoverage(
    workingState?.completedSteps ?? [],
    context.selectedPack,
  );
  const facts = (workingState?.factsLearned ?? [])
    .map((fact) => fact.trim())
    .filter((fact) => fact.length > 0)
    .slice(0, 2);
  const lastToolSummary = workingState?.artifacts.lastToolSummary?.trim();

  const sentences: string[] = [];
  if (coverage.length > 0) {
    sentences.push(`I hit a time limit, but I did check your ${joinHumanList(coverage)}.`);
  } else {
    sentences.push('I hit a time limit before I could finish cleanly.');
  }

  if (facts.length > 0) {
    sentences.push(`What I found so far: ${facts.join(' ')}`);
  } else if (lastToolSummary) {
    sentences.push(`I got as far as ${lastToolSummary}.`);
  }

  if (context.selectedPack === 'safe_context_pack') {
    sentences.push(
      'Give me one narrower clue, like the sender, exact phrase, or timeframe, and I will keep going.',
    );
    return sentences.join(' ');
  }

  if (context.selectedPack === 'reminder_alert_pack') {
    sentences.push(
      'Tell me the exact item or timing you want next, and I will continue from there.',
    );
    return sentences.join(' ');
  }

  if (context.selectedPack === 'media_delivery_pack') {
    sentences.push('Tell me which file and destination you want, and I will retry the delivery.');
    return sentences.join(' ');
  }

  if (context.selectedPack === 'calendar_mutation_pack') {
    sentences.push('Tell me the exact event or time to focus on, and I will continue from there.');
    return sentences.join(' ');
  }

  if (context.selectedPack === 'email_send_pack') {
    sentences.push('If you still want this sent, tell me what to keep or change in the draft.');
    return sentences.join(' ');
  }

  sentences.push('Ask again with one tighter detail, and I will pick it up from there.');
  return sentences.join(' ');
}

export function resolveTerminalFallbackResponse(
  toolResults: unknown,
  steps?: unknown,
  context?: {
    selectedPack?: ToolPackId | null;
    workingState?: ExecutiveWorkingState | null;
    turnFeatures?: ExecutiveTurnFeatures | null;
    userRequest?: string | null;
    timedOut?: boolean;
  },
): TerminalFallbackResolution {
  const explicitToolResponse = (() => {
    const sendResult = extractLatestToolResultFromExecution({
      toolResults,
      steps,
      toolName: 'send_email',
    });
    if (sendResult) {
      const response = extractUserFacingToolText('send_email', sendResult);
      return response ?? 'I could not send that email. Please try again.';
    }

    const deliveryResult = extractLatestToolResultFromExecution({
      toolResults,
      steps,
      toolName: 'deliver_content_reference',
    });
    if (deliveryResult) {
      const response = extractUserFacingToolText('deliver_content_reference', deliveryResult);
      return response ?? 'I found the file, but I could not deliver it.';
    }

    const commitResult = extractLatestToolResultFromExecution({
      toolResults,
      steps,
      toolName: 'commit_calendar_change',
    });
    if (commitResult) {
      const response = extractUserFacingToolText('commit_calendar_change', commitResult);
      return response ?? 'I could not complete that calendar change.';
    }

    const commitMcpResult = extractLatestToolResultFromExecution({
      toolResults,
      steps,
      toolName: 'commit_mcp_action',
    });
    if (commitMcpResult) {
      const response = extractUserFacingToolText('commit_mcp_action', commitMcpResult);
      return response ?? 'I could not complete that external action.';
    }

    const cancelMcpResult = extractLatestToolResultFromExecution({
      toolResults,
      steps,
      toolName: 'cancel_mcp_action',
    });
    if (cancelMcpResult) {
      const response = extractUserFacingToolText('cancel_mcp_action', cancelMcpResult);
      return response ?? 'I could not cancel that external action.';
    }

    const planResult = extractLatestToolResultFromExecution({
      toolResults,
      steps,
      toolName: 'plan_calendar_change',
    });
    if (planResult) {
      const response = extractUserFacingToolText('plan_calendar_change', planResult);
      return response ?? 'I could not plan that calendar change. Please try again.';
    }

    const planMcpResult = extractLatestToolResultFromExecution({
      toolResults,
      steps,
      toolName: 'plan_mcp_action',
    });
    if (planMcpResult) {
      const response = extractUserFacingToolText('plan_mcp_action', planMcpResult);
      return response ?? 'I could not stage that external action. Please try again.';
    }

    return null;
  })();

  if (explicitToolResponse) {
    return {
      response: explicitToolResponse,
      source: 'tool_result',
    };
  }

  const safeContextAnswer = extractToolBackedSafeContextResponse({
    toolResults,
    steps,
    userRequest: context?.userRequest ?? undefined,
  });
  if (safeContextAnswer) {
    return {
      response: safeContextAnswer,
      source: 'tool_result',
    };
  }

  const pendingChangeId = context?.workingState?.artifacts.pendingCalendarChangeId;
  const phase = context?.workingState?.phase;
  const workingStateUserFacingText = context?.workingState?.artifacts.lastUserFacingText?.trim();
  if (workingStateUserFacingText) {
    return {
      response: workingStateUserFacingText,
      source: 'working_state',
    };
  }

  const timedOutResponse = buildTimedOutWorkingStateResponse(context);
  if (timedOutResponse) {
    return {
      response: timedOutResponse,
      source: 'working_state',
    };
  }

  const isCalendarMutationFallbackTurn =
    context?.selectedPack === 'calendar_mutation_pack' ||
    Boolean(pendingChangeId) ||
    phase === 'await_approval' ||
    context?.turnFeatures?.pendingCalendarConfirmIntent === true ||
    context?.turnFeatures?.pendingCalendarCancelIntent === true;

  if (isCalendarMutationFallbackTurn) {
    if (phase === 'await_approval' || pendingChangeId) {
      return {
        response: 'I have that calendar change staged. Reply "confirm" to apply it, or tell me what to change.',
        source: 'working_state',
      };
    }

    if (
      context?.turnFeatures?.pendingCalendarConfirmIntent ||
      context?.turnFeatures?.pendingCalendarCancelIntent
    ) {
      return {
        response: 'I still have that calendar change in flight, but the final step did not finish cleanly. Reply "confirm" to retry it or "cancel" to drop it.',
        source: 'working_state',
      };
    }

    if (phase === 'clarify') {
      return {
        response: 'I need one more detail to finish that calendar change. Tell me which event or time you want.',
        source: 'working_state',
      };
    }

    return {
      response: 'Tell me the calendar change you want, and I\'ll preview it before I do anything.',
      source: 'working_state',
    };
  }

  if (context?.selectedPack === 'email_send_pack') {
    if (context.turnFeatures?.explicitSendApproval) {
      return {
        response: 'I still have the draft. Reply "send it" and I\'ll retry the final send.',
        source: 'working_state',
      };
    }
    return {
      response: 'I still have the draft ready. Say "send it" when you want me to send it.',
      source: 'working_state',
    };
  }

  if (context?.selectedPack === 'safe_context_pack') {
    return {
      response: 'I did not finish that cleanly. Ask again and I\'ll re-check the relevant context.',
      source: 'generic_fallback',
    };
  }

  return {
    response: 'I did not finish that cleanly. Ask again and I\'ll retry it.',
    source: 'generic_fallback',
  };
}

export function buildTerminalFallbackResponse(
  toolResults: unknown,
  steps?: unknown,
  context?: {
    selectedPack?: ToolPackId | null;
    workingState?: ExecutiveWorkingState | null;
    turnFeatures?: ExecutiveTurnFeatures | null;
    userRequest?: string | null;
    timedOut?: boolean;
  },
): string {
  return resolveTerminalFallbackResponse(toolResults, steps, context).response;
}

const TIMESTAMP_METADATA_LINE_PATTERN = /^\[Timestamp\]\s+/i;
const TOOL_HISTORY_METADATA_LINE_PATTERN = /^\[Tool history\]\s+/i;

function normalizeAssistantResponseWhitespace(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

export function stripInternalMetadataFromAssistantResponse(
  response: string,
): { response: string; stripped: boolean; claimedToolHistoryNames: string[] } {
  if (!response) {
    return { response: '', stripped: false, claimedToolHistoryNames: [] };
  }

  const cleanedLines: string[] = [];
  const timestampBlockPayloadLines: string[] = [];
  const claimedToolHistoryNames: string[] = [];
  let stripped = false;
  let insideTimestampBlock = false;

  for (const line of response.split('\n')) {
    const trimmed = line.trim();

    if (TIMESTAMP_METADATA_LINE_PATTERN.test(trimmed)) {
      stripped = true;
      insideTimestampBlock = true;
      continue;
    }

    if (TOOL_HISTORY_METADATA_LINE_PATTERN.test(trimmed)) {
      stripped = true;
      const toolsPart = trimmed.replace(TOOL_HISTORY_METADATA_LINE_PATTERN, '');
      for (const name of toolsPart.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)) {
        claimedToolHistoryNames.push(name);
      }
      continue;
    }

    if (insideTimestampBlock) {
      if (trimmed.length === 0) {
        insideTimestampBlock = false;
      } else {
        timestampBlockPayloadLines.push(line);
      }
      stripped = true;
      continue;
    }

    cleanedLines.push(line);
  }

  let cleanedResponse = normalizeAssistantResponseWhitespace(cleanedLines.join('\n'));
  if (!cleanedResponse && timestampBlockPayloadLines.length > 0) {
    cleanedResponse = normalizeAssistantResponseWhitespace(timestampBlockPayloadLines.join('\n'));
  }

  return { response: cleanedResponse, stripped, claimedToolHistoryNames };
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

function parseTimedEventInstant(value: { dateTime: string; timeZone?: string | null }): Date | null {
  try {
    return normalizeIsoDateInputToUtc(
      value.dateTime,
      value.timeZone?.trim() || 'UTC',
      'start',
    );
  } catch {
    return null;
  }
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
      const dt = parseTimedEventInstant(timeValue);
      if (!dt || Number.isNaN(dt.getTime())) return { ok: false, message: 'Invalid dateTime format.' };
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

    const startDt = parseTimedEventInstant(start);
    const endDt = parseTimedEventInstant(end);
    if (!startDt || !endDt || Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
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

export function resolveGoogleEventTime(
  value: GoogleEventTime | null | undefined,
): { dateTime: string; timeZone?: string | null } | { date: string } | null {
  if (!value) return null;
  if (typeof value.dateTime === 'string' && value.dateTime.trim()) {
    return {
      dateTime: value.dateTime,
      timeZone: value.timeZone,
    };
  }
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
      const startDt = parseTimedEventInstant(currentStart);
      const endDt = parseTimedEventInstant(end);
      if (!startDt || !endDt) return { ok: false, message: 'Invalid dateTime format.' };
      const startMs = startDt.getTime();
      const endMs = endDt.getTime();
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

      const currentStartDt = parseTimedEventInstant(currentStart);
      const currentEndDt = parseTimedEventInstant(currentEnd);
      if (!currentStartDt || !currentEndDt) {
        return { ok: false, message: 'Current event has invalid dateTime values.' };
      }
      const currentStartMs = currentStartDt.getTime();
      const currentEndMs = currentEndDt.getTime();

      const durationMs = currentEndMs - currentStartMs;
      if (durationMs <= 0) return { ok: false, message: 'Current event duration is invalid.' };

      const newStartDt = parseTimedEventInstant(start);
      if (!newStartDt) return { ok: false, message: 'Invalid dateTime format.' };
      const newStartMs = newStartDt.getTime();

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

/**
 * Google Calendar API allows at most 5 reminder overrides per event.
 * Truncate overrides so we never send more than the limit.
 */
export function applyGoogleReminderLimit(draft: CalendarEventDraftDTO): CalendarEventDraftDTO {
  const overrides = draft.reminders?.overrides;
  if (!overrides || overrides.length <= CALENDAR_REMINDER_MAX_OVERRIDES) return draft;
  return {
    ...draft,
    reminders: {
      ...draft.reminders!,
      overrides: overrides.slice(0, CALENDAR_REMINDER_MAX_OVERRIDES),
    },
  };
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

function formatHistoryTimestamp(createdAt: Date, userTimezone?: string): string {
  if (!userTimezone) {
    return createdAt.toISOString();
  }

  return formatDateTimeInTimeZone(createdAt, userTimezone);
}

/**
 * Formats prior conversation turns as deterministic messages so the shared
 * prefix stays stable across turns and can benefit from prompt caching.
 */
export function formatConversationHistoryAsMessages(
  history: ConversationMessageDTO[],
  options?: { userTimezone?: string },
): ExecutivePromptMessage[] {
  if (!history || history.length === 0) {
    return [];
  }

  return history
    .slice(-15)
    .map((msg) => {
      const normalizedRole = msg.role === 'USER'
        ? 'user'
        : 'assistant';
      const timestamp = formatHistoryTimestamp(new Date(msg.createdAt), options?.userTimezone);
      const contentLines = [
        `[Timestamp] ${timestamp}`,
        truncate(msg.content, 500),
      ];

      if (msg.role === 'ASSISTANT' && msg.metadata) {
        const toolCalls = extractToolCallsSummary(msg.metadata);
        if (toolCalls) {
          contentLines.push('', `[Tool history] ${toolCalls}`);
        }
      }

      return {
        role: normalizedRole,
        content: contentLines.join('\n'),
      };
    });
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
  return input.channel ?? input.progressContext?.channel ?? 'whatsapp';
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

  const extractToolName = (item: Record<string, unknown>): string | null => {
    const candidate =
      item.toolName ??
      item.name ??
      item.tool ??
      (item.function &&
      typeof item.function === 'object' &&
      (item.function as Record<string, unknown>).name) ??
      item.functionName;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  };

  const collectFromArray = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const candidate = extractToolName(item as Record<string, unknown>);
      if (candidate) {
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

export function collectExecutedToolNames({
  toolCalls,
  toolResults,
  steps,
  toolBudget,
  availableToolNames,
}: {
  toolCalls: unknown;
  toolResults: unknown;
  steps: unknown;
  toolBudget?: { perTool?: Record<string, number> };
  availableToolNames?: readonly string[];
}): Set<string> {
  const budgetPerTool = toolBudget?.perTool ?? null;
  if (budgetPerTool && typeof budgetPerTool === 'object') {
    const budgetNames = Object.entries(budgetPerTool)
      .filter(([, count]) => typeof count === 'number' && count > 0)
      .map(([toolName]) => toolName);
    if (budgetNames.length > 0) {
      return new Set(budgetNames);
    }
  }

  const observed = collectToolNamesFromExecution({ toolCalls, toolResults, steps });
  if (!availableToolNames || availableToolNames.length === 0) {
    return observed;
  }

  const available = new Set(availableToolNames);
  return new Set(Array.from(observed).filter((toolName) => available.has(toolName)));
}

export function collectOutOfPackToolNames({
  toolCalls,
  toolResults,
  steps,
  availableToolNames,
}: {
  toolCalls: unknown;
  toolResults: unknown;
  steps: unknown;
  availableToolNames: readonly string[];
}): Set<string> {
  const available = new Set(availableToolNames);
  const observed = collectToolNamesFromExecution({ toolCalls, toolResults, steps });
  return new Set(
    Array.from(observed).filter((toolName) => !available.has(toolName)),
  );
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

const DEFER_ON_STALE_TOOLS = new Set([
  'request_tool_pack_exposure',
  'request_mcp_server_tools',
  'send_email',
  'deliver_content_reference',
  'plan_calendar_change',
  'commit_calendar_change',
  'plan_mcp_action',
  'commit_mcp_action',
  'cancel_mcp_action',
  'add_reminder',
  'snooze_reminder',
  'dismiss_reminder',
  'cancel_reminder',
  'add_email_alert',
  'remove_email_alert',
]);

const DEFER_ON_PENDING_STEER_TOOLS = new Set([
  'send_email',
  'deliver_content_reference',
  'commit_calendar_change',
  'commit_mcp_action',
]);

function buildStaleRunDeferredResult(toolName: string): Record<string, unknown> {
  if (
    toolName === 'plan_calendar_change' ||
    toolName === 'commit_calendar_change' ||
    toolName === 'plan_mcp_action' ||
    toolName === 'commit_mcp_action' ||
    toolName === 'cancel_mcp_action'
  ) {
    return {
      ok: false,
      status: 'deferred',
      error: 'superseded_by_newer_message',
      message: 'A newer user message arrived, so this action was deferred.',
    };
  }

  return {
    success: false,
    status: 'deferred',
    error: 'superseded_by_newer_message',
    message: 'A newer user message arrived, so this action was deferred.',
  };
}

function buildPendingSteerDeferredResult(toolName: string): Record<string, unknown> {
  const message = 'A new user correction arrived, so this action was deferred.';
  if (toolName === 'commit_calendar_change' || toolName === 'commit_mcp_action') {
    return {
      ok: false,
      status: 'deferred',
      error: 'pending_steer_event',
      message,
    };
  }

  return {
    success: false,
    status: 'deferred',
    error: 'pending_steer_event',
    message,
  };
}

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
  isRunCurrent,
  hasPendingSteer,
  onToolResult,
}: {
  tools: Record<string, unknown>;
  agentStartedAt: number;
  timeLeftMs: () => number | null;
  getLastProgressSentAt: () => number;
  setLastProgressSentAt: (sentAt: number) => void;
  isRunCurrent: () => Promise<boolean>;
  hasPendingSteer?: () => Promise<boolean>;
  onToolResult?: (toolName: string, args: unknown, result: unknown, observedAtMs: number) => void;
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
        if (!(await isRunCurrent())) {
          if (DEFER_ON_STALE_TOOLS.has(toolName)) {
            return buildStaleRunDeferredResult(toolName);
          }
          throw new Error('superseded_by_newer_message');
        }

        if (
          hasPendingSteer &&
          DEFER_ON_PENDING_STEER_TOOLS.has(toolName) &&
          (await hasPendingSteer())
        ) {
          const now = Date.now();
          const lastProgressSentAt = getLastProgressSentAt();
          const timing: ToolTimingMetadata = {
            elapsed_ms: now - agentStartedAt,
            ms_since_last_progress_update: now - (lastProgressSentAt || agentStartedAt),
            time_left_ms: timeLeftMs(),
          };
          const deferredResult = attachTimingMetadata(
            buildPendingSteerDeferredResult(toolName),
            timing,
          );
          onToolResult?.(toolName, args, deferredResult, now);
          return deferredResult;
        }

        const result = await execute(args);
        const now = Date.now();

        if (toolName === 'send_progress_update') {
          if (didSendProgressUpdate(result)) {
            setLastProgressSentAt(now);
          }
          onToolResult?.(toolName, args, result, now);
          return result;
        }

        const lastProgressSentAt = getLastProgressSentAt();
        const timing: ToolTimingMetadata = {
          elapsed_ms: now - agentStartedAt,
          ms_since_last_progress_update: now - (lastProgressSentAt || agentStartedAt),
          time_left_ms: timeLeftMs(),
        };

        const timedResult = attachTimingMetadata(result, timing);
        onToolResult?.(toolName, args, timedResult, now);
        return timedResult;
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
  maxBudgetMs,
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
  /** Optional hard cap for this subagent even when more run time remains. */
  maxBudgetMs?: number;
  /** When true with minBudgetMs, use minBudgetMs as-is without capping by available time. */
  uncappedBudget?: boolean;
  run: (params: { abortSignal?: AbortSignal; deadlineAt?: number; budgetMs?: number }) => Promise<T>;
}): Promise<T | ReturnType<typeof buildToolBudgetExceededResult>> {
  const availableBudgetMs =
    timeLeftMs !== null ? Math.max(0, timeLeftMs - MESSAGING_TOOL_RESPONSE_BUFFER_MS) : null;
  let { budgetMs, tooLow } = computeSubagentBudget(timeLeftMs, toolCallIndex);
  if (typeof minBudgetMs === 'number' && budgetMs !== null && budgetMs < minBudgetMs) {
    if (uncappedBudget) {
      budgetMs = minBudgetMs;
    } else {
      const available = availableBudgetMs ?? 0;
      budgetMs = Math.min(minBudgetMs, available);
    }
  }

  if (typeof maxBudgetMs === 'number' && budgetMs !== null) {
    budgetMs = Math.min(budgetMs, maxBudgetMs);
  }

  // Never grant a subagent more time than the parent run has left after reserving
  // a small response buffer. This prevents late-turn retries from firing when the
  // enclosing run is already effectively out of time.
  if (availableBudgetMs !== null && budgetMs !== null) {
    budgetMs = Math.min(budgetMs, availableBudgetMs);
  }

  tooLow = budgetMs !== null && budgetMs < MESSAGING_MIN_SUBAGENT_BUDGET_MS;

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
