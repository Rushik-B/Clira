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
import { transcribeVoiceMemo } from '@/lib/ai/transcribeVoiceMemo';
import { describeIncomingImage } from '@/lib/ai/describeIncomingImage';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';
import type { ProgressUpdateEvent } from '@/lib/ai/progressTypes';
import {
  getMessagingOrchestrator,
  type RunContext,
} from '@/lib/services/messaging-orchestration';

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
type Command = 'send' | 'save' | 'clear' | 'cancel' | 'help' | null;

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

/**
 * In-flight run tracker: per-conversation abort controller and run id.
 * When a new message arrives, we abort the previous run so only the latest run can send.
 * Prevents "double texting" (e.g. user asks something then says "nvm" but both answers get sent).
 */
const inFlightRuns = new Map<
  string,
  { abortController: AbortController; runId: number }
>();
let runIdCounter = 0;

function isAbortError(e: unknown): boolean {
  if (e && typeof e === 'object') {
    // Our LLM wrapper throws LlmError with a `code` field.
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

// ─────────────────────────────────────────────────────────────────────────────
// Command Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects if a message is a command.
 * Commands are case-insensitive and can include variations.
 */
function detectCommand(text: string): Command {
  const normalized = text.toLowerCase().trim();

  // Send command: user wants to send the current draft
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

  // Save command: user wants to save the draft to Gmail drafts
  if (
    normalized === 'save' ||
    normalized === 'save it' ||
    normalized === 'save draft' ||
    normalized === 'save as draft' ||
    normalized === 'save to drafts'
  ) {
    return 'save';
  }

  // Clear command: reset the conversation
  if (
    normalized === 'clear' ||
    normalized === 'reset' ||
    normalized === 'start over' ||
    normalized === 'new conversation' ||
    normalized === 'clear conversation'
  ) {
    return 'clear';
  }

  // Cancel command: discard the current draft
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

  // Help command: show available commands
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

  logger.info(
    `[messageProcessor] Processing message: waId=${waId.slice(0, 4)}**** ${message.audioMediaId ? 'voice memo' : message.imageMediaId ? 'image' : `text=\"${message.text.slice(0, 50)}...\"`}`,
  );

  if (messageId) {
    const isDuplicate = await conversationManager.hasInboundMessageWithWaMessageId(messageId);
    if (isDuplicate) {
      logger.info('[messageProcessor] Duplicate inbound WhatsApp message detected, skipping', {
        waId: `${waId.slice(0, 4)}****`,
        messageId,
      });
      return { success: true, response: '' };
    }
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

  // Resolve effective text: for voice memos transcribe, for images describe, and for text use as-is (no media storage).
  let effectiveText: string;
  let abortController: AbortController | null = null;
  let myRunId: number | null = null;

  if (message.audioMediaId || message.imageMediaId) {
    abortController = new AbortController();
    myRunId = ++runIdCounter;
    inFlightRuns.set(conversation.id, { abortController, runId: myRunId });

    try {
      if (message.audioMediaId) {
        const media = await whatsappClient.getMediaBuffer(message.audioMediaId);
        effectiveText = await transcribeVoiceMemo(media.data, media.mimeType, {
          abortSignal: abortController.signal,
        });

        if (!effectiveText.trim() || isVoiceMemoNoContent(effectiveText)) {
          if (inFlightRuns.get(conversation.id)?.runId === myRunId) {
            inFlightRuns.delete(conversation.id);
          }
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

        logger.info('[messageProcessor] Voice memo transcribed', {
          waId: `${waId.slice(0, 4)}****`,
          transcriptLength: effectiveText.length,
        });
      } else {
        const media = await whatsappClient.getMediaBuffer(message.imageMediaId!);
        const description = await describeIncomingImage(media.data, media.mimeType, {
          abortSignal: abortController.signal,
        });
        const caption = message.imageCaption?.trim();
        effectiveText = [
          'User sent an image on WhatsApp.',
          caption ? `User caption: ${caption}` : null,
          'Detailed image description:',
          description,
        ]
          .filter(Boolean)
          .join('\n\n');

        logger.info('[messageProcessor] Image described', {
          waId: `${waId.slice(0, 4)}****`,
          descriptionLength: description.length,
          hasCaption: Boolean(caption),
        });
      }
    } catch (e) {
      if (inFlightRuns.get(conversation.id)?.runId === myRunId) {
        inFlightRuns.delete(conversation.id);
      }

      if (isAbortError(e)) {
        logger.debug(
          message.audioMediaId
            ? '[messageProcessor] Voice memo superseded by new message'
            : '[messageProcessor] Image processing superseded by new message',
        );
        return { success: true, response: '' };
      }

      logger.error(
        message.audioMediaId
          ? '[messageProcessor] Voice memo download or transcription failed'
          : '[messageProcessor] Image download or description failed',
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
            : "I couldn't process that image. Please try sending it again or send a text message.",
        );
      } catch (sendErr) {
        logger.error(
          message.audioMediaId
            ? '[messageProcessor] Failed to send voice-memo error message'
            : '[messageProcessor] Failed to send image-processing error message',
          { sendErr },
        );
      }

      return {
        success: false,
        response: '',
        error: message.audioMediaId ? 'Voice memo processing failed' : 'Image processing failed',
      };
    }
  } else {
    effectiveText = message.text;
  }

  // Step 4: Add user message to the conversation (transcript for voice, text for text)
  await conversationManager.addMessage(conversation.id, {
    content: effectiveText,
    role: 'USER',
    direction: 'INBOUND',
    waMessageId: messageId,
    metadata: message.audioMediaId
      ? { senderName, fromVoiceMemo: true }
      : message.imageMediaId
        ? { senderName, fromImage: true, imageCaption: message.imageCaption ?? null }
        : { senderName },
  });

  // Step 5: Detect and handle commands
  let activeCommand: Command = detectCommand(effectiveText);
  if (activeCommand) {
    logger.info(`[messageProcessor] Detected command: ${activeCommand}`);
  }
  if (myRunId !== null && inFlightRuns.get(conversation.id)?.runId === myRunId) {
    inFlightRuns.delete(conversation.id);
  }

  const orchestrator = getMessagingOrchestrator();
  const orchestrationDecision = await orchestrator.prepareRun({
    channel: 'whatsapp',
    conversationId: conversation.id,
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
    const progressContext = buildProgressContext({
      conversationId: conversation.id,
      waId,
      conversationManager,
      whatsappClient,
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

    if (result.response && await runContext.isRunCurrent()) {
      try {
        const { messageId: waResponseId } = await whatsappClient.sendMessage(waId, result.response);
        const outboundMetadata =
          result.metadata != null && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
            ? { ...(result.metadata as Record<string, unknown>) }
            : {};
        outboundMetadata.burstId = runContext.burstId;
        outboundMetadata.runId = runContext.runId;
        outboundMetadata.superseded = false;

        await conversationManager.addMessage(conversation.id, {
          content: result.response,
          role: 'ASSISTANT',
          direction: 'OUTBOUND',
          waMessageId: waResponseId,
          metadata: outboundMetadata as Prisma.InputJsonObject,
        });

        logger.info(
          `[messageProcessor] Response sent: waId=${waId.slice(0, 4)}**** responseId=${waResponseId}`,
        );
      } catch (error) {
        logger.error(`[messageProcessor] Failed to send WhatsApp response: ${error}`);
        result.error = 'Failed to send WhatsApp response';
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

  try {
    // Get conversation history for context
    const recentMessages = await conversationManager.getRecentMessages(conversationId, 15);

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
      abortSignal: options?.abortSignal,
      runContext: options?.runContext
        ? {
            runId: options.runContext.runId,
            burstId: options.runContext.burstId,
            isRunCurrent: options.runContext.isRunCurrent,
            isBurstStable: options.runContext.isBurstStable,
          }
        : undefined,
    });

    return {
      success: agentResult.status === 'ok',
      response: agentResult.response,
      error: agentResult.status === 'ok' ? undefined : agentResult.error ?? 'Executive Agent fallback',
      metadata: agentResult.metadata,
    };
  } catch (error) {
    if (isAbortError(error)) {
      // Let the caller decide whether to send a response. For superseded runs,
      // the outer handler will swallow and avoid "double texting".
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[messageProcessor] Executive Agent error: ${message}`);

    return {
      success: false,
      response: "Hmm, something went wrong on my end. Can you try that again?",
      error: message,
    };
  }
}

function buildProgressContext({
  conversationId,
  waId,
  conversationManager,
  whatsappClient,
  canEmitProgress,
}: {
  conversationId: string;
  waId: string;
  conversationManager: ReturnType<typeof getConversationManager>;
  whatsappClient: ReturnType<typeof getWhatsAppClient>;
  canEmitProgress?: () => boolean;
}): ProgressUpdateContext {
  return {
    channel: 'whatsapp',
    requestId: crypto.randomUUID(),
    conversationId,
    canEmitProgress,
    sendMessage: async (text) => {
      const { messageId } = await whatsappClient.sendMessage(waId, text);
      return { externalId: messageId };
    },
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
  requestId,
  canEmitProgress,
}: {
  conversationId: string;
  conversationManager: ReturnType<typeof getConversationManager>;
  emitWebProgress: (event: ProgressUpdateEvent) => Promise<void> | void;
  requestId?: string;
  canEmitProgress?: () => boolean;
}): ProgressUpdateContext {
  return {
    channel: 'web',
    requestId: requestId ?? crypto.randomUUID(),
    conversationId,
    canEmitProgress,
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
  options?: { onProgress?: (event: ProgressUpdateEvent) => Promise<void> | void; requestId?: string },
): Promise<ProcessMessageResult> {
  const conversationManager = getConversationManager();

  // Use a synthetic waId for web chat conversations
  const webWaId = 'web-test';

  logger.info(`[messageProcessor] Processing web chat: userId=${userId.slice(0, 8)}...`);

  // Get or create conversation
  const conversation = await conversationManager.getOrCreateConversation(userId, webWaId);

  // Add user message to the conversation
  await conversationManager.addMessage(conversation.id, {
    content: message,
    role: 'USER',
    direction: 'INBOUND',
  });

  let activeCommand: Command = detectCommand(message);
  if (activeCommand) {
    logger.info(`[messageProcessor] Detected command: ${activeCommand}`);
  }

  const orchestrator = getMessagingOrchestrator();
  const orchestrationDecision = await orchestrator.prepareRun({
    channel: 'web',
    conversationId: conversation.id,
    userRequest: message,
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

    if (result.response && await runContext.isRunCurrent()) {
      const outboundMetadata =
        result.metadata != null && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
          ? { ...(result.metadata as Record<string, unknown>) }
          : {};
      outboundMetadata.burstId = runContext.burstId;
      outboundMetadata.runId = runContext.runId;
      outboundMetadata.superseded = false;

      await conversationManager.addMessage(conversation.id, {
        content: result.response,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        metadata: outboundMetadata as Prisma.InputJsonObject,
      });
    }

    const finalized = await orchestrator.finalizeRun({ runContext });
    if (!finalized.nextRun) {
      break;
    }

    runContext = finalized.nextRun.runContext;
    activeRequest = finalized.nextRun.userRequest;
    activeCommand = null;
  }

  return result;
}
