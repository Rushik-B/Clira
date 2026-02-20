/**
 * Telegram Message Processor
 *
 * Handles incoming Telegram DM messages by:
 * 1. Pairing unknown senders via code flow
 * 2. Managing conversation state (get/create)
 * 3. Detecting commands (send, save, clear, cancel, help)
 * 4. Invoking the Executive Agent for natural language requests
 * 5. Persisting messages and metadata
 * 6. Sending responses back through Telegram
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { Prisma } from '@prisma/client';
import { getExecutiveAgent, type ExecutiveAgentOutput } from '@/lib/ai/agents/executiveAgent';
import { transcribeVoiceMemo } from '@/lib/ai/transcribeVoiceMemo';
import { describeIncomingImage } from '@/lib/ai/describeIncomingImage';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';
import {
  getConversationManager,
  getPairingManager,
  getTelegramClient,
  type TelegramInboundMessage,
} from '@/lib/services/telegram';

export interface ProcessMessageResult {
  success: boolean;
  response: string;
  error?: string;
  metadata?: Prisma.InputJsonObject;
}

type Command = 'send' | 'save' | 'clear' | 'cancel' | 'help' | null;

const VOICE_MEMO_NO_CONTENT_PHRASES = [
  '[no speech detected]',
  'no speech detected',
  'no speech',
  '[no speech]',
  'unable to transcribe',
  "i couldn't understand",
  'i could not understand',
  'no audible',
  'silence',
  'inaudible',
];

const inFlightRuns = new Map<
  string,
  { abortController: AbortController; runId: number }
>();
let runIdCounter = 0;

function isVoiceMemoNoContent(transcript: string): boolean {
  const t = transcript.trim().toLowerCase();
  if (!t) return true;
  return VOICE_MEMO_NO_CONTENT_PHRASES.some((phrase) => t === phrase || t.startsWith(phrase));
}

function isAbortError(e: unknown): boolean {
  if (e && typeof e === 'object') {
    if ((e as { code?: unknown }).code === 'abort') return true;
  }
  if (e instanceof Error) {
    return (
      e.name === 'AbortError' ||
      /abort|aborted|cancel|superseded/i.test(e.message ?? '')
    );
  }
  return false;
}

function detectCommand(text: string): Command {
  const normalized = text.toLowerCase().trim();

  if (
    normalized === 'send' ||
    normalized === 'send it' ||
    normalized === 'send now' ||
    normalized === 'yes send' ||
    normalized === 'yes, send' ||
    normalized === 'yes send it' ||
    normalized === 'send email' ||
    normalized === 'send the email'
  ) {
    return 'send';
  }

  if (
    normalized === 'save' ||
    normalized === 'save it' ||
    normalized === 'save draft' ||
    normalized === 'save as draft' ||
    normalized === 'save to drafts'
  ) {
    return 'save';
  }

  if (
    normalized === 'clear' ||
    normalized === 'reset' ||
    normalized === 'start over' ||
    normalized === 'new conversation' ||
    normalized === 'clear conversation'
  ) {
    return 'clear';
  }

  if (
    normalized === 'cancel' ||
    normalized === 'cancel draft' ||
    normalized === 'discard' ||
    normalized === 'discard draft' ||
    normalized === 'nevermind' ||
    normalized === 'never mind'
  ) {
    return 'cancel';
  }

  if (
    normalized === 'help' ||
    normalized === '/help' ||
    normalized === 'commands' ||
    normalized === 'what can you do' ||
    normalized === 'what can you do?'
  ) {
    return 'help';
  }

  return null;
}

async function handleSendCommand(
  userId: string,
  userEmail: string,
  conversationId: string,
  progressContext?: ProgressUpdateContext,
): Promise<ProcessMessageResult> {
  return runExecutiveAgent(userId, userEmail, conversationId, 'send', { progressContext });
}

async function handleSaveCommand(
  userId: string,
  userEmail: string,
  conversationId: string,
  progressContext?: ProgressUpdateContext,
): Promise<ProcessMessageResult> {
  return runExecutiveAgent(userId, userEmail, conversationId, 'save to drafts', { progressContext });
}

async function handleClearCommand(conversationId: string): Promise<ProcessMessageResult> {
  const conversationManager = getConversationManager();
  await Promise.all([
    conversationManager.clearConversation(conversationId),
    prisma.pendingCalendarChange.updateMany({
      where: {
        conversationId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    }),
  ]);

  return {
    success: true,
    response: 'Fresh start! What can I help you with?',
  };
}

async function handleCancelCommand(conversationId: string): Promise<ProcessMessageResult> {
  const conversationManager = getConversationManager();
  await Promise.all([
    conversationManager.clearConversation(conversationId),
    prisma.pendingCalendarChange.updateMany({
      where: {
        conversationId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    }),
  ]);

  return {
    success: true,
    response: 'Conversation cleared. What else can I help with?',
  };
}

function handleHelpCommand(): ProcessMessageResult {
  const helpText = `Here's what I can do:

*Draft emails* - Tell me who to email and what to say
*send* - Send the current draft
*save* - Save draft to Gmail drafts
*cancel* - Discard current draft
*clear* - Start fresh

I can also check your calendar, search emails, and remember your preferences.`;

  return {
    success: true,
    response: helpText,
  };
}

export async function processTelegramMessage(
  message: TelegramInboundMessage,
): Promise<ProcessMessageResult> {
  const {
    updateId,
    chatId,
    messageId,
    telegramUserId,
    senderName,
  } = message;

  const telegramClient = getTelegramClient();
  const pairingManager = getPairingManager();
  const conversationManager = getConversationManager();

  logger.info(
    `[telegramProcessor] Processing message: chatId=${chatId} telegramUserId=${telegramUserId} ${message.voiceFileId ? 'voice' : message.imageFileId ? 'image' : `text="${message.text.slice(0, 50)}..."`}`,
  );

  const isDuplicateByUpdate = await conversationManager.hasInboundMessageWithUpdateId(updateId);
  if (isDuplicateByUpdate) {
    logger.info('[telegramProcessor] Duplicate inbound Telegram update detected, skipping', {
      chatId,
      updateId,
    });
    return { success: true, response: '' };
  }

  if (messageId) {
    const isDuplicateByMessageId =
      await conversationManager.hasInboundMessageWithTelegramMessageId(messageId);
    if (isDuplicateByMessageId) {
      logger.info('[telegramProcessor] Duplicate inbound Telegram message ID detected, skipping', {
        chatId,
        messageId,
      });
      return { success: true, response: '' };
    }
  }

  const link = await pairingManager.findActiveLinkByTelegramUserId(telegramUserId);
  if (!link) {
    const pairing = await pairingManager.createOrReusePairingRequest({
      telegramUserId,
      chatId,
      telegramUsername: message.telegramUsername ?? null,
      telegramFirstName: senderName,
    });

    try {
      await telegramClient.sendMessage(chatId, pairing.responseText);
    } catch (error) {
      logger.error('[telegramProcessor] Failed to send pairing instruction', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      success: false,
      response: pairing.responseText,
      error: 'Telegram account not paired',
    };
  }

  await pairingManager.touchLinkActivityByTelegramUserId(telegramUserId);

  const user = await prisma.user.findUnique({
    where: { id: link.userId },
    select: { email: true },
  });

  if (!user?.email) {
    return {
      success: false,
      response: 'Something went wrong with your account. Please reconnect and try again.',
      error: 'User email not found',
    };
  }

  const conversation = await conversationManager.getOrCreateConversation(
    link.userId,
    chatId,
    telegramUserId,
  );

  let effectiveText: string;
  let abortController: AbortController | null = null;
  let myRunId: number | null = null;

  if (message.voiceFileId || message.imageFileId) {
    abortController = new AbortController();
    myRunId = ++runIdCounter;
    inFlightRuns.set(conversation.id, { abortController, runId: myRunId });

    try {
      if (message.voiceFileId) {
        const media = await telegramClient.getFileBuffer(message.voiceFileId);
        effectiveText = await transcribeVoiceMemo(media.data, message.voiceMimeType ?? media.mimeType, {
          abortSignal: abortController.signal,
        });

        if (!effectiveText.trim() || isVoiceMemoNoContent(effectiveText)) {
          if (inFlightRuns.get(conversation.id)?.runId === myRunId) {
            inFlightRuns.delete(conversation.id);
          }
          await telegramClient.sendMessage(
            chatId,
            "I couldn't make that out. Can you repeat it?",
          );
          return {
            success: false,
            response: '',
            error: 'Voice memo transcription empty',
          };
        }
      } else {
        const media = await telegramClient.getFileBuffer(message.imageFileId!);
        const description = await describeIncomingImage(media.data, message.imageMimeType ?? media.mimeType, {
          abortSignal: abortController.signal,
        });
        const caption = message.imageCaption?.trim();
        effectiveText = [
          'User sent an image on Telegram.',
          caption ? `User caption: ${caption}` : null,
          'Detailed image description:',
          description,
        ]
          .filter(Boolean)
          .join('\n\n');
      }
    } catch (error) {
      if (inFlightRuns.get(conversation.id)?.runId === myRunId) {
        inFlightRuns.delete(conversation.id);
      }

      if (isAbortError(error)) {
        logger.debug('[telegramProcessor] Media processing superseded by newer message');
        return { success: true, response: '' };
      }

      logger.error('[telegramProcessor] Media processing failed', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await telegramClient.sendMessage(
          chatId,
          message.voiceFileId
            ? "I couldn't process that voice memo. Please try again or send text."
            : "I couldn't process that image. Please try again or send text.",
        );
      } catch {
        // no-op
      }

      return {
        success: false,
        response: '',
        error: message.voiceFileId ? 'Voice memo processing failed' : 'Image processing failed',
      };
    }
  } else {
    effectiveText = message.text;
  }

  await conversationManager.addMessage(conversation.id, {
    content: effectiveText,
    role: 'USER',
    direction: 'INBOUND',
    telegramMessageId: messageId,
    telegramUpdateId: updateId,
    metadata: message.voiceFileId
      ? { senderName, fromVoiceMemo: true }
      : message.imageFileId
        ? { senderName, fromImage: true, imageCaption: message.imageCaption ?? null }
        : { senderName },
  });

  const command = detectCommand(effectiveText);
  let result: ProcessMessageResult;

  if (command) {
    if (myRunId !== null && inFlightRuns.get(conversation.id)?.runId === myRunId) {
      inFlightRuns.delete(conversation.id);
    }

    switch (command) {
      case 'send':
        result = await handleSendCommand(
          link.userId,
          user.email,
          conversation.id,
          buildProgressContext({
            conversationId: conversation.id,
            chatId,
            conversationManager,
            telegramClient,
          }),
        );
        break;
      case 'save':
        result = await handleSaveCommand(
          link.userId,
          user.email,
          conversation.id,
          buildProgressContext({
            conversationId: conversation.id,
            chatId,
            conversationManager,
            telegramClient,
          }),
        );
        break;
      case 'clear':
        result = await handleClearCommand(conversation.id);
        break;
      case 'cancel':
        result = await handleCancelCommand(conversation.id);
        break;
      case 'help':
        result = handleHelpCommand();
        break;
      default:
        result = { success: false, response: 'Unknown command' };
    }
  } else {
    if (!abortController) {
      const prev = inFlightRuns.get(conversation.id);
      if (prev) {
        prev.abortController.abort('superseded_by_new_message');
      }
      abortController = new AbortController();
      myRunId = ++runIdCounter;
      inFlightRuns.set(conversation.id, { abortController, runId: myRunId });
    }

    try {
      result = await runExecutiveAgent(link.userId, user.email, conversation.id, effectiveText, {
        progressContext: buildProgressContext({
          conversationId: conversation.id,
          chatId,
          conversationManager,
          telegramClient,
        }),
        abortSignal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return { success: true, response: '' };
      }
      throw error;
    } finally {
      if (myRunId !== null && inFlightRuns.get(conversation.id)?.runId === myRunId) {
        inFlightRuns.delete(conversation.id);
      }
    }
  }

  if (result.response) {
    try {
      const { messageId: telegramResponseId } = await telegramClient.sendMessage(chatId, result.response);
      await conversationManager.addMessage(conversation.id, {
        content: result.response,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        telegramMessageId: telegramResponseId,
        metadata: result.metadata,
      });
    } catch (error) {
      logger.error('[telegramProcessor] Failed sending Telegram response', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      result.error = 'Failed to send Telegram response';
    }
  }

  return result;
}

async function runExecutiveAgent(
  userId: string,
  userEmail: string,
  conversationId: string,
  userRequest: string,
  options?: {
    progressContext?: ProgressUpdateContext;
    abortSignal?: AbortSignal;
  },
): Promise<ProcessMessageResult> {
  const conversationManager = getConversationManager();
  const agent = getExecutiveAgent();

  try {
    const recentMessages = await conversationManager.getRecentMessages(conversationId, 15);
    const conversationHistory = recentMessages.map((msg) => ({
      id: msg.id,
      content: msg.content,
      role: msg.role,
      direction: msg.direction,
      createdAt: msg.createdAt,
      metadata: (msg.metadata != null && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata))
        ? (msg.metadata as Record<string, unknown>)
        : null,
    }));

    const agentResult: ExecutiveAgentOutput = await agent.process({
      userId,
      userEmail,
      userRequest,
      conversationId,
      conversationHistory,
      progressContext: options?.progressContext,
      abortSignal: options?.abortSignal,
    });

    return {
      success: agentResult.status === 'ok',
      response: agentResult.response,
      error: agentResult.status === 'ok' ? undefined : agentResult.error ?? 'Executive Agent fallback',
      metadata: agentResult.metadata,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[telegramProcessor] Executive Agent error: ${message}`);

    return {
      success: false,
      response: "Hmm, something went wrong on my end. Can you try that again?",
      error: message,
    };
  }
}

function buildProgressContext({
  conversationId,
  chatId,
  conversationManager,
  telegramClient,
}: {
  conversationId: string;
  chatId: string;
  conversationManager: ReturnType<typeof getConversationManager>;
  telegramClient: ReturnType<typeof getTelegramClient>;
}): ProgressUpdateContext {
  return {
    channel: 'telegram',
    requestId: crypto.randomUUID(),
    conversationId,
    sendMessage: async (text) => {
      const { messageId } = await telegramClient.sendMessage(chatId, text);
      return { externalId: messageId };
    },
    persistMessage: async ({ content, metadata, externalId }) => {
      await conversationManager.addMessage(conversationId, {
        content,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        telegramMessageId: externalId,
        metadata,
      });
    },
  };
}
