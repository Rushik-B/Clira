/**
 * Twilio Conversation Manager
 *
 * Manages Twilio SMS/RCS conversations and messages in the database.
 * Provides CRUD operations for conversations and maintains conversation state
 * including current email drafts being refined.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import type {
  TwilioConversationStatus,
  TwilioMessageDirection,
  TwilioMessageRole,
} from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitizes metadata to remove functions and convert error objects to plain objects.
 * This is necessary because Prisma JSON fields cannot store functions or non-serializable objects.
 */
function sanitizeMetadataForPrisma(
  value: unknown,
  visited = new WeakSet<object>(),
): Prisma.InputJsonValue {
  // Handle null and undefined
  if (value === null || value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }

  // Handle primitives
  if (typeof value !== 'object') {
    return value as Prisma.InputJsonValue;
  }

  // Handle circular references
  if (visited.has(value as object)) {
    return '[Circular Reference]';
  }

  // Handle arrays
  if (Array.isArray(value)) {
    visited.add(value);
    try {
      return value.map((item) => sanitizeMetadataForPrisma(item, visited)) as Prisma.InputJsonValue;
    } finally {
      visited.delete(value);
    }
  }

  // Handle Error objects and objects with functions
  if (value instanceof Error) {
    const errorObj: Record<string, Prisma.InputJsonValue> = {
      name: value.name,
      message: value.message,
      ...(value.stack && { stack: value.stack }),
    };
    if (value.cause) {
      errorObj.cause = sanitizeMetadataForPrisma(value.cause, visited);
    }
    return errorObj as Prisma.InputJsonValue;
  }

  // Handle plain objects
  visited.add(value);
  try {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, val] of Object.entries(value)) {
      // Skip functions
      if (typeof val === 'function') {
        continue;
      }
      // Recursively sanitize nested values
      result[key] = sanitizeMetadataForPrisma(val, visited);
    }
    return result as Prisma.InputJsonValue;
  } finally {
    visited.delete(value);
  }
}

// Infer model types from Prisma client query results
type TwilioConversation = NonNullable<
  Awaited<ReturnType<typeof prisma.twilioConversation.findUnique<{ where: { id: string } }>>>
>;
type TwilioMessage = NonNullable<
  Awaited<ReturnType<typeof prisma.twilioMessage.findUnique<{ where: { id: string } }>>>
