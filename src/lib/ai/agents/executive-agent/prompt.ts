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

function buildCurrentTurnMessage(params: {
  input: ExecutiveAgentInput;
  channel: ProgressUpdateChannel;
  currentTimeUtc: string;
  currentTimeUserTz: string;
  dayOfWeek: string;
  currentDateUserTzDateOnly: string;
  userTimezone: string;
  timeSinceLastMessage: string;
  memoryContext: string;
  runContextFragment: string;
}): string {
  const sections = [
    '## Current Turn Context',
    `Current time (right now): ${params.currentTimeUserTz} (${params.dayOfWeek})`,
    `User-local date (YYYY-MM-DD): ${params.currentDateUserTzDateOnly}`,
    `UTC: ${params.currentTimeUtc}`,
    `Timezone: ${params.userTimezone}`,
    `Messaging channel: ${params.channel}`,
    `User: ${params.input.userEmail}`,
    `Time since last message: ${params.timeSinceLastMessage}`,
    '',
    params.runContextFragment,
    '',
    '## User Memory Snapshot',
    params.memoryContext,
    '',
    '## Current User Request',
    params.input.userRequest,
  ];

  return sections.join('\n');
}

export async function buildExecutiveAgentPrompt(
  input: ExecutiveAgentInput,
  channel: ProgressUpdateChannel,
): Promise<PromptContext> {
  const systemPrompt = readPromptFile('whatsapp/executiveAgentPrompt.md');

  // Fetch user settings for timezone
  let userTimezone = DEFAULT_CALENDAR_TIMEZONE;
  try {
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId: input.userId },
      select: { calendarTimezone: true },
    });
    userTimezone = userSettings?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE;
  } catch (error) {
    logger.debug('[executiveAgent] Failed to fetch user settings for timezone:', error);
  }
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

  // Keep this memory snapshot generic and compact so it doesn't churn on every
  // request. Detailed recall should go through search_memory at runtime.
  let memoryContext = '(No memories stored yet)';
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
      ...formatConversationHistoryAsMessages(input.conversationHistory),
      {
        role: 'user',
        content: buildCurrentTurnMessage({
          input,
          channel,
          currentTimeUtc,
          currentTimeUserTz,
          dayOfWeek,
          currentDateUserTzDateOnly,
          userTimezone,
          timeSinceLastMessage,
          memoryContext,
          runContextFragment,
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
