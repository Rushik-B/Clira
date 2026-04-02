/**
 * WhatsApp Message Processor
 *
 * Handles incoming WhatsApp messages by:
 * 1. Looking up the user by their WhatsApp phone number
 * 2. Managing conversation state (get/create)
 * 3. Detecting commands (send, save, clear, cancel)
 * 4. Invoking the Executive Agent for natural language requests
 * 5. Persisting messages and drafts to the database
 * 6. Sending responses back via WhatsApp
 *
 * This module is designed to be called asynchronously after webhook acknowledgment
 * to avoid HTTP timeout issues.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { Prisma } from '@prisma/client';
import {
  getWhatsAppClient,
  getConversationManager,
  type WhatsAppWebhookMessage,
} from '@/lib/services/whatsapp';
import { getExecutiveAgent, type ExecutiveAgentOutput } from '@/lib/ai/agents/executiveAgent';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';
import type { ProgressUpdateEvent } from '@/lib/ai/progressTypes';
import {
  createAiTraceRoot,
  deriveOutputPreview,
  deriveRunStatusFromError,
  finalizeAiTraceRun,
} from '@/lib/ai/tracing';
import {
  buildOrchestrationMessageMetadata,
  detectMessagingCommand,
  emitOrchestratorEvent,
  getMessagingOrchestrator,
  getDuplicateInboundMessageIdFromAdapter,
  isAbortError,
  type ChannelAdapter,
  type MessagingCommand,
  type RunContext,
} from '@/lib/services/messaging-orchestration';
import {
  buildInlineBufferProvenance,
  createStoredContentReference,
  extractContentFromBuffer,
  ingestWebChatUploads,
  formatMessagingMediaForAgent,
  renderContentExtractionForLegacyText,
} from '@/lib/services/content-ingestion';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessMessageResult {
  success: boolean;
  response: string;
  error?: string;
  /** Tool call metadata from ExecutiveAgent */
  metadata?: Prisma.InputJsonObject;
}

/** Commands that trigger special handling instead of agent invocation */
type Command = MessagingCommand;

/** Transcript phrases that mean "no speech / unintelligible" — fast-fallback without running EA */
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

// ─────────────────────────────────────────────────────────────────────────────
// Command Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles the "send" command - delegates to agent to send email.
 * The agent will use the send_email tool if there's a draft in conversation history.
 */
async function handleSendCommand(
  userId: string,
  userEmail: string,
  conversationId: string,
  options?: {
    progressContext?: ProgressUpdateContext;
    runContext?: RunContext;
    abortSignal?: AbortSignal;
    channel?: 'whatsapp' | 'web';
  },
): Promise<ProcessMessageResult> {
  // Delegate to the agent - it will check conversation history for draft details
  // and use the send_email tool if appropriate
  return runExecutiveAgent(userId, userEmail, conversationId, 'send', options);
}

/**
 * Handles the "save" command - delegates to agent to save draft.
 * The agent will check conversation history and save to Gmail drafts if appropriate.
 */
async function handleSaveCommand(
  userId: string,
  userEmail: string,
  conversationId: string,
  options?: {
    progressContext?: ProgressUpdateContext;
    runContext?: RunContext;
    abortSignal?: AbortSignal;
    channel?: 'whatsapp' | 'web';
  },
): Promise<ProcessMessageResult> {
  // Delegate to the agent - it will check conversation history for draft details
  return runExecutiveAgent(userId, userEmail, conversationId, 'save to drafts', options);
}

/**
 * Handles the "clear" command - resets the conversation.
 */
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
    response: "Fresh start! What can I help you with?",
  };
}

/**
 * Handles the "cancel" command - clears the conversation.
 */
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
    response: "Conversation cleared. What else can I help with?",
  };
}

/**
 * Handles the "help" command - shows available commands.
 */
