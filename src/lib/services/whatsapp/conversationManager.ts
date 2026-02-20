/**
 * WhatsApp Conversation Manager
 *
 * Manages WhatsApp conversations and messages in the database.
 * Provides CRUD operations for conversations and maintains conversation state
 * including current email drafts being refined.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import type {
  WhatsAppConversationStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageRole,
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
// These types are generated from the schema but accessed via inference
type WhatsAppConversation = NonNullable<
  Awaited<ReturnType<typeof prisma.whatsAppConversation.findUnique<{ where: { id: string } }>>>
>;
type WhatsAppMessage = NonNullable<
  Awaited<ReturnType<typeof prisma.whatsAppMessage.findUnique<{ where: { id: string } }>>>
>;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailDraft {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

export interface AddMessageParams {
  content: string;
  role: WhatsAppMessageRole;
  direction: WhatsAppMessageDirection;
  waMessageId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface OutboundMessageStatusUpdate {
  waMessageId: string;
  status: string;
  statusTimestamp: Date;
  recipientId?: string;
  error?: Record<string, unknown>;
}

export interface OutboundMessageStatusRecord {
  messageId: string;
  conversationId: string;
  userId: string;
  source?: string;
  reminderId?: string;
}

export interface ConversationWithMessages extends WhatsAppConversation {
  messages: WhatsAppMessage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages WhatsApp conversations and messages.
 *
 * Key responsibilities:
 * - Create and retrieve conversations (upsert by userId + waId)
 * - Add messages to conversations
 * - Manage conversation state (status, current draft)
 * - Provide context window for agent (recent messages)
 */
