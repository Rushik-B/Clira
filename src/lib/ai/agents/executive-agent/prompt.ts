import { readPromptFile } from '@/lib/prompts';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import {
  gatherMemoryContextForReply,
} from '@/lib/services/core/replyContextTools';
import { isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import {
  formatConversationHistory,
  formatRelativeTime,
  truncate,
} from './helpers';
import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type { ExecutiveAgentInput, PromptContext } from './types';
import { getDateOnlyInTimezone } from '@/lib/utils/timezone';
import { logger } from '@/lib/logger';

export async function buildExecutiveAgentPrompt(
  input: ExecutiveAgentInput,
  channel: ProgressUpdateChannel,
): Promise<PromptContext> {
  const template = readPromptFile('whatsapp/executiveAgentPrompt.md');

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
