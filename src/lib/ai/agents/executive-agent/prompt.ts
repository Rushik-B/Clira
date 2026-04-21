import { readPromptFile } from '@/lib/prompts';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import type {
  CalendarEventDraftDTO,
  CalendarMutationOperationDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import type { PendingCalendarChangePayload } from '@/lib/ai/agents/executiveCalendarMutationHelpers';
import {
  gatherMemoryContextForReply,
} from '@/lib/services/core/replyContextTools';
import { isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import {
  formatConversationHistoryAsMessages,
  formatRelativeTime,
} from './helpers';
import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type {
  ExecutiveAgentInput,
  PromptContext,
} from './types';
import {
  getDateOnlyInTimezone,
  normalizeIsoDateInputToUtc,
  formatDateTimeInTimeZone,
} from '@/lib/utils/timezone';
import { logger } from '@/lib/logger';
import { buildRunContextPromptFragment } from '@/lib/services/messaging-orchestration';
import {
  fetchReplyPipelineSnapshot,
  formatReplyPipelineInstruction,
} from './replyPipelineContext';

export const EXECUTIVE_AGENT_PROMPT_VERSION = 'ea-prompt-v25';

// Injected only when the exec agent is activated by a system trigger (alert or reminder),
// not by a user message. Tells the agent to reason with full context but output selectively.
const NOTIFICATION_DELIVERY_MODE_SECTION = `## Notification Delivery Mode
You are responding to a system-triggered notification, not a user message. The user did not initiate this turn — you are interrupting them.

Output contract for this turn:
- Use all available context (memory, inbox, calendar, reply pipeline) for your internal reasoning and tool calls. That is the work.
- Your final output is the notification itself: what happened, and why it matters to this user specifically.
- Target length: for a single reminder, 1-2 sentences. For a batch (multiple reminders in one delivery), cover every listed item in one message. When several distinct items need coverage and prose would be a mess, a short bulleted list is fine; otherwise prefer grounded prose. Do not drop or merge items into vague prose; each item deserves clear coverage.
- Duplicate or overlapping reminders: if two or more items clearly refer to the same thing (same meeting or link, same deadline, same person to contact, same subscription), recognize that and say it once. Merge redundant lines into a single clear nudge instead of repeating nearly identical text. If titles differ slightly but the substance is the same, pick one phrasing and do not enumerate duplicates as separate items.
- If reminder metadata includes a sequence like 1/5 and an escalation stage like early, mid, or final, use that to shape tone progression. Earlier steps should feel lighter. Later steps should feel firmer and more urgent. The sequence count and stage labels are internal metadata — NEVER surface them in the user-facing text (no "reminder 3/20", no "1/5 final", no "mid early"). Do not parrot the metadata at all.
- Sequence deliveries must evolve, not repeat. If this is the third nudge about the same thing, change the angle, length, or framing from previous deliveries. Never send the same sentence with only the count swapped, and never reuse the previous delivery's opener.
- No forwarded-email texture. Do NOT append synthetic link footers or tracker URLs (e.g. shaped like \`view-email.cx/...\`, \`view-link.cx/...\`, \`join-meeting.cx/...\`, \`make-payment.cx/...\`, \`read-more.cx/...\`, \`authorize.cx/...\`, etc). Do NOT open with a shouted banner like "URGENT:" / "ALERT:" / "SECURITY ALERT:" / "HEADS UP:". Do NOT dump a default "you need to:" bulleted checklist — a real friend says it in prose. The word "urgent" inside a real sentence is fine; the banner is not.
- Do not mention the Reply Pipeline, reply queue counts, internal tool names, or unrelated email backlog in your output.
- Do not offer follow-up actions unless you can complete them this turn with currently available tools and they are directly relevant to this specific notification.
- Match confidence to evidence. For financial or security alerts, prefer "looks like", "matches", or "probably" over "definitely" or "it's yours". For confirmed facts, state them plainly.
- Do not append a reflexive "Want me to..." closer. If there is no genuinely useful next step you can complete right now, stop.
- One topic only when there is a single reminder. If the request lists multiple reminders (batch), treat each as required coverage; do not add unrelated topics.
- Keep the user's real style and the current mode from the Identity & Voice section. Reminders can be casual, but do not force shorthand, lowercase, ellipses, or dry humor when the user and situation do not support them.`;

function isNotificationRequest(userRequest: string): boolean {
  return userRequest.startsWith('ALERT NOTIFICATION') ||
    userRequest.startsWith('REMINDER DELIVERY');
}

const PENDING_DRAFT_OP_LIMIT = 3;
const PENDING_DRAFT_REQUEST_MAX = 240;
const PENDING_DRAFT_PREVIEW_MAX = 360;
const PENDING_DRAFT_DESCRIPTION_MAX = 240;
const PENDING_DRAFT_ATTENDEE_LIMIT = 5;
const PENDING_DRAFT_RECURRENCE_LIMIT = 3;

function quotePromptScalar(value: string | number | boolean): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function sanitizePromptText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function pushPromptField(
  lines: string[],
  indent: string,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value === undefined) return;
  lines.push(`${indent}${key}: ${quotePromptScalar(value)}`);
}

function formatPromptDateTime(value: string, timeZone: string): string {
  try {
    return formatDateTimeInTimeZone(normalizeIsoDateInputToUtc(value, timeZone, 'start'), timeZone);
  } catch {
    return value;
  }
}

function formatPendingEventTime(
  value: CalendarEventDraftDTO['start'] | undefined,
  fallbackTimeZone: string,
): string | undefined {
  if (!value) return undefined;
  if ('date' in value) {
    return `${value.date} (all day)`;
  }

  const timeZone = value.timeZone || fallbackTimeZone;
  return formatPromptDateTime(value.dateTime, timeZone);
}

function formatPendingAttendees(draft: CalendarEventDraftDTO): string | undefined {
  if (!draft.attendees?.length) return undefined;
  const attendees = draft.attendees
    .slice(0, PENDING_DRAFT_ATTENDEE_LIMIT)
    .map((attendee) => attendee.displayName?.trim() || attendee.email)
    .join(', ');
  const remainder = draft.attendees.length - PENDING_DRAFT_ATTENDEE_LIMIT;
  return remainder > 0 ? `${attendees} (+${remainder} more)` : attendees;
}

function formatPendingReminders(draft: CalendarEventDraftDTO): string | undefined {
  if (!draft.reminders) return undefined;
  const overrides = draft.reminders.overrides?.length
    ? draft.reminders.overrides
      .map((override) => `${override.method}:${override.minutes}`)
      .join(', ')
    : undefined;
  if (overrides) {
    return `useDefault=${draft.reminders.useDefault}; overrides=${overrides}`;
  }
  return `useDefault=${draft.reminders.useDefault}`;
}

function formatPendingRecurrence(draft: CalendarEventDraftDTO): string | undefined {
  if (!draft.recurrence?.length) return undefined;
  const visible = draft.recurrence.slice(0, PENDING_DRAFT_RECURRENCE_LIMIT).join(', ');
  const remainder = draft.recurrence.length - PENDING_DRAFT_RECURRENCE_LIMIT;
  return remainder > 0 ? `${visible} (+${remainder} more)` : visible;
}

function appendPendingDraftFields(params: {
  lines: string[];
  indent: string;
  draft: CalendarEventDraftDTO;
  fallbackTimeZone: string;
  fallbackCalendarId?: string;
}): void {
  const { lines, indent, draft, fallbackTimeZone, fallbackCalendarId } = params;
  const startLabel = formatPendingEventTime(draft.start, fallbackTimeZone);
  const endLabel = formatPendingEventTime(draft.end, fallbackTimeZone);
  pushPromptField(lines, indent, 'calendarId', (draft as { calendarId?: string }).calendarId ?? fallbackCalendarId);
  pushPromptField(lines, indent, 'summary', draft.summary);
  pushPromptField(lines, indent, 'start', startLabel);
  pushPromptField(lines, indent, 'end', endLabel);
  pushPromptField(lines, indent, 'location', draft.location);
  pushPromptField(lines, indent, 'description', sanitizePromptText(draft.description, PENDING_DRAFT_DESCRIPTION_MAX));
  pushPromptField(lines, indent, 'attendees', formatPendingAttendees(draft));
  pushPromptField(lines, indent, 'reminders', formatPendingReminders(draft));
  pushPromptField(lines, indent, 'recurrence', formatPendingRecurrence(draft));
  pushPromptField(lines, indent, 'visibility', draft.visibility);
  pushPromptField(lines, indent, 'transparency', draft.transparency);
  pushPromptField(lines, indent, 'colorId', draft.colorId);
  pushPromptField(lines, indent, 'guestsCanModify', draft.guestsCanModify);
  pushPromptField(lines, indent, 'guestsCanInviteOthers', draft.guestsCanInviteOthers);
  pushPromptField(lines, indent, 'guestsCanSeeOtherGuests', draft.guestsCanSeeOtherGuests);
}

function appendPendingOperationFields(params: {
  lines: string[];
  op: CalendarMutationOperationDTO;
  index: number;
  fallbackTimeZone: string;
  fallbackCalendarId?: string;
}): void {
  const { lines, op, index, fallbackTimeZone, fallbackCalendarId } = params;
  lines.push(`    - index: ${index + 1}`);
  pushPromptField(lines, '      ', 'kind', op.kind);

  if (op.kind === 'create') {
    appendPendingDraftFields({
      lines,
      indent: '      ',
      draft: op.eventDraft,
      fallbackTimeZone,
      fallbackCalendarId,
    });
    pushPromptField(lines, '      ', 'createMeetLink', op.createMeetLink);
    return;
  }

  if (op.kind === 'update') {
    if ('eventId' in op.target) {
      pushPromptField(lines, '      ', 'targetEventId', op.target.eventId);
      pushPromptField(lines, '      ', 'targetCalendarId', op.target.calendarId);
    } else {
      pushPromptField(lines, '      ', 'lookupQuery', op.target.lookupQuery);
      pushPromptField(lines, '      ', 'lookupRange', JSON.stringify(op.target.lookupRange));
    }
    pushPromptField(lines, '      ', 'destinationCalendarId', op.destinationCalendarId);
    appendPendingDraftFields({
      lines,
      indent: '      ',
      draft: op.eventDraft,
      fallbackTimeZone,
      fallbackCalendarId,
    });
    pushPromptField(lines, '      ', 'createMeetLink', op.createMeetLink);
    return;
  }

  if ('eventId' in op.target) {
    pushPromptField(lines, '      ', 'targetEventId', op.target.eventId);
    pushPromptField(lines, '      ', 'targetCalendarId', op.target.calendarId);
  } else {
    pushPromptField(lines, '      ', 'lookupQuery', op.target.lookupQuery);
    pushPromptField(lines, '      ', 'lookupRange', JSON.stringify(op.target.lookupRange));
  }
}

export function buildPendingCalendarInstruction(params: {
  pendingId: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  payload: PendingCalendarChangePayload;
  fallbackTimeZone: string;
}): string {
  const { pendingId, status, createdAt, expiresAt, payload, fallbackTimeZone } = params;
  const lines = [
    'Active pending calendar change exists.',
    'pendingDraft:',
  ];

  pushPromptField(lines, '  ', 'pendingId', pendingId);
  pushPromptField(lines, '  ', 'status', status);
  pushPromptField(lines, '  ', 'createdAt', formatDateTimeInTimeZone(createdAt, fallbackTimeZone));
  pushPromptField(lines, '  ', 'expiresAt', formatDateTimeInTimeZone(expiresAt, fallbackTimeZone));
  pushPromptField(lines, '  ', 'userTimezone', payload.userTimezone);
  pushPromptField(lines, '  ', 'originalUserRequest', sanitizePromptText(payload.userRequest, PENDING_DRAFT_REQUEST_MAX));
  pushPromptField(lines, '  ', 'planAction', payload.plan.action);
  pushPromptField(lines, '  ', 'requiresConfirmation', payload.plan.requiresConfirmation);
  pushPromptField(lines, '  ', 'defaultCalendarId', payload.plan.calendarId);
  pushPromptField(lines, '  ', 'sendUpdates', payload.plan.sendUpdates);
  pushPromptField(lines, '  ', 'createMeetLink', payload.plan.createMeetLink);
  pushPromptField(lines, '  ', 'previewText', sanitizePromptText(payload.plan.userPreviewText, PENDING_DRAFT_PREVIEW_MAX));

  if (payload.plan.action === 'bundle') {
    const opKinds = Array.from(new Set(payload.plan.ops.map((op) => op.kind))).join(', ');
    pushPromptField(lines, '  ', 'operationKinds', opKinds);
    lines.push('  ops:');
    payload.plan.ops
      .slice(0, PENDING_DRAFT_OP_LIMIT)
      .forEach((op, index) => appendPendingOperationFields({
        lines,
        op,
        index,
        fallbackTimeZone,
        fallbackCalendarId: payload.plan.calendarId,
      }));

    const hiddenOpCount = payload.plan.ops.length - PENDING_DRAFT_OP_LIMIT;
    if (hiddenOpCount > 0) {
      pushPromptField(lines, '  ', 'remainingOpCount', hiddenOpCount);
    }
  } else {
    pushPromptField(
      lines,
      '  ',
      'clarifyingQuestions',
      payload.plan.clarifyingQuestions?.join(' | '),
    );
  }

  if (payload.failure) {
    lines.push('  lastFailure:');
    pushPromptField(lines, '    ', 'code', payload.failure.code);
    pushPromptField(lines, '    ', 'message', sanitizePromptText(payload.failure.message, 180));
    pushPromptField(lines, '    ', 'retryable', payload.failure.retryable);
    pushPromptField(lines, '    ', 'failedOpIndex', payload.failure.failedOpIndex);
    pushPromptField(lines, '    ', 'partialSuccessCount', payload.failure.partialSuccessCount);
  }

  return lines.join('\n');
}

export async function resolveUserCalendarTimezone(userId: string): Promise<string> {
  let userTimezone = DEFAULT_CALENDAR_TIMEZONE;

  try {
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { calendarTimezone: true },
    });
    userTimezone = userSettings?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE;
  } catch (error) {
    logger.debug('[executiveAgent] Failed to fetch user settings for timezone:', error);
  }

  return userTimezone;
}

