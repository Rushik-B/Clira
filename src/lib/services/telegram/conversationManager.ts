/**
 * Telegram Conversation Manager
 *
 * Manages Telegram DM conversations and messages in the database.
 * Provides CRUD operations, idempotency checks, and message context retrieval.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import type {
  TelegramConversationStatus,
  TelegramMessageDirection,
  TelegramMessageRole,
} from '@prisma/client';

function sanitizeMetadataForPrisma(
  value: unknown,
  visited = new WeakSet<object>(),
): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }

  if (typeof value !== 'object') {
    return value as Prisma.InputJsonValue;
  }

  if (visited.has(value as object)) {
    return '[Circular Reference]';
  }

  if (Array.isArray(value)) {
    visited.add(value);
    try {
      return value.map((item) => sanitizeMetadataForPrisma(item, visited)) as Prisma.InputJsonValue;
    } finally {
      visited.delete(value);
    }
  }

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

  visited.add(value);
  try {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'function') continue;
      result[key] = sanitizeMetadataForPrisma(val, visited);
    }
    return result as Prisma.InputJsonValue;
  } finally {
    visited.delete(value);
  }
}

type TelegramConversation = NonNullable<
  Awaited<ReturnType<typeof prisma.telegramConversation.findUnique<{ where: { id: string } }>>>
>;
type TelegramMessage = NonNullable<
  Awaited<ReturnType<typeof prisma.telegramMessage.findUnique<{ where: { id: string } }>>>
>;

export interface AddMessageParams {
  content: string;
  role: TelegramMessageRole;
  direction: TelegramMessageDirection;
  telegramMessageId?: string;
  telegramUpdateId?: number;
  metadata?: Prisma.InputJsonValue;
}

export interface ConversationWithMessages extends TelegramConversation {
  messages: TelegramMessage[];
}

export class ConversationManager {
  async getOrCreateConversation(
    userId: string,
    chatId: string,
    telegramUserId: string,
  ): Promise<TelegramConversation> {
    const conversation = await prisma.telegramConversation.upsert({
      where: {
        userId_chatId: { userId, chatId },
      },
      create: {
        userId,
        chatId,
        telegramUserId,
        status: 'ACTIVE',
      },
      update: {
        telegramUserId,
        updatedAt: new Date(),
      },
    });

    logger.debug(
      `[TelegramConversationManager] getOrCreateConversation: userId=${userId.slice(0, 8)}... chatId=${chatId} id=${conversation.id}`,
    );

    return conversation;
  }

  async getConversation(
    conversationId: string,
    includeMessages = false,
  ): Promise<TelegramConversation | ConversationWithMessages | null> {
    return prisma.telegramConversation.findUnique({
      where: { id: conversationId },
      include: includeMessages ? { messages: { orderBy: { createdAt: 'asc' } } } : undefined,
    });
  }

  async getConversationByChatId(
    userId: string,
    chatId: string,
  ): Promise<TelegramConversation | null> {
    return prisma.telegramConversation.findUnique({
      where: {
        userId_chatId: { userId, chatId },
      },
    });
  }

  async getMostRecentConversationForUser(userId: string): Promise<TelegramConversation | null> {
    return prisma.telegramConversation.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'PENDING_CONFIRMATION'] } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async addMessage(
    conversationId: string,
    params: AddMessageParams,
  ): Promise<TelegramMessage> {
    const sanitizedMetadata = params.metadata
      ? sanitizeMetadataForPrisma(params.metadata)
      : undefined;

    const message = await prisma.telegramMessage.create({
      data: {
        conversationId,
        content: params.content,
        role: params.role,
        direction: params.direction,
        telegramMessageId: params.telegramMessageId,
        telegramUpdateId: params.telegramUpdateId,
        metadata: sanitizedMetadata,
      },
    });

    logger.debug(
      `[TelegramConversationManager] addMessage: conversationId=${conversationId} role=${params.role} direction=${params.direction} id=${message.id}`,
    );

    return message;
  }

  async hasInboundMessageWithUpdateId(telegramUpdateId: number): Promise<boolean> {
    const existing = await prisma.telegramMessage.findUnique({
      where: { telegramUpdateId },
      select: { id: true, direction: true },
    });

    return existing?.direction === 'INBOUND';
  }

  async hasInboundMessageWithTelegramMessageId(telegramMessageId: string): Promise<boolean> {
    const existing = await prisma.telegramMessage.findFirst({
      where: {
        telegramMessageId,
        direction: 'INBOUND',
      },
      select: { id: true },
    });

    return !!existing;
  }

  async getRecentMessages(conversationId: string, limit = 20): Promise<TelegramMessage[]> {
    const messages = await prisma.telegramMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages.reverse();
  }

  async setStatus(
    conversationId: string,
    status: TelegramConversationStatus,
  ): Promise<TelegramConversation> {
    const conversation = await prisma.telegramConversation.update({
      where: { id: conversationId },
      data: { status },
    });

    logger.debug(
      `[TelegramConversationManager] setStatus: conversationId=${conversationId} status=${status}`,
    );

    return conversation;
  }

  async clearConversation(conversationId: string): Promise<TelegramConversation> {
    const [, conversation] = await prisma.$transaction([
      prisma.telegramMessage.deleteMany({
        where: { conversationId },
      }),
      prisma.telegramConversation.update({
        where: { id: conversationId },
        data: {
          status: 'ACTIVE',
        },
      }),
    ]);

    logger.info(`[TelegramConversationManager] clearConversation: conversationId=${conversationId}`);

    return conversation;
  }

  async getActiveConversations(userId: string, limit = 10): Promise<TelegramConversation[]> {
    return prisma.telegramConversation.findMany({
      where: {
        userId,
        status: { in: ['ACTIVE', 'PENDING_CONFIRMATION'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }
}

let _managerInstance: ConversationManager | null = null;

export function getConversationManager(): ConversationManager {
  if (!_managerInstance) {
    _managerInstance = new ConversationManager();
  }
  return _managerInstance;
}
