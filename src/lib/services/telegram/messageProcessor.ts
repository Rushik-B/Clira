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
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';
import {
  createAiTraceRoot,
  deriveOutputPreview,
  deriveRunStatusFromError,
  finalizeAiTraceRun,
} from '@/lib/ai/tracing';
import {
  getConversationManager,
  getPairingManager,
  getTelegramClient,
  type TelegramInboundMessage,
  type TelegramReplyContext,
} from '@/lib/services/telegram';
import {
  buildOrchestrationMessageMetadata,
  emitOrchestratorEvent,
  getMessagingOrchestrator,
  getDuplicateInboundMessageIdFromAdapter,
  isAbortError,
  type ChannelAdapter,
  type RunContext,
} from '@/lib/services/messaging-orchestration';
import {
  buildInlineBufferProvenance,
  createStoredContentReference,
  extractContentFromBuffer,
  formatMessagingMediaForAgent,
  renderContentExtractionForLegacyText,
} from '@/lib/services/content-ingestion';

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

function isVoiceMemoNoContent(transcript: string): boolean {
  const t = transcript.trim().toLowerCase();
  if (!t) return true;
  return VOICE_MEMO_NO_CONTENT_PHRASES.some((phrase) => t === phrase || t.startsWith(phrase));
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

type ResolvedReplyContext = {
  messageId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'UNKNOWN';
  direction?: 'INBOUND' | 'OUTBOUND';
  content?: string;
  quote?: string;
  senderName?: string;
  source: 'conversation-history' | 'telegram-update';
};

function truncateReplyContext(text: string, maxLength = 400): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

async function resolveReplyContext(
  conversationManager: ReturnType<typeof getConversationManager>,
  conversationId: string,
  replyContext: TelegramReplyContext | undefined,
): Promise<ResolvedReplyContext | null> {
  if (!replyContext?.messageId) return null;

  const storedMessage = await conversationManager.getMessageByTelegramMessageId(
    conversationId,
    replyContext.messageId,
  );

  if (storedMessage) {
    return {
      messageId: replyContext.messageId,
      role: storedMessage.role,
      direction: storedMessage.direction,
      content: storedMessage.content,
      quote: replyContext.quote,
      senderName: replyContext.senderName,
      source: 'conversation-history',
    };
  }

  return {
    messageId: replyContext.messageId,
    role: replyContext.isBot ? 'ASSISTANT' : 'UNKNOWN',
    content: replyContext.text,
    quote: replyContext.quote,
    senderName: replyContext.senderName,
    source: 'telegram-update',
  };
}

function formatReplyContextForAgent(replyContext: ResolvedReplyContext | null): string | null {
  if (!replyContext) return null;

  const actor = replyContext.role === 'ASSISTANT'
    ? 'Assistant'
    : replyContext.role === 'USER'
      ? 'User'
      : replyContext.senderName?.trim() || 'someone';
  const lines = [`User is replying to an earlier ${actor} message on Telegram.`];

  if (replyContext.content?.trim()) {
    lines.push(`Replied-to message: ${truncateReplyContext(replyContext.content)}`);
  }

  const quote = replyContext.quote?.trim();
  if (quote) {
    const normalizedQuote = truncateReplyContext(quote, 200);
    const normalizedContent = replyContext.content?.trim()
      ? truncateReplyContext(replyContext.content, 200)
      : null;
    if (normalizedQuote !== normalizedContent) {
      lines.push(`Quoted excerpt: ${normalizedQuote}`);
    }
  }

  return lines.join('\n');
}

async function handleSendCommand(
  userId: string,
  userEmail: string,
  conversationId: string,
  options?: {
    progressContext?: ProgressUpdateContext;
    runContext?: RunContext;
    abortSignal?: AbortSignal;
  },
): Promise<ProcessMessageResult> {
  return runExecutiveAgent(userId, userEmail, conversationId, 'send', options);
}

async function handleSaveCommand(
  userId: string,
  userEmail: string,
  conversationId: string,
  options?: {
    progressContext?: ProgressUpdateContext;
    runContext?: RunContext;
    abortSignal?: AbortSignal;
  },
): Promise<ProcessMessageResult> {
  return runExecutiveAgent(userId, userEmail, conversationId, 'save to drafts', options);
}

async function clearConversationAndCancelPending(conversationId: string): Promise<void> {
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
}

async function handleClearCommand(conversationId: string): Promise<ProcessMessageResult> {
  await clearConversationAndCancelPending(conversationId);
  return {
    success: true,
    response: 'Fresh start! What can I help you with?',
  };
}

async function handleCancelCommand(conversationId: string): Promise<ProcessMessageResult> {
  await clearConversationAndCancelPending(conversationId);

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
  let activeConversationId = '';
  let effectiveText = message.text;
  let inboundMetadata: Prisma.InputJsonObject = { senderName };

  const adapter: ChannelAdapter = {
    channel: 'telegram',
    conversationId: () => activeConversationId,
    messageIdForDedupe: () => (messageId != null ? String(messageId) : null),
    persistInbound: async () => {
      if (!activeConversationId) {
        throw new Error('telegram_inbound_persist_missing_conversation_id');
      }
      await conversationManager.addMessage(activeConversationId, {
        content: effectiveText,
        role: 'USER',
        direction: 'INBOUND',
        telegramMessageId: messageId,
        telegramUpdateId: updateId,
        metadata: inboundMetadata,
      });
    },
    sendFinal: async (text: string) => {
      const { messageId: externalId } = await telegramClient.sendMessage(chatId, text);
      return { externalId };
    },
    sendProgress: async (text: string) => {
      const { messageId: externalId } = await telegramClient.sendMessage(chatId, text);
      return { externalId };
    },
  };

  logger.info(
    `[telegramProcessor] Processing message: chatId=${chatId} telegramUserId=${telegramUserId} ${
      message.voiceFileId
        ? 'voice'
        : message.imageFileId
          ? 'image'
          : message.pdfFileId
            ? 'pdf'
            : `text="${message.text.slice(0, 50)}..."`
    }`,
  );

  const isDuplicateByUpdate = await conversationManager.hasInboundMessageWithUpdateId(updateId);
  if (isDuplicateByUpdate) {
    logger.info('[telegramProcessor] Duplicate inbound Telegram update detected, skipping', {
      chatId,
      updateId,
    });
    return { success: true, response: '' };
  }

  const duplicateMessageId = await getDuplicateInboundMessageIdFromAdapter(
    adapter,
    (id) => conversationManager.hasInboundMessageWithTelegramMessageId(id),
  );
  if (duplicateMessageId) {
    logger.info('[telegramProcessor] Duplicate inbound Telegram message ID detected, skipping', {
      chatId,
      messageId: duplicateMessageId,
    });
    return { success: true, response: '' };
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
  activeConversationId = conversation.id;
  const resolvedReplyContext = await resolveReplyContext(
    conversationManager,
    conversation.id,
    message.replyContext,
  );
  const replyContextForAgent = formatReplyContextForAgent(resolvedReplyContext);
  let commandText = message.text;

  if (message.voiceFileId || message.imageFileId || message.pdfFileId) {
    try {
      if (message.voiceFileId) {
        const media = await telegramClient.getFileBuffer(message.voiceFileId);
        const contentReference = await createStoredContentReference({
          userId: link.userId,
          buffer: media.data,
          mimeHint: message.voiceMimeType ?? media.mimeType,
          trustClass: 'user_provided',
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'Telegram voice memo',
            sourceKind: 'telegram_media',
            channel: 'telegram',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.voiceFileId,
          }),
        });
        const extraction = await extractContentFromBuffer({
          buffer: media.data,
          mimeType: message.voiceMimeType ?? media.mimeType,
          channelLabel: 'Telegram',
          scope: {
            conversationId: conversation.id,
          },
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'Telegram voice memo',
            sourceKind: 'telegram_media',
            channel: 'telegram',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.voiceFileId,
          }),
        });
        effectiveText = renderContentExtractionForLegacyText(extraction);
        commandText = effectiveText;

        if (!effectiveText.trim() || isVoiceMemoNoContent(effectiveText)) {
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
        inboundMetadata = {
          senderName,
          fromVoiceMemo: true,
          contentRefIds: [contentReference.contentRefId],
        };
      } else if (message.imageFileId) {
        const media = await telegramClient.getFileBuffer(message.imageFileId!);
        const caption = message.imageCaption?.trim();
        const contentReference = await createStoredContentReference({
          userId: link.userId,
          buffer: media.data,
          mimeHint: message.imageMimeType ?? media.mimeType,
          trustClass: 'user_provided',
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'Telegram image',
            sourceKind: 'telegram_media',
            channel: 'telegram',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.imageFileId,
          }),
        });
        const extraction = await extractContentFromBuffer({
          buffer: media.data,
          mimeType: message.imageMimeType ?? media.mimeType,
          channelLabel: 'Telegram',
          userCaption: caption,
          scope: {
            conversationId: conversation.id,
          },
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'Telegram image',
            sourceKind: 'telegram_media',
            channel: 'telegram',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.imageFileId,
          }),
        });
        commandText = caption ?? '';
        effectiveText = formatMessagingMediaForAgent({
          channelLabel: 'Telegram',
          mediaKind: 'image',
          extraction,
          caption,
        });
        inboundMetadata = {
          senderName,
          fromImage: true,
          imageCaption: message.imageCaption ?? null,
          contentRefIds: [contentReference.contentRefId],
        };
      } else {
        const media = await telegramClient.getFileBuffer(message.pdfFileId!);
        const caption = message.pdfCaption?.trim();
        const contentReference = await createStoredContentReference({
          userId: link.userId,
          buffer: media.data,
          displayName: message.pdfFilename ?? null,
          mimeHint: message.pdfMimeType ?? media.mimeType,
          trustClass: 'user_provided',
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'Telegram PDF',
            sourceKind: 'telegram_media',
            channel: 'telegram',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.pdfFileId,
          }),
        });
        const extraction = await extractContentFromBuffer({
          buffer: media.data,
          mimeType: message.pdfMimeType ?? media.mimeType,
          channelLabel: 'Telegram',
          filename: message.pdfFilename ?? null,
          userCaption: caption,
          scope: {
            conversationId: conversation.id,
          },
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'Telegram PDF',
            sourceKind: 'telegram_media',
            channel: 'telegram',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.pdfFileId,
          }),
        });
        commandText = caption ?? '';
        effectiveText = formatMessagingMediaForAgent({
          channelLabel: 'Telegram',
          mediaKind: 'pdf',
          extraction,
          filename: message.pdfFilename ?? null,
          caption,
        });
        inboundMetadata = {
          senderName,
          fromPdf: true,
          pdfFilename: message.pdfFilename ?? null,
          pdfCaption: message.pdfCaption ?? null,
          contentRefIds: [contentReference.contentRefId],
        };
      }
    } catch (error) {
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
            : message.imageFileId
              ? "I couldn't process that image. Please try again or send text."
              : "I couldn't process that PDF. Please try again or send text.",
        );
      } catch (sendError) {
        logger.error('[telegramProcessor] Failed to send media processing error message', {
          chatId,
          error: sendError instanceof Error ? sendError.message : String(sendError),
        });
      }

      return {
        success: false,
        response: '',
        error: message.voiceFileId
          ? 'Voice memo processing failed'
          : message.imageFileId
            ? 'Image processing failed'
            : 'PDF processing failed',
      };
    }
  } else {
    effectiveText = message.text;
    commandText = message.text;
    inboundMetadata = { senderName };
  }

  if (replyContextForAgent) {
    effectiveText = [replyContextForAgent, effectiveText].filter(Boolean).join('\n\n');
    inboundMetadata = {
      ...inboundMetadata,
      replyContext: {
        messageId: resolvedReplyContext?.messageId ?? message.replyContext?.messageId ?? null,
        role: resolvedReplyContext?.role ?? null,
        direction: resolvedReplyContext?.direction ?? null,
        source: resolvedReplyContext?.source ?? null,
        senderName: resolvedReplyContext?.senderName ?? null,
        quotedText: resolvedReplyContext?.quote ?? null,
        repliedText: resolvedReplyContext?.content ?? message.replyContext?.text ?? null,
      },
    };
  }

  await adapter.persistInbound();

  let activeCommand: Command = detectCommand(commandText);

  const orchestrator = getMessagingOrchestrator();
  const orchestrationDecision = await orchestrator.prepareRunWithAdapter({
    adapter,
    userRequest: effectiveText,
    isCommand: Boolean(activeCommand),
  });

  if (orchestrationDecision.kind === 'skip') {
    logger.info('[telegramProcessor] Orchestrator skip accepted as terminal', {
      conversationId: conversation.id,
      chatId,
      messageId,
      reason: orchestrationDecision.reason,
    });
    return { success: true, response: '' };
  }

  let runContext = orchestrationDecision.runContext;
  let activeRequest = orchestrationDecision.userRequest;
  let result: ProcessMessageResult = { success: true, response: '' };

  const stopTyping = telegramClient.startTypingIndicator(chatId);
  try {

  while (runContext) {
    const progressContext = buildProgressContext({
      conversationId: conversation.id,
      conversationManager,
      adapter,
      canEmitProgress: runContext.canEmitProgress,
    });

    try {
      if (activeCommand === 'send') {
        result = await handleSendCommand(link.userId, user.email, conversation.id, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
        });
      } else if (activeCommand === 'save') {
        result = await handleSaveCommand(link.userId, user.email, conversation.id, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
        });
      } else if (activeCommand === 'clear') {
        result = await handleClearCommand(conversation.id);
      } else if (activeCommand === 'cancel') {
        result = await handleCancelCommand(conversation.id);
      } else if (activeCommand === 'help') {
        result = handleHelpCommand();
      } else {
        result = await runExecutiveAgent(link.userId, user.email, conversation.id, activeRequest, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        return { success: true, response: '' };
      }
      throw error;
    }

    if (result.response && await runContext.isRunCurrent()) {
      try {
        const { externalId: telegramResponseId } = await adapter.sendFinal(result.response);
        const outboundMetadata = buildOrchestrationMessageMetadata(
          runContext,
          result.metadata != null && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
            ? (result.metadata as Record<string, unknown>)
            : null,
        );

        await conversationManager.addMessage(conversation.id, {
          content: result.response,
          role: 'ASSISTANT',
          direction: 'OUTBOUND',
          telegramMessageId: telegramResponseId,
          metadata: outboundMetadata as Prisma.InputJsonObject,
        });

        emitOrchestratorEvent('orchestrator.final.sent', {
          channel: 'telegram',
          conversationId: conversation.id,
          runId: runContext.runId,
          burstId: runContext.burstId,
          classifierDecision: runContext.classifierDecision,
          droppedCount: runContext.droppedSummary.length,
          externalId: telegramResponseId,
        });
      } catch (error) {
        logger.error('[telegramProcessor] Failed sending Telegram response', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
        result.error = 'Failed to send Telegram response';
      }
    }

    const finalized = await orchestrator.finalizeRun({ runContext });
    if (!finalized.nextRun) {
      break;
    }

    runContext = finalized.nextRun.runContext;
    activeRequest = finalized.nextRun.userRequest;
    activeCommand = null;
  }

  } finally {
    stopTyping();
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
    runContext?: RunContext;
  },
): Promise<ProcessMessageResult> {
  const conversationManager = getConversationManager();
  const agent = getExecutiveAgent();
  let traceContext = options?.runContext?.runId
    ? await createAiTraceRoot({
        runId: options.runContext.runId,
        pipeline: 'executive-agent',
        userId,
        channel: 'telegram',
        conversationId,
        inputPreview: userRequest,
        metadata: {
          source: 'telegram.messageProcessor',
          bootstrapped: true,
        },
      })
    : undefined;

  try {
    const recentMessages = await conversationManager.getRecentMessages(conversationId, 15);
    traceContext = traceContext ?? await createAiTraceRoot({
      runId: options?.runContext?.runId,
      pipeline: 'executive-agent',
      userId,
      channel: 'telegram',
      conversationId,
      inputPreview: userRequest,
      metadata: {
        source: 'telegram.messageProcessor',
        historyLength: recentMessages.length,
      },
    });
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
      channel: 'telegram',
      conversationHistory,
      progressContext: options?.progressContext,
      traceContext,
      abortSignal: options?.abortSignal,
      runContext: options?.runContext
        ? {
            runId: options.runContext.runId,
            burstId: options.runContext.burstId,
            classifierDecision: options.runContext.classifierDecision,
            priorPack: options.runContext.priorPack,
            droppedSummary: options.runContext.droppedSummary,
            setSelectedPack: options.runContext.setSelectedPack,
            isRunCurrent: options.runContext.isRunCurrent,
            isBurstStable: options.runContext.isBurstStable,
            consumeSteerEvents: options.runContext.consumeSteerEvents,
            hasPendingSteer: options.runContext.hasPendingSteer,
            markRunPhase: options.runContext.markRunPhase,
            getRunPhase: options.runContext.getRunPhase,
          }
        : undefined,
    });

    await finalizeAiTraceRun(traceContext, {
      status: agentResult.status === 'ok' ? 'OK' : 'FALLBACK',
      outputPreview: deriveOutputPreview(agentResult.response),
      errorMessage: agentResult.status === 'ok' ? null : agentResult.error ?? 'Executive Agent fallback',
      metadata: {
        memoryStored: agentResult.memoryStored,
        agentStatus: agentResult.status,
      },
    });

    return {
      success: agentResult.status === 'ok',
      response: agentResult.response,
      error: agentResult.status === 'ok' ? undefined : agentResult.error ?? 'Executive Agent fallback',
      metadata: agentResult.metadata,
    };
  } catch (error) {
    if (traceContext) {
      await finalizeAiTraceRun(traceContext, {
        status: deriveRunStatusFromError(error),
        outputPreview: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[telegramProcessor] Executive Agent error: ${message}`);

    return {
      success: false,
      response: "I did not finish that cleanly. Ask again and I'll retry it.",
      error: message,
    };
  }
}

function buildProgressContext({
  conversationId,
  conversationManager,
  adapter,
  canEmitProgress,
}: {
  conversationId: string;
  conversationManager: ReturnType<typeof getConversationManager>;
  adapter: Pick<ChannelAdapter, 'sendProgress'>;
  canEmitProgress?: () => boolean;
}): ProgressUpdateContext {
  return {
    channel: 'telegram',
    requestId: crypto.randomUUID(),
    conversationId,
    canEmitProgress,
    sendMessage: adapter.sendProgress,
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