function buildCurrentTurnMessage(params: {
  input: ExecutiveAgentInput;
  channel: ProgressUpdateChannel;
  currentTimeUserTz: string;
  dayOfWeek: string;
  currentDateUserTzDateOnly: string;
  userTimezone: string;
  timeSinceLastMessage: string;
  memoryContext: string;
  runContextFragment: string;
  pendingCalendarInstruction: string;
  replyPipelineInstruction: string;
  harnessReminders: string[];
  actionPackSummaryLines: string[];
  mcpToolSummaryLines: string[];
  mcpDegradedSummaryLines: string[];
  mcpAvailableServerLines: string[];
  availableSkillLines: string[];
  selectedSkillFragments: string[];
  skillDegradedSummaryLines: string[];
}): string {
  const sections = [
    '## Current Turn Context',
    `Current time (right now): ${params.currentTimeUserTz} (${params.dayOfWeek})`,
    `User-local date (YYYY-MM-DD): ${params.currentDateUserTzDateOnly}`,
    `Timezone: ${params.userTimezone}`,
    `Messaging channel: ${params.channel}`,
    `User: ${params.input.userEmail}`,
    `Time since last message: ${params.timeSinceLastMessage}`,
    '',
    params.runContextFragment,
    '',
    '## Pending Calendar State',
    params.pendingCalendarInstruction,
    '',
    '## Capability Model This Turn',
    '- Safe context tools for memory, inbox, calendar, public web search, PDF reads, progress updates, and reply preference reads are available every turn.',
    '- Only action tools already exposed this turn are callable right now.',
    '- "Available Action Packs" are candidates you may request with request_tool_pack_exposure when safe context is not enough.',
    '- "Available Skills" are user-authored guidance candidates you may request with request_skill_exposure when that guidance would materially help.',
    '- Only MCP tools listed under "MCP Tools This Turn" are callable right now.',
    '- "Available MCP Server Packs" are candidates you may request with request_mcp_server_tools when native tools are insufficient.',
    '',
    '## Reply Pipeline Status',
    params.replyPipelineInstruction,
    '',
    ...(params.actionPackSummaryLines.length > 0
      ? [
          '## Available Action Packs',
          ...params.actionPackSummaryLines.map((line) => `- ${line}`),
          '',
        ]
      : []),
    ...(params.mcpToolSummaryLines.length > 0
      ? [
          '## MCP Tools This Turn',
          ...params.mcpToolSummaryLines.map((line) => `- ${line}`),
          '',
        ]
      : []),
    ...(params.mcpAvailableServerLines.length > 0
      ? [
          '## Available MCP Server Packs',
          ...params.mcpAvailableServerLines.map((line) => `- ${line}`),
          '',
        ]
      : []),
    ...(params.availableSkillLines.length > 0
      ? [
          '## Available Skills',
          ...params.availableSkillLines.map((line) => `- ${line}`),
          '',
        ]
      : []),
    ...(params.selectedSkillFragments.length > 0
      ? [
          '## Selected Skills This Turn',
          ...params.selectedSkillFragments,
          '',
        ]
      : []),
    ...(params.mcpDegradedSummaryLines.length > 0
      ? [
          '## MCP Degraded Tools',
          ...params.mcpDegradedSummaryLines.map((line) => `- ${line}`),
          '',
        ]
      : []),
    ...(params.skillDegradedSummaryLines.length > 0
      ? [
          '## Skill Prompt Degraded Notes',
          ...params.skillDegradedSummaryLines.map((line) => `- ${line}`),
          '',
        ]
      : []),
    ...(params.harnessReminders.length > 0
      ? [
          '## Harness Reminders',
          ...params.harnessReminders.map((reminder) => `- ${reminder}`),
          '',
        ]
      : []),
    '## User Memory Snapshot',
    params.memoryContext,
    '',
    ...(isNotificationRequest(params.input.userRequest)
      ? [NOTIFICATION_DELIVERY_MODE_SECTION, '']
      : []),
    '## Current User Request',
    params.input.userRequest,
  ];

  return sections.join('\n');
}

