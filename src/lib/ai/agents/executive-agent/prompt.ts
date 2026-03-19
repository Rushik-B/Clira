import { readPromptFile } from '@/lib/prompts';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
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
import { getDateOnlyInTimezone } from '@/lib/utils/timezone';
import { logger } from '@/lib/logger';
import { buildRunContextPromptFragment } from '@/lib/services/messaging-orchestration';
import {
  fetchReplyPipelineSnapshot,
  formatReplyPipelineInstruction,
} from './replyPipelineContext';

export const EXECUTIVE_AGENT_PROMPT_VERSION = 'ea-prompt-v12';

// Injected only when the exec agent is activated by a system trigger (alert or reminder),
// not by a user message. Tells the agent to reason with full context but output selectively.
const NOTIFICATION_DELIVERY_MODE_SECTION = `## Notification Delivery Mode
You are responding to a system-triggered notification, not a user message. The user did not initiate this turn — you are interrupting them.

Output contract for this turn:
- Use all available context (memory, inbox, calendar, reply pipeline) for your internal reasoning and tool calls. That is the work.
- Your final output is the notification itself: what happened, and why it matters to this user specifically.
- Target: 1-2 sentences. Every sentence must earn its place.
- Do not mention the Reply Pipeline, reply queue counts, or unrelated email backlog in your output.
- Do not offer follow-up actions unless you can complete them this turn with currently available tools and they are directly relevant to this specific notification.
- Match confidence to evidence. For financial or security alerts, prefer "looks like", "matches", or "probably" over "definitely" or "it's yours". For confirmed facts, state them plainly.
- Do not append a reflexive "Want me to..." closer. If there is no genuinely useful next step you can complete right now, stop.
- One topic only. No unrelated add-ons.`;

function isNotificationRequest(userRequest: string): boolean {
  return userRequest.startsWith('ALERT NOTIFICATION') ||
    userRequest.startsWith('REMINDER DELIVERY');
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
    '## Capability Model This Turn',
    '- Safe context tools for memory, inbox, calendar, PDF reads, progress updates, and reply preference reads are available every turn.',
    '- Only action tools already exposed this turn are callable right now.',
    '- "Available Action Packs" are candidates you may request with request_tool_pack_exposure when safe context is not enough.',
    '- "Available Skills" are user-authored guidance candidates you may request with request_skill_exposure when that guidance would materially help.',
    '- Only MCP tools listed under "MCP Tools This Turn" are callable right now.',
    '- "Available MCP Server Packs" are candidates you may request with request_mcp_server_tools when native tools are insufficient.',
    '',
    '## Pending Calendar State',
    params.pendingCalendarInstruction,
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