function handleHelpCommand(): ProcessMessageResult {
  const helpText = `Here's what I can do:

*Draft emails* - Just tell me who to email and what to say
*send* - Send the current draft
*save* - Save draft to Gmail drafts
*cancel* - Discard current draft
*clear* - Start fresh

I can also check your calendar, search emails, and remember your preferences. Just ask!`;

  return {
    success: true,
    response: helpText,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Processor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes an incoming WhatsApp message.
 *
 * This is the main entry point called by the webhook handler.
 * It handles user lookup, command detection, agent invocation, and response sending.
 *
 * @param message - Parsed WhatsApp webhook message
 * @returns Processing result with response text
 */
export async function processWhatsAppMessage(
  message: WhatsAppWebhookMessage,
): Promise<ProcessMessageResult> {
  const { waId, messageId, senderName } = message;
  const conversationManager = getConversationManager();
  const whatsappClient = getWhatsAppClient();
  let activeConversationId = '';
  let effectiveText = message.text;
  let inboundMetadata: Prisma.InputJsonObject = { senderName };

  const adapter: ChannelAdapter = {
    channel: 'whatsapp',
    conversationId: () => activeConversationId,
    messageIdForDedupe: () => messageId ?? null,
    persistInbound: async () => {
      if (!activeConversationId) {
        throw new Error('whatsapp_inbound_persist_missing_conversation_id');
      }
      await conversationManager.addMessage(activeConversationId, {
        content: effectiveText,
        role: 'USER',
        direction: 'INBOUND',
        waMessageId: messageId,
        metadata: inboundMetadata,
      });
    },
    sendFinal: async (text: string) => {
      const { messageId: externalId } = await whatsappClient.sendMessage(waId, text);
      return { externalId };
    },
    sendProgress: async (text: string) => {
      const { messageId: externalId } = await whatsappClient.sendMessage(waId, text);
      return { externalId };
    },
  };

  logger.info(
    `[messageProcessor] Processing message: waId=${waId.slice(0, 4)}**** ${
      message.audioMediaId
        ? 'voice memo'
        : message.imageMediaId
          ? 'image'
          : message.pdfMediaId
            ? 'pdf'
            : `text=\"${message.text.slice(0, 50)}...\"`
    }`,
  );

  const duplicateMessageId = await getDuplicateInboundMessageIdFromAdapter(
    adapter,
    (id) => conversationManager.hasInboundMessageWithWaMessageId(id),
  );
  if (duplicateMessageId) {
    logger.info('[messageProcessor] Duplicate inbound WhatsApp message detected, skipping', {
      waId: `${waId.slice(0, 4)}****`,
      messageId: duplicateMessageId,
    });
    return { success: true, response: '' };
  }

  // ⚡️ INSTANTLY show typing indicator (The "Human" Touch)
  // Shows blue ticks (read) + "typing..." animation to indicate Clira is processing
  // This provides immediate visual feedback while the Executive Agent thinks
  // The typing indicator auto-dismisses when we send our response (or after 25s max)
  if (messageId) {
    // Fire-and-forget with retry - don't block message processing
    whatsappClient.sendTypingIndicatorWithRetry(messageId).catch((error) => {
      logger.debug(`[messageProcessor] Typing indicator failed (non-blocking): ${error}`);
    });
  }

  // Step 1: Look up user by WhatsApp phone number
  let userId = await conversationManager.findUserByWhatsAppNumber(waId);

  // If not found with verified check, try without verification (for new users)
  if (!userId) {
    userId = await conversationManager.findUserByWhatsAppNumberUnverified(waId);

    // If found but unverified, auto-verify on first message
    if (userId) {
      logger.info(`[messageProcessor] Auto-verifying WhatsApp number for user ${userId.slice(0, 8)}...`);
      await conversationManager.verifyWhatsAppNumber(waId);
    }
  }

  if (!userId) {
    logger.warn(`[messageProcessor] Unknown WhatsApp user: waId=${waId.slice(0, 4)}****`);

    // Send a helpful response to unknown users (3 short messages)
    const unknownUserMessages = [
      "Umm.. I dont know who you are...",
      "New to Clira? Sign up at app.tryclira.com/signin.",
      "Signed up already? Go to Settings → WhatsApp in the app and link this number. Then we're good to go :)",
    ];

    try {
      for (const msg of unknownUserMessages) {
        await whatsappClient.sendMessage(waId, msg);
      }
    } catch (error) {
      logger.error(`[messageProcessor] Failed to send unknown user response: ${error}`);
    }

    return {
      success: false,
      response: unknownUserMessages.join('\n'),
      error: 'User not found',
    };
  }

  // Step 2: Get user's email for agent context
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user?.email) {
    logger.error(`[messageProcessor] User ${userId} has no email`);
    return {
      success: false,
      response: "Something went wrong with your account. Please try reconnecting.",
      error: 'User email not found',
    };
  }

  // Step 3: Get or create conversation
  const conversation = await conversationManager.getOrCreateConversation(userId, waId);
  activeConversationId = conversation.id;

  // Resolve effective text: for voice memos transcribe, for images describe,
  // for PDFs extract document context, and for text use as-is.
  if (message.audioMediaId || message.imageMediaId || message.pdfMediaId) {
    try {
      if (message.audioMediaId) {
        const media = await whatsappClient.getMediaBuffer(message.audioMediaId);
        const contentReference = await createStoredContentReference({
          userId,
          buffer: media.data,
          mimeHint: media.mimeType,
          trustClass: 'user_provided',
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'WhatsApp voice memo',
            sourceKind: 'whatsapp_media',
            channel: 'whatsapp',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.audioMediaId,
          }),
        });
        const extraction = await extractContentFromBuffer({
          buffer: media.data,
          mimeType: media.mimeType,
          channelLabel: 'WhatsApp',
          scope: {
            conversationId: conversation.id,
          },
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'WhatsApp voice memo',
            sourceKind: 'whatsapp_media',
            channel: 'whatsapp',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.audioMediaId,
          }),
        });
        effectiveText = renderContentExtractionForLegacyText(extraction);

        if (!effectiveText.trim() || isVoiceMemoNoContent(effectiveText)) {
          logger.info('[messageProcessor] Voice memo had no content, fast fallback', {
            waId: `${waId.slice(0, 4)}****`,
            transcript: effectiveText.slice(0, 60),
          });
          try {
            await whatsappClient.sendMessage(
              waId,
              "i couln't make out what you said. mind repeating?",
            );
          } catch (sendErr) {
            logger.error('[messageProcessor] Failed to send empty-transcript message', { sendErr });
          }
          return {
            success: false,
            response: '',
            error: 'Voice memo transcription empty or no content',
          };
        }

        inboundMetadata = {
          senderName,
          fromVoiceMemo: true,
          contentRefIds: [contentReference.contentRefId],
        };

        logger.info('[messageProcessor] Voice memo transcribed', {
          waId: `${waId.slice(0, 4)}****`,
          transcriptLength: effectiveText.length,
          extractionStatus: extraction.status,
          degradationCodes: extraction.degradationNotes.map((note) => note.code),
        });
      } else if (message.imageMediaId) {
        const media = await whatsappClient.getMediaBuffer(message.imageMediaId!);
        const caption = message.imageCaption?.trim();
        const contentReference = await createStoredContentReference({
          userId,
          buffer: media.data,
          mimeHint: media.mimeType,
          trustClass: 'user_provided',
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'WhatsApp image',
            sourceKind: 'whatsapp_media',
            channel: 'whatsapp',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.imageMediaId,
          }),
        });
        const extraction = await extractContentFromBuffer({
          buffer: media.data,
          mimeType: media.mimeType,
          channelLabel: 'WhatsApp',
          userCaption: caption,
          scope: {
            conversationId: conversation.id,
          },
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'WhatsApp image',
            sourceKind: 'whatsapp_media',
            channel: 'whatsapp',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.imageMediaId,
          }),
        });
        effectiveText = formatMessagingMediaForAgent({
          channelLabel: 'WhatsApp',
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

        logger.info('[messageProcessor] Image described', {
          waId: `${waId.slice(0, 4)}****`,
          descriptionLength: extraction.extractedText.length,
          hasCaption: Boolean(caption),
          extractionStatus: extraction.status,
          degradationCodes: extraction.degradationNotes.map((note) => note.code),
        });
      } else {
        const media = await whatsappClient.getMediaBuffer(message.pdfMediaId!);
        const caption = message.pdfCaption?.trim();
        const contentReference = await createStoredContentReference({
          userId,
          buffer: media.data,
          displayName: message.pdfFilename ?? null,
          mimeHint: message.pdfMimeType ?? media.mimeType,
          trustClass: 'user_provided',
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'WhatsApp PDF',
            sourceKind: 'whatsapp_media',
            channel: 'whatsapp',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.pdfMediaId,
          }),
        });
        const extraction = await extractContentFromBuffer({
          buffer: media.data,
          mimeType: message.pdfMimeType ?? media.mimeType,
          channelLabel: 'WhatsApp',
          filename: message.pdfFilename ?? null,
          userCaption: caption,
          scope: {
            conversationId: conversation.id,
          },
          provenance: buildInlineBufferProvenance({
            sourceLabel: 'WhatsApp PDF',
            sourceKind: 'whatsapp_media',
            channel: 'whatsapp',
            conversationId: conversation.id,
            messageId,
            attachmentId: message.pdfMediaId,
          }),
        });
        effectiveText = formatMessagingMediaForAgent({
          channelLabel: 'WhatsApp',
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

        logger.info('[messageProcessor] PDF extracted', {
          waId: `${waId.slice(0, 4)}****`,
          filename: message.pdfFilename ?? null,
          extractionLength: extraction.extractedText.length,
          hasCaption: Boolean(caption),
          extractionStatus: extraction.status,
          degradationCodes: extraction.degradationNotes.map((note) => note.code),
        });
      }
    } catch (e) {
      if (isAbortError(e)) {
        logger.debug(
          message.audioMediaId
            ? '[messageProcessor] Voice memo superseded by new message'
            : message.imageMediaId
              ? '[messageProcessor] Image processing superseded by new message'
              : '[messageProcessor] PDF processing superseded by new message',
        );
        return { success: true, response: '' };
      }

      logger.error(
        message.audioMediaId
          ? '[messageProcessor] Voice memo download or transcription failed'
          : message.imageMediaId
            ? '[messageProcessor] Image download or description failed'
            : '[messageProcessor] PDF download or extraction failed',
        {
          waId: `${waId.slice(0, 4)}****`,
          error: e instanceof Error ? e.message : String(e),
        },
      );

      try {
        await whatsappClient.sendMessage(
          waId,
          message.audioMediaId
            ? "I couldn't process that voice memo. Please try again or send a text message."
            : message.imageMediaId
              ? "I couldn't process that image. Please try sending it again or send a text message."
              : "I couldn't process that PDF. Please try sending it again or send a text message.",
        );
      } catch (sendErr) {
        logger.error(
          message.audioMediaId
            ? '[messageProcessor] Failed to send voice-memo error message'
            : message.imageMediaId
              ? '[messageProcessor] Failed to send image-processing error message'
              : '[messageProcessor] Failed to send pdf-processing error message',
          { sendErr },
        );
      }

      return {
        success: false,
        response: '',
        error: message.audioMediaId
          ? 'Voice memo processing failed'
          : message.imageMediaId
            ? 'Image processing failed'
            : 'PDF processing failed',
      };
    }
  } else {
    effectiveText = message.text;
    inboundMetadata = { senderName };
  }

  // Step 4: Add user message to the conversation (transcript for voice, text for text)
  await adapter.persistInbound();

  // Step 5: Detect and handle commands
  let activeCommand: Command = detectMessagingCommand(effectiveText);
  if (activeCommand) {
    logger.info(`[messageProcessor] Detected command: ${activeCommand}`);
  }

  const orchestrator = getMessagingOrchestrator();
  const orchestrationDecision = await orchestrator.prepareRunWithAdapter({
    adapter,
    userRequest: effectiveText,
    isCommand: Boolean(activeCommand),
  });

  if (orchestrationDecision.kind === 'skip') {
    logger.info('[messageProcessor] Orchestrator skip accepted as terminal', {
      channel: 'whatsapp',
      conversationId: conversation.id,
      waId: `${waId.slice(0, 4)}****`,
      messageId,
      reason: orchestrationDecision.reason,
    });
    return { success: true, response: '' };
  }

  let runContext = orchestrationDecision.runContext;
  let activeRequest = orchestrationDecision.userRequest;
  let result: ProcessMessageResult = { success: true, response: '' };

  while (runContext) {
    const progressContext = buildProgressContext({
      conversationId: conversation.id,
      conversationManager,
      adapter,
      canEmitProgress: runContext.canEmitProgress,
    });

    try {
      if (activeCommand === 'send') {
        result = await handleSendCommand(userId, user.email, conversation.id, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
          channel: 'whatsapp',
        });
      } else if (activeCommand === 'save') {
        result = await handleSaveCommand(userId, user.email, conversation.id, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
          channel: 'whatsapp',
        });
      } else if (activeCommand === 'clear') {
        result = await handleClearCommand(conversation.id);
      } else if (activeCommand === 'cancel') {
        result = await handleCancelCommand(conversation.id);
      } else if (activeCommand === 'help') {
        result = handleHelpCommand();
      } else {
        result = await runExecutiveAgent(userId, user.email, conversation.id, activeRequest, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
          channel: 'whatsapp',
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        logger.debug('[messageProcessor] Run superseded by new message, not sending');
        return { success: true, response: '' };
      }
      throw error;
    }

    const finalized = await orchestrator.finalizeRun({ runContext });

    if (result.response && finalized.shouldSendCurrentResponse) {
      try {
        const { externalId: waResponseId } = await adapter.sendFinal(result.response);
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
          waMessageId: waResponseId,
          metadata: outboundMetadata as Prisma.InputJsonObject,
        });

        emitOrchestratorEvent('orchestrator.final.sent', {
          channel: 'whatsapp',
          conversationId: conversation.id,
          runId: runContext.runId,
          burstId: runContext.burstId,
          classifierDecision: runContext.classifierDecision,
          droppedCount: runContext.droppedSummary.length,
          externalId: waResponseId,
        });

        logger.info(
          `[messageProcessor] Response sent: waId=${waId.slice(0, 4)}**** responseId=${waResponseId}`,
        );
      } catch (error) {
        logger.error(`[messageProcessor] Failed to send WhatsApp response: ${error}`);
        result.error = 'Failed to send WhatsApp response';
      }
    }

    if (!finalized.nextRun) {
      break;
    }

    runContext = finalized.nextRun.runContext;
    activeRequest = finalized.nextRun.userRequest;
    activeCommand = null;
  }

  return result;
}

/**
 * Runs the Executive Agent to process a natural language request.
 */
async function runExecutiveAgent(
  userId: string,
  userEmail: string,
  conversationId: string,
  userRequest: string,
  options?: {
    progressContext?: ProgressUpdateContext;
    abortSignal?: AbortSignal;
    runContext?: RunContext;
    channel?: 'whatsapp' | 'web';
  },
): Promise<ProcessMessageResult> {
  const conversationManager = getConversationManager();
  const agent = getExecutiveAgent();
  let traceContext = options?.runContext?.runId
    ? await createAiTraceRoot({
        runId: options.runContext.runId,
        pipeline: 'executive-agent',
        userId,
        channel: options?.channel ?? 'whatsapp',
        conversationId,
        inputPreview: userRequest,
        metadata: {
          source: 'whatsapp.messageProcessor',
          bootstrapped: true,
        },
      })
    : undefined;

  try {
    // Get conversation history for context
    const recentMessages = await conversationManager.getRecentMessages(conversationId, 15);
    traceContext = traceContext ?? await createAiTraceRoot({
      runId: options?.runContext?.runId,
      pipeline: 'executive-agent',
      userId,
      channel: options?.channel ?? 'whatsapp',
      conversationId,
      inputPreview: userRequest,
      metadata: {
        source: 'whatsapp.messageProcessor',
        historyLength: recentMessages.length,
      },
    });

    // Format conversation history for the agent
    // Include metadata to provide tool call context (especially send_email actions)
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

    // Run the agent (abortSignal allows cancelling this run when user sends a newer message)
    const agentResult: ExecutiveAgentOutput = await agent.process({
      userId,
      userEmail,
      userRequest,
      conversationId,
      channel: options?.channel ?? 'whatsapp',
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
      // Let the caller decide whether to send a response. For superseded runs,
      // the outer handler will swallow and avoid "double texting".
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[messageProcessor] Executive Agent error: ${message}`);

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
    channel: 'whatsapp',
    requestId: crypto.randomUUID(),
    conversationId,
    canEmitProgress,
    sendMessage: adapter.sendProgress,
    persistMessage: async ({ content, metadata, externalId }) => {
      await conversationManager.addMessage(conversationId, {
        content,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        waMessageId: externalId,
        metadata,
      });
    },
  };
}

