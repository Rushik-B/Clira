/**
 * Twilio SMS/RCS Message Processor
 *
 * Handles incoming Twilio messages by:
 * 1. Looking up the user by their Twilio phone number
 * 2. Managing conversation state (get/create)
 * 3. Detecting commands (send, save, clear, cancel, help)
 * 4. Invoking the Executive Agent for natural language requests
 * 5. Persisting messages and drafts to the database
 * 6. Sending responses back via Twilio SMS/RCS
 *
 * This module is designed to be called asynchronously after webhook acknowledgment
 * to avoid HTTP timeout issues.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { Prisma } from '@prisma/client';
import {
  getTwilioClient,
  getConversationManager,
  type TwilioWebhookMessage,
} from '@/lib/services/twilio';
import { getExecutiveAgent, type ExecutiveAgentOutput } from '@/lib/ai/agents/executiveAgent';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';
import type { ProgressUpdateEvent } from '@/lib/ai/progressTypes';

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
  progressContext?: ProgressUpdateContext,
): Promise<ProcessMessageResult> {
  // Delegate to the agent - it will check conversation history for draft details
  // and use the send_email tool if appropriate
  return runExecutiveAgent(userId, userEmail, conversationId, 'send', { progressContext });
}

/**
 * Handles the "save" command - delegates to agent to save draft.
 * The agent will check conversation history and save to Gmail drafts if appropriate.
 */
