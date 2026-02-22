/**
 * Telegram Pairing Manager
 *
 * Implements a code-based pairing flow for linking a Telegram DM sender to
 * a signed-in Clira user account.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 60 * 60 * 1000;

type PairingFailureCode = 'invalid' | 'expired' | 'used' | 'conflict';

export class PairingCodeError extends Error {
  constructor(
    public readonly code: PairingFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'PairingCodeError';
  }
}

export interface PairingRequestInput {
  telegramUserId: string;
  chatId: string;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
}

function normalizePairingCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    code += PAIRING_CODE_ALPHABET[idx];
  }
  return code;
}

async function generateUniquePairingCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generatePairingCode();
    const existing = await prisma.telegramPairingRequest.findUnique({
      where: { pairingCode: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  throw new Error('Failed to generate a unique Telegram pairing code');
}

function buildPairingInstructionMessage(pairingCode: string): string {
  return (
    "You're almost connected.\n\n" +
    `Open Clira → Settings → Text Clira → Telegram, then enter this code:\n` +
    `${pairingCode}\n\n` +
    'Code expires in 1 hour.'
  );
}

export class PairingManager {
  async createOrReusePairingRequest(input: PairingRequestInput): Promise<{
    pairingCode: string;
    expiresAt: Date;
    isNew: boolean;
    responseText: string;
  }> {
    const now = new Date();

    await prisma.telegramPairingRequest.updateMany({
      where: {
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    const existing = await prisma.telegramPairingRequest.findFirst({
      where: {
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return {
        pairingCode: existing.pairingCode,
        expiresAt: existing.expiresAt,
        isNew: false,
        responseText: buildPairingInstructionMessage(existing.pairingCode),
      };
    }

    const pairingCode = await generateUniquePairingCode();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);

    const request = await prisma.telegramPairingRequest.create({
      data: {
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        telegramUsername: input.telegramUsername ?? null,
        telegramFirstName: input.telegramFirstName ?? null,
        pairingCode,
        status: 'PENDING',
        expiresAt,
      },
      select: {
        pairingCode: true,
        expiresAt: true,
      },
    });

    logger.info(
      `[TelegramPairingManager] Created pairing request for telegramUserId=${input.telegramUserId} chatId=${input.chatId}`,
    );

    return {
      pairingCode: request.pairingCode,
      expiresAt: request.expiresAt,
      isNew: true,
      responseText: buildPairingInstructionMessage(request.pairingCode),
    };
  }

  async approvePairingCode(userId: string, pairingCodeInput: string) {
    const pairingCode = normalizePairingCode(pairingCodeInput);
    if (pairingCode.length !== PAIRING_CODE_LENGTH) {
      throw new PairingCodeError('invalid', 'Pairing code must be 8 characters.');
    }

    const now = new Date();

    const link = await prisma.$transaction(async (tx) => {
      const request = await tx.telegramPairingRequest.findUnique({
        where: { pairingCode },
      });

      if (!request) {
        throw new PairingCodeError('invalid', 'Pairing code is invalid.');
      }

      if (request.status !== 'PENDING') {
        throw new PairingCodeError('used', 'Pairing code was already used.');
      }

      if (request.expiresAt <= now) {
        await tx.telegramPairingRequest.update({
          where: { id: request.id },
          data: { status: 'EXPIRED' },
        });
        throw new PairingCodeError('expired', 'Pairing code has expired.');
      }

      const existingLink = await tx.telegramLink.findUnique({
        where: { telegramUserId: request.telegramUserId },
      });

      if (existingLink && existingLink.userId !== userId && existingLink.isActive) {
        throw new PairingCodeError(
          'conflict',
          'This Telegram account is already linked to another Clira user.',
        );
      }

      const linkedAccount = existingLink
        ? await tx.telegramLink.update({
            where: { telegramUserId: request.telegramUserId },
            data: {
              userId,
              chatId: request.chatId,
              telegramUsername: request.telegramUsername ?? null,
              telegramFirstName: request.telegramFirstName ?? null,
              isActive: true,
              linkedAt: now,
              deactivatedAt: null,
              lastSeenAt: now,
            },
          })
        : await tx.telegramLink.create({
            data: {
              userId,
              telegramUserId: request.telegramUserId,
              chatId: request.chatId,
              telegramUsername: request.telegramUsername ?? null,
              telegramFirstName: request.telegramFirstName ?? null,
              isActive: true,
              linkedAt: now,
              lastSeenAt: now,
            },
          });

      await tx.telegramPairingRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          approvedAt: now,
          approvedByUserId: userId,
        },
      });

      await tx.telegramPairingRequest.updateMany({
        where: {
          telegramUserId: request.telegramUserId,
          chatId: request.chatId,
          status: 'PENDING',
          id: { not: request.id },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      return linkedAccount;
    });

    logger.info(
      `[TelegramPairingManager] Pairing approved for userId=${userId.slice(0, 8)}... telegramUserId=${link.telegramUserId}`,
    );

    return link;
  }

  async deactivateLink(userId: string, linkId: string): Promise<void> {
    const now = new Date();
    const result = await prisma.telegramLink.updateMany({
      where: {
        id: linkId,
        userId,
        isActive: true,
      },
      data: {
        isActive: false,
        deactivatedAt: now,
      },
    });

    if (result.count === 0) {
      throw new Error('Telegram link not found.');
    }

    logger.info(
      `[TelegramPairingManager] Link deactivated: userId=${userId.slice(0, 8)}... linkId=${linkId}`,
    );
  }

  async findActiveLinkByTelegramUserId(telegramUserId: string) {
    return prisma.telegramLink.findFirst({
      where: {
        telegramUserId,
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        telegramUserId: true,
        chatId: true,
        telegramUsername: true,
        telegramFirstName: true,
      },
    });
  }

  async touchLinkActivityByTelegramUserId(telegramUserId: string): Promise<void> {
    await prisma.telegramLink.updateMany({
      where: {
        telegramUserId,
        isActive: true,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  async getActiveLinksForUser(userId: string) {
    return prisma.telegramLink.findMany({
      where: {
        userId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        telegramUserId: true,
        chatId: true,
        telegramUsername: true,
        telegramFirstName: true,
        linkedAt: true,
        lastSeenAt: true,
        updatedAt: true,
      },
    });
  }

  async getPendingPairingRequests(limit = 10) {
    const now = new Date();

    await prisma.telegramPairingRequest.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return prisma.telegramPairingRequest.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        pairingCode: true,
        telegramUserId: true,
        chatId: true,
        telegramUsername: true,
        telegramFirstName: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  async getMostRecentActiveLinkForUser(userId: string) {
    return prisma.telegramLink.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        telegramUserId: true,
        chatId: true,
        telegramUsername: true,
        telegramFirstName: true,
        linkedAt: true,
        lastSeenAt: true,
        updatedAt: true,
      },
    });
  }
}

let _pairingManagerInstance: PairingManager | null = null;

export function getPairingManager(): PairingManager {
  if (!_pairingManagerInstance) {
    _pairingManagerInstance = new PairingManager();
  }
  return _pairingManagerInstance;
}