export async function buildExecutiveAgentPrompt(
  input: ExecutiveAgentInput,
  channel: ProgressUpdateChannel,
  options?: {
    pendingCalendarInstruction?: string;
    harnessReminders?: string[];
    actionPackSummaryLines?: string[];
    mcpToolSummaryLines?: string[];
    mcpDegradedSummaryLines?: string[];
    mcpAvailableServerLines?: string[];
    availableSkillLines?: string[];
    selectedSkillFragments?: string[];
    skillDegradedSummaryLines?: string[];
  },
): Promise<PromptContext> {
  const systemPrompt = readPromptFile('whatsapp/executiveAgentPrompt.md');

  const userTimezone = await resolveUserCalendarTimezone(input.userId);
  const now = new Date();
  const currentTimeUtc = now.toISOString();
  let currentDateUserTzDateOnly = now.toISOString().split('T')[0]!;

  let currentTimeUserTz = now.toISOString();
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
    // Fallback: use system default timezone for all three values so they stay consistent
    dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
    currentTimeUserTz = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(now);
    currentDateUserTzDateOnly = getDateOnlyInTimezone(now, DEFAULT_CALENDAR_TIMEZONE);
  }

  // Fetch memory snapshot and reply pipeline status in parallel.
  // Memory: compact snapshot for context; detailed recall via search_memory at runtime.
  // Pipeline: tells the agent which threads already have auto-generated drafts.
  let memoryContext = '(No memories stored yet)';
  const pipelineSnapshotPromise = fetchReplyPipelineSnapshot(input.userId);

  if (isSupermemoryConfigured()) {
    try {
      const memories = await gatherMemoryContextForReply({
        userId: input.userId,
        query: 'user preferences communication style facts contacts names roles reminder default time',
        limit: 4,
        threshold: 0.35,
      });
      if (memories.length > 0) {
        memoryContext = memories
          .map((m) => `- ${m.content.trim().slice(0, 200)}`)
          .join('\n');
      }
    } catch (error) {
      logger.debug('[executiveAgent] Failed to fetch memory context:', error);
    }
  }

  const pipelineSnapshot = await pipelineSnapshotPromise;
  const replyPipelineInstruction = formatReplyPipelineInstruction(pipelineSnapshot);

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

  const runContextFragment = buildRunContextPromptFragment({
    classifierDecision: input.runContext?.classifierDecision,
    droppedSummary: input.runContext?.droppedSummary,
  });

  return {
    systemPrompt,
    messages: [
      ...formatConversationHistoryAsMessages(input.conversationHistory, {
        userTimezone,
      }),
      {
        role: 'user',
        content: buildCurrentTurnMessage({
          input,
          channel,
          currentTimeUserTz,
          dayOfWeek,
          currentDateUserTzDateOnly,
          userTimezone,
          timeSinceLastMessage,
          memoryContext,
          runContextFragment,
          pendingCalendarInstruction:
            options?.pendingCalendarInstruction ?? 'No active pending calendar change exists.',
          replyPipelineInstruction,
          harnessReminders: options?.harnessReminders ?? [],
          actionPackSummaryLines: options?.actionPackSummaryLines ?? [],
          mcpToolSummaryLines: options?.mcpToolSummaryLines ?? [],
          mcpDegradedSummaryLines: options?.mcpDegradedSummaryLines ?? [],
          mcpAvailableServerLines: options?.mcpAvailableServerLines ?? [],
          availableSkillLines: options?.availableSkillLines ?? [],
          selectedSkillFragments: options?.selectedSkillFragments ?? [],
          skillDegradedSummaryLines: options?.skillDegradedSummaryLines ?? [],
        }),
      },
    ],
    userTimezone,
    currentTimeUtc,
    currentTimeUserTz,
    dayOfWeek,
    currentDateUserTzDateOnly,
  };
}