>;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AddMessageParams {
  content: string;
  role: TwilioMessageRole;
  direction: TwilioMessageDirection;
  twilioSid?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface ConversationWithMessages extends TwilioConversation {
  messages: TwilioMessage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages Twilio SMS/RCS conversations and messages.
 *
 * Key responsibilities:
 * - Create and retrieve conversations (upsert by userId + phoneNumber)
 * - Add messages to conversations
 * - Manage conversation state (status, message type SMS/RCS)
 * - Provide context window for agent (recent messages)
 */
export class ConversationManager {
  // ═══════════════════════════════════════════════════════════════════════════
  // Conversation Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Gets or creates a conversation for a user and phone number.
   * Uses upsert to ensure atomic creation and avoid race conditions.
   *
   * @param userId - The internal user ID
   * @param phoneNumber - Phone number in E.164 format (e.g., "+16505551234")
   * @returns The conversation record
   */
  async getOrCreateConversation(
    userId: string,
    phoneNumber: string,
  ): Promise<TwilioConversation> {
    const conversation = await prisma.twilioConversation.upsert({
      where: {
        userId_phoneNumber: { userId, phoneNumber },
      },
      create: {
        userId,
        phoneNumber,
        status: 'ACTIVE',
        messageType: 'SMS', // Default, updated from delivery receipts
      },
      update: {
        // Touch updatedAt to mark activity
        updatedAt: new Date(),
      },
    });

    logger.debug(
      `[ConversationManager] getOrCreateConversation: userId=${userId.slice(0, 8)}... phoneNumber=${phoneNumber.slice(0, 4)}**** id=${conversation.id}`,
    );

    return conversation;
  }

  /**
   * Gets a conversation by ID with optional message inclusion.
   *
   * @param conversationId - The conversation ID
   * @param includeMessages - Whether to include messages (default: false)
   * @returns The conversation or null if not found
   */
  async getConversation(
    conversationId: string,
    includeMessages = false,
  ): Promise<TwilioConversation | ConversationWithMessages | null> {
    return prisma.twilioConversation.findUnique({
      where: { id: conversationId },
      include: includeMessages ? { messages: { orderBy: { createdAt: 'asc' } } } : undefined,
    });
  }

  /**
   * Gets a conversation by userId and phoneNumber.
   *
   * @param userId - The internal user ID
   * @param phoneNumber - Phone number in E.164 format
   * @returns The conversation or null if not found
   */
  async getConversationByPhoneNumber(
    userId: string,
    phoneNumber: string,
  ): Promise<TwilioConversation | null> {
    return prisma.twilioConversation.findUnique({
      where: {
        userId_phoneNumber: { userId, phoneNumber },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Message Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Adds a message to a conversation.
   *
   * @param conversationId - The conversation ID
   * @param params - Message parameters
   * @returns The created message
   */
  async addMessage(
    conversationId: string,
    params: AddMessageParams,
  ): Promise<TwilioMessage> {
    // Sanitize metadata to remove functions and non-serializable objects
    const sanitizedMetadata = params.metadata
      ? sanitizeMetadataForPrisma(params.metadata)
      : undefined;

    const message = await prisma.twilioMessage.create({
      data: {
        conversationId,
        content: params.content,
        role: params.role,
        direction: params.direction,
        twilioSid: params.twilioSid,
        metadata: sanitizedMetadata,
      },
    });

    logger.debug(
      `[ConversationManager] addMessage: conversationId=${conversationId} role=${params.role} direction=${params.direction} id=${message.id}`,
    );

    return message;
  }

  /**
   * Checks if an inbound message with the given Twilio SID already exists.
   * Used for idempotency to skip duplicate webhook deliveries.
   */
  async hasInboundMessageWithTwilioSid(twilioSid: string): Promise<boolean> {
    const existing = await prisma.twilioMessage.findFirst({
      where: {
        twilioSid,
        direction: 'INBOUND',
      },
      select: { id: true },
    });

    return !!existing;
  }

  /**
   * Gets recent messages from a conversation for context window.
   * Returns messages in chronological order (oldest first).
   *
   * @param conversationId - The conversation ID
   * @param limit - Maximum number of messages to return (default: 20)
   * @returns Array of messages
   */
  async getRecentMessages(
    conversationId: string,
    limit = 20,
  ): Promise<TwilioMessage[]> {
    // Fetch last N messages ordered by newest first, then reverse for chronological order
    const messages = await prisma.twilioMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Reverse to get chronological order (oldest first)
    return messages.reverse();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Status Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Updates the status of a conversation.
   *
   * @param conversationId - The conversation ID
   * @param status - The new status
   * @returns The updated conversation
   */
  async setStatus(
    conversationId: string,
    status: TwilioConversationStatus,
  ): Promise<TwilioConversation> {
    const conversation = await prisma.twilioConversation.update({
      where: { id: conversationId },
      data: { status },
    });

    logger.debug(
      `[ConversationManager] setStatus: conversationId=${conversationId} status=${status}`,
    );

    return conversation;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Conversation Reset
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clears a conversation by deleting all messages and resetting state.
   * Used for "clear" or "reset" commands from the user.
   *
   * @param conversationId - The conversation ID
   * @returns The reset conversation
   */
  async clearConversation(conversationId: string): Promise<TwilioConversation> {
    // Use transaction to ensure atomicity
    const [, conversation] = await prisma.$transaction([
      // Delete all messages
      prisma.twilioMessage.deleteMany({
        where: { conversationId },
      }),
      // Reset conversation state
      prisma.twilioConversation.update({
        where: { id: conversationId },
        data: {
          status: 'ACTIVE',
        },
      }),
    ]);

    logger.info(`[ConversationManager] clearConversation: conversationId=${conversationId}`);

    return conversation;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // User Lookup
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Finds a user by their Twilio phone number (verified only).
   * Used to identify the user when receiving a webhook message.
   *
   * @param phoneNumber - Phone number in E.164 format (e.g., "+16505551234")
   * @returns The user ID or null if not found
   */
  async findUserByTwilioNumber(phoneNumber: string): Promise<string | null> {
    // Normalize to E.164 format with +
    const normalizedNumber = phoneNumber.startsWith('+')
      ? phoneNumber
      : `+${phoneNumber}`;

    const userSettings = await prisma.userSettings.findFirst({
      where: {
        twilioPhoneNumber: normalizedNumber,
        twilioVerified: true,
      },
      select: { userId: true },
    });

    return userSettings?.userId ?? null;
  }

  /**
   * Finds a user by their Twilio phone number (including unverified).
   * Used for auto-verification flow - allows finding users who just added their number.
   *
   * @param phoneNumber - Phone number in E.164 format (e.g., "+16505551234")
   * @returns The user ID or null if not found
   */
  async findUserByTwilioNumberUnverified(phoneNumber: string): Promise<string | null> {
    // Normalize to E.164 format with +
    const normalizedNumber = phoneNumber.startsWith('+')
      ? phoneNumber
      : `+${phoneNumber}`;

    const userSettings = await prisma.userSettings.findFirst({
      where: {
        twilioPhoneNumber: normalizedNumber,
        // Don't require verification - allows finding newly added numbers
      },
      select: { userId: true },
    });

    return userSettings?.userId ?? null;
  }

  /**
   * Verifies a user's Twilio phone number.
   * Called automatically when a user sends their first message from a linked number.
   *
   * @param phoneNumber - Phone number in E.164 format (e.g., "+16505551234")
   */
  async verifyTwilioNumber(phoneNumber: string): Promise<void> {
    // Normalize to E.164 format with +
    const normalizedNumber = phoneNumber.startsWith('+')
      ? phoneNumber
      : `+${phoneNumber}`;

    await prisma.userSettings.updateMany({
      where: {
        twilioPhoneNumber: normalizedNumber,
      },
      data: {
        twilioVerified: true,
      },
    });

    logger.info(`[ConversationManager] Verified Twilio number: ${normalizedNumber.slice(0, 4)}****`);
  }

  /**
   * Gets active conversations for a user.
   * Useful for displaying conversation list in settings UI.
   *
   * @param userId - The user ID
   * @param limit - Maximum conversations to return
   * @returns Array of conversations
   */
  async getActiveConversations(
    userId: string,
    limit = 10,
  ): Promise<TwilioConversation[]> {
    return prisma.twilioConversation.findMany({
      where: {
        userId,
        status: { in: ['ACTIVE', 'PENDING_CONFIRMATION'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

let _managerInstance: ConversationManager | null = null;

/**
 * Gets the singleton ConversationManager instance.
 */
export function getConversationManager(): ConversationManager {
  if (!_managerInstance) {
    _managerInstance = new ConversationManager();
  }
  return _managerInstance;
}