export class ConversationManager {
  // ═══════════════════════════════════════════════════════════════════════════
  // Conversation Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Gets or creates a conversation for a user and WhatsApp ID.
   * Uses upsert to ensure atomic creation and avoid race conditions.
   *
   * @param userId - The internal user ID
   * @param waId - WhatsApp ID (phone number without +)
   * @returns The conversation record
   */
  async getOrCreateConversation(
    userId: string,
    waId: string,
  ): Promise<WhatsAppConversation> {
    const conversation = await prisma.whatsAppConversation.upsert({
      where: {
        userId_waId: { userId, waId },
      },
      create: {
        userId,
        waId,
        status: 'ACTIVE',
      },
      update: {
        // Touch updatedAt to mark activity
        updatedAt: new Date(),
      },
    });

    logger.debug(
      `[ConversationManager] getOrCreateConversation: userId=${userId.slice(0, 8)}... waId=${waId.slice(0, 4)}**** id=${conversation.id}`,
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
  ): Promise<WhatsAppConversation | ConversationWithMessages | null> {
    return prisma.whatsAppConversation.findUnique({
      where: { id: conversationId },
      include: includeMessages ? { messages: { orderBy: { createdAt: 'asc' } } } : undefined,
    });
  }

  /**
   * Gets a conversation by userId and waId.
   *
   * @param userId - The internal user ID
   * @param waId - WhatsApp ID (phone number without +)
   * @returns The conversation or null if not found
   */
  async getConversationByWaId(
    userId: string,
    waId: string,
  ): Promise<WhatsAppConversation | null> {
    return prisma.whatsAppConversation.findUnique({
      where: {
        userId_waId: { userId, waId },
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
  ): Promise<WhatsAppMessage> {
    // Sanitize metadata to remove functions and non-serializable objects
    const sanitizedMetadata = params.metadata
      ? sanitizeMetadataForPrisma(params.metadata)
      : undefined;

    const message = await prisma.whatsAppMessage.create({
      data: {
        conversationId,
        content: params.content,
        role: params.role,
        direction: params.direction,
        waMessageId: params.waMessageId,
        metadata: sanitizedMetadata,
      },
    });

    logger.debug(
      `[ConversationManager] addMessage: conversationId=${conversationId} role=${params.role} direction=${params.direction} id=${message.id}`,
    );

    return message;
  }

  /**
   * Checks if an inbound message with the given WhatsApp message ID already exists.
   * Used for idempotency to skip duplicate webhook deliveries.
   */
  async hasInboundMessageWithWaMessageId(waMessageId: string): Promise<boolean> {
    const existing = await prisma.whatsAppMessage.findFirst({
      where: {
        waMessageId,
        direction: 'INBOUND',
      },
      select: { id: true },
    });

    return !!existing;
  }

  /**
   * Persists delivery status metadata for outbound messages matched by waMessageId.
   * Returns matched message records so callers can run source-specific follow-up logic.
   */
  async recordOutboundStatusUpdate(
    update: OutboundMessageStatusUpdate,
  ): Promise<OutboundMessageStatusRecord[]> {
    const messages = await prisma.whatsAppMessage.findMany({
      where: {
        waMessageId: update.waMessageId,
        direction: 'OUTBOUND',
      },
      select: {
        id: true,
        conversationId: true,
        metadata: true,
        conversation: {
          select: { userId: true },
        },
      },
    });

    if (messages.length === 0) {
      return [];
    }

    const statusAtIso = update.statusTimestamp.toISOString();
    const receivedAtIso = new Date().toISOString();
    const result: OutboundMessageStatusRecord[] = [];

    for (const message of messages) {
      const baseMetadata =
        message.metadata != null &&
        typeof message.metadata === 'object' &&
        !Array.isArray(message.metadata)
          ? (message.metadata as Record<string, unknown>)
          : {};

      const nextMetadata: Record<string, unknown> = {
        ...baseMetadata,
        deliveryStatus: update.status,
        deliveryStatusAt: statusAtIso,
        deliveryStatusReceivedAt: receivedAtIso,
      };

      if (update.recipientId) {
        nextMetadata.deliveryStatusRecipientId = update.recipientId;
      }
      if (update.error) {
        nextMetadata.deliveryStatusError = update.error;
      }

      await prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: { metadata: sanitizeMetadataForPrisma(nextMetadata) },
      });

      result.push({
        messageId: message.id,
        conversationId: message.conversationId,
        userId: message.conversation.userId,
        source: typeof baseMetadata.source === 'string' ? baseMetadata.source : undefined,
        reminderId: typeof baseMetadata.reminderId === 'string' ? baseMetadata.reminderId : undefined,
      });
    }

    return result;
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
  ): Promise<WhatsAppMessage[]> {
    // Fetch last N messages ordered by newest first, then reverse for chronological order
    const messages = await prisma.whatsAppMessage.findMany({
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
    status: WhatsAppConversationStatus,
  ): Promise<WhatsAppConversation> {
    const conversation = await prisma.whatsAppConversation.update({
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
  async clearConversation(conversationId: string): Promise<WhatsAppConversation> {
    // Use transaction to ensure atomicity
    const [, conversation] = await prisma.$transaction([
      // Delete all messages
      prisma.whatsAppMessage.deleteMany({
        where: { conversationId },
      }),
      // Reset conversation state
      prisma.whatsAppConversation.update({
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
   * Finds a user by their WhatsApp phone number (verified only).
   * Used to identify the user when receiving a webhook message.
   *
   * @param phoneNumber - WhatsApp ID (phone number, with or without +)
   * @returns The user ID or null if not found
   */
  async findUserByWhatsAppNumber(phoneNumber: string): Promise<string | null> {
    // Normalize to E.164 format with +
    const normalizedNumber = phoneNumber.startsWith('+')
      ? phoneNumber
      : `+${phoneNumber}`;

    const userSettings = await prisma.userSettings.findFirst({
      where: {
        whatsappPhoneNumber: normalizedNumber,
        whatsappVerified: true,
      },
      select: { userId: true },
    });

    return userSettings?.userId ?? null;
  }

  /**
   * Finds a user by their WhatsApp phone number (including unverified).
   * Used for auto-verification flow - allows finding users who just added their number.
   *
   * @param phoneNumber - WhatsApp ID (phone number, with or without +)
   * @returns The user ID or null if not found
   */
  async findUserByWhatsAppNumberUnverified(phoneNumber: string): Promise<string | null> {
    // Normalize to E.164 format with +
    const normalizedNumber = phoneNumber.startsWith('+')
      ? phoneNumber
      : `+${phoneNumber}`;

    const userSettings = await prisma.userSettings.findFirst({
      where: {
        whatsappPhoneNumber: normalizedNumber,
        // Don't require verification - allows finding newly added numbers
      },
      select: { userId: true },
    });

    return userSettings?.userId ?? null;
  }

  /**
   * Verifies a user's WhatsApp phone number.
   * Called automatically when a user sends their first message from a linked number.
   *
   * @param phoneNumber - WhatsApp ID (phone number, with or without +)
   * @returns The updated user settings or null if not found
   */
  async verifyWhatsAppNumber(phoneNumber: string): Promise<void> {
    // Normalize to E.164 format with +
    const normalizedNumber = phoneNumber.startsWith('+')
      ? phoneNumber
      : `+${phoneNumber}`;

    await prisma.userSettings.updateMany({
      where: {
        whatsappPhoneNumber: normalizedNumber,
      },
      data: {
        whatsappVerified: true,
      },
    });

    logger.info(`[ConversationManager] Verified WhatsApp number: ${normalizedNumber.slice(0, 4)}****`);
  }

  /**
   * Gets active conversations for a user.
   * Useful for displaying conversation list in settings UI.
   *
   * @param userId - The user ID
   * @param limit - Maximum conversations to return
   * @returns Array of conversations with latest message info
   */
  async getActiveConversations(
    userId: string,
    limit = 10,
  ): Promise<WhatsAppConversation[]> {
    return prisma.whatsAppConversation.findMany({
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