async function handleSaveCommand(
  userId: string,
  userEmail: string,
  conversationId: string,
  progressContext?: ProgressUpdateContext,
): Promise<ProcessMessageResult> {
  // Delegate to the agent - it will check conversation history for draft details
  return runExecutiveAgent(userId, userEmail, conversationId, 'save to drafts', { progressContext });
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
 * Processes an incoming Twilio SMS/RCS message.
 *
 * This is the main entry point called by the webhook handler.
 * It handles user lookup, command detection, agent invocation, and response sending.
 *
 * @param message - Parsed Twilio webhook message
 * @returns Processing result with response text
 */
export async function processTwilioMessage(
  message: TwilioWebhookMessage,
): Promise<ProcessMessageResult> {
  const { from, body, messageSid } = message;
  const conversationManager = getConversationManager();
  const twilioClient = getTwilioClient();

  logger.info(
    `[messageProcessor] Processing message: from=${from.slice(0, 4)}**** text="${body.slice(0, 50)}..."`,
  );

  // Step 1: Look up user by Twilio phone number
  let userId = await conversationManager.findUserByTwilioNumber(from);

  // If not found with verified check, try without verification (for new users)
  if (!userId) {
    userId = await conversationManager.findUserByTwilioNumberUnverified(from);

    // If found but unverified, auto-verify on first message
    if (userId) {
      logger.info(`[messageProcessor] Auto-verifying Twilio number for user ${userId.slice(0, 8)}...`);
      await conversationManager.verifyTwilioNumber(from);
    }
  }

  if (!userId) {
    logger.warn(`[messageProcessor] Unknown Twilio user: from=${from.slice(0, 4)}****`);

    // Send a helpful response to unknown users (3 short messages)
    const unknownUserMessages = [
      "Umm.. I dont know who you are.",
      "New to Clira? Sign up at app.tryclira.com/signin.",
      "Already have an account? Go to Settings → SMS in the app and link this number. Then we're good to go :)",
    ];

    try {
      for (const msg of unknownUserMessages) {
        await twilioClient.sendMessage(from, msg);
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
  const conversation = await conversationManager.getOrCreateConversation(userId, from);

  // Step 4: Add user message to the conversation
  await conversationManager.addMessage(conversation.id, {
    content: body,
    role: 'USER',
    direction: 'INBOUND',
    twilioSid: messageSid,
  });

  // Step 5: Detect and handle commands
  const command = detectCommand(body);
  let result: ProcessMessageResult;

  if (command) {
    logger.info(`[messageProcessor] Detected command: ${command}`);

    switch (command) {
      case 'send':
        result = await handleSendCommand(
          userId,
          user.email,
          conversation.id,
          buildProgressContext({
            conversationId: conversation.id,
            phoneNumber: from,
            conversationManager,
            twilioClient,
          }),
        );
        break;
      case 'save':
        result = await handleSaveCommand(
          userId,
          user.email,
          conversation.id,
          buildProgressContext({
            conversationId: conversation.id,
            phoneNumber: from,
            conversationManager,
            twilioClient,
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
    // Step 6: Run Executive Agent for natural language requests
    result = await runExecutiveAgent(userId, user.email, conversation.id, body, {
      progressContext: buildProgressContext({
        conversationId: conversation.id,
        phoneNumber: from,
        conversationManager,
        twilioClient,
      }),
    });
  }

  // Step 7: Send response via Twilio SMS/RCS
  try {
    const { messageSid: twilioResponseSid } = await twilioClient.sendMessage(from, result.response);

    // Step 8: Add assistant message to the conversation with tool call metadata
    await conversationManager.addMessage(conversation.id, {
      content: result.response,
      role: 'ASSISTANT',
      direction: 'OUTBOUND',
      twilioSid: twilioResponseSid,
      metadata: result.metadata,
    });

    logger.info(
      `[messageProcessor] Response sent: from=${from.slice(0, 4)}**** responseId=${twilioResponseSid}`,
    );
  } catch (error) {
    logger.error(`[messageProcessor] Failed to send Twilio response: ${error}`);
    result.error = 'Failed to send Twilio response';
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
  options?: { progressContext?: ProgressUpdateContext },
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

    // Run the agent
    const agentResult: ExecutiveAgentOutput = await agent.process({
      userId,
      userEmail,
      userRequest,
      conversationId,
      conversationHistory,
      progressContext: options?.progressContext,
    });

    return {
      success: agentResult.status === 'ok',
      response: agentResult.response,
      error: agentResult.status === 'ok' ? undefined : agentResult.error ?? 'Executive Agent fallback',
      metadata: agentResult.metadata,
    };
  } catch (error) {
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
  phoneNumber,
  conversationManager,
  twilioClient,
}: {
  conversationId: string;
  phoneNumber: string;
  conversationManager: ReturnType<typeof getConversationManager>;
  twilioClient: ReturnType<typeof getTwilioClient>;
}): ProgressUpdateContext {
  return {
    channel: 'twilio',
    requestId: crypto.randomUUID(),
    conversationId,
    sendMessage: async (text) => {
      const { messageSid } = await twilioClient.sendMessage(phoneNumber, text);
      return { externalId: messageSid };
    },
    persistMessage: async ({ content, metadata, externalId }) => {
      await conversationManager.addMessage(conversationId, {
        content,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        twilioSid: externalId,
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
}: {
  conversationId: string;
  conversationManager: ReturnType<typeof getConversationManager>;
  emitWebProgress: (event: ProgressUpdateEvent) => Promise<void> | void;
  requestId?: string;
}): ProgressUpdateContext {
  return {
    channel: 'web',
    requestId: requestId ?? crypto.randomUUID(),
    conversationId,
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
// Web Chat Handler (for testing without Twilio SMS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes a message from the web chat interface.
 * Similar to processTwilioMessage but without Twilio API calls.
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

  // Use a synthetic phone number for web chat conversations
  const webPhoneNumber = 'web-test';

  logger.info(`[messageProcessor] Processing web chat: userId=${userId.slice(0, 8)}...`);

  // Get or create conversation
  const conversation = await conversationManager.getOrCreateConversation(userId, webPhoneNumber);

  // Add user message to the conversation
  await conversationManager.addMessage(conversation.id, {
    content: message,
    role: 'USER',
    direction: 'INBOUND',
  });

  // Detect and handle commands
  const command = detectCommand(message);
  let result: ProcessMessageResult;
  const progressContext = options?.onProgress
    ? buildWebProgressContext({
        conversationId: conversation.id,
        conversationManager,
        emitWebProgress: options.onProgress,
        requestId: options.requestId,
      })
    : undefined;

  if (command) {
    logger.info(`[messageProcessor] Detected command: ${command}`);

    switch (command) {
      case 'send':
        result = await handleSendCommand(userId, userEmail, conversation.id, progressContext);
        break;
      case 'save':
        result = await handleSaveCommand(userId, userEmail, conversation.id, progressContext);
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
    // Run Executive Agent
    result = await runExecutiveAgent(userId, userEmail, conversation.id, message, {
      progressContext,
    });
  }

  // Add assistant message to the conversation with tool call metadata
  await conversationManager.addMessage(conversation.id, {
    content: result.response,
    role: 'ASSISTANT',
    direction: 'OUTBOUND',
    metadata: result.metadata,
  });

  return result;
}