function buildWebProgressContext({
  conversationId,
  conversationManager,
  emitWebProgress,
  adapter,
  requestId,
  canEmitProgress,
}: {
  conversationId: string;
  conversationManager: ReturnType<typeof getConversationManager>;
  emitWebProgress: (event: ProgressUpdateEvent) => Promise<void> | void;
  adapter: Pick<ChannelAdapter, 'sendProgress'>;
  requestId?: string;
  canEmitProgress?: () => boolean;
}): ProgressUpdateContext {
  return {
    channel: 'web',
    requestId: requestId ?? crypto.randomUUID(),
    conversationId,
    canEmitProgress,
    sendMessage: adapter.sendProgress,
    emitWebProgress,
    persistMessage: async ({ content, metadata }) => {
      await conversationManager.addMessage(conversationId, {
        content,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        metadata,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Chat Handler (for testing without WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes a message from the web chat interface.
 * Similar to processWhatsAppMessage but without WhatsApp API calls.
 *
 * @param userId - The authenticated user's ID
 * @param userEmail - The user's email address
 * @param message - The message text
 * @returns Processing result with response text
 */
export async function processWebChatMessage(
  userId: string,
  userEmail: string,
  message: string,
  options?: {
    onProgress?: (event: ProgressUpdateEvent) => Promise<void> | void;
    requestId?: string;
    uploads?: Array<{
      filename?: string | null;
      mediaType?: string | null;
      url: string;
    }>;
  },
): Promise<ProcessMessageResult> {
  const conversationManager = getConversationManager();

  // Use a synthetic waId for web chat conversations
  const webWaId = 'web-test';
  let activeConversationId = '';
  let effectiveText = message;
  let inboundMetadata: Prisma.InputJsonObject | undefined;

  const adapter: ChannelAdapter = {
    channel: 'web',
    conversationId: () => activeConversationId,
    messageIdForDedupe: () => null,
    persistInbound: async () => {
      if (!activeConversationId) {
        throw new Error('web_inbound_persist_missing_conversation_id');
      }
      await conversationManager.addMessage(activeConversationId, {
        content: effectiveText,
        role: 'USER',
        direction: 'INBOUND',
        ...(inboundMetadata ? { metadata: inboundMetadata } : {}),
      });
    },
    sendFinal: async () => ({}),
    sendProgress: async () => ({}),
  };

  logger.info(`[messageProcessor] Processing web chat: userId=${userId.slice(0, 8)}...`);

  // Get or create conversation
  const conversation = await conversationManager.getOrCreateConversation(userId, webWaId);
  activeConversationId = conversation.id;

  if ((options?.uploads?.length ?? 0) > 0) {
    const uploadIngestion = await ingestWebChatUploads({
      userId,
      conversationId: conversation.id,
      runId: options?.requestId ?? 'web-chat-upload',
      uploads: options?.uploads ?? [],
    });

    effectiveText = [message.trim(), uploadIngestion.appendedText]
      .filter(Boolean)
      .join('\n\n');
    inboundMetadata = {
      uploadedFiles: uploadIngestion.uploadMetadata,
      uploadCount: options?.uploads?.length ?? 0,
      contentRefIds: uploadIngestion.contentRefs.map((reference) => reference.contentRefId),
    };
  }

  // Add user message to the conversation
  await adapter.persistInbound();

  let activeCommand: Command = detectMessagingCommand(effectiveText);
  if (activeCommand) {
    logger.info(`[messageProcessor] Detected command: ${activeCommand}`);
  }

  const orchestrator = getMessagingOrchestrator();
  const orchestrationDecision = await orchestrator.prepareRunWithAdapter({
    adapter,
    userRequest: effectiveText,
    isCommand: Boolean(activeCommand),
  });

  if (orchestrationDecision.kind === 'skip') {
    return { success: true, response: '' };
  }

  let runContext = orchestrationDecision.runContext;
  let activeRequest = orchestrationDecision.userRequest;
  let result: ProcessMessageResult = { success: true, response: '' };

  while (runContext) {
    const progressContext = options?.onProgress
      ? buildWebProgressContext({
          conversationId: conversation.id,
          conversationManager,
          emitWebProgress: options.onProgress,
          adapter,
          requestId: options.requestId,
          canEmitProgress: runContext.canEmitProgress,
        })
      : undefined;

    try {
      if (activeCommand === 'send') {
        result = await handleSendCommand(userId, userEmail, conversation.id, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
          channel: 'web',
        });
      } else if (activeCommand === 'save') {
        result = await handleSaveCommand(userId, userEmail, conversation.id, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
          channel: 'web',
        });
      } else if (activeCommand === 'clear') {
        result = await handleClearCommand(conversation.id);
      } else if (activeCommand === 'cancel') {
        result = await handleCancelCommand(conversation.id);
      } else if (activeCommand === 'help') {
        result = handleHelpCommand();
      } else {
        result = await runExecutiveAgent(userId, userEmail, conversation.id, activeRequest, {
          progressContext,
          runContext,
          abortSignal: runContext.abortSignal,
          channel: 'web',
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        return { success: true, response: '' };
      }
      throw error;
    }

    const finalized = await orchestrator.finalizeRun({ runContext });

    if (result.response && finalized.shouldSendCurrentResponse) {
      await adapter.sendFinal(result.response);
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
        metadata: outboundMetadata as Prisma.InputJsonObject,
      });

      emitOrchestratorEvent('orchestrator.final.sent', {
        channel: 'web',
        conversationId: conversation.id,
        runId: runContext.runId,
        burstId: runContext.burstId,
        classifierDecision: runContext.classifierDecision,
        droppedCount: runContext.droppedSummary.length,
      });
    }

    if (!finalized.nextRun) {
      break;
    }

    runContext = finalized.nextRun.runContext;
    activeRequest = finalized.nextRun.userRequest;
    activeCommand = null;
  }

  return result;
}
