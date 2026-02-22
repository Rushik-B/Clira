import { prisma } from '@/lib/prisma';
import {
  getPairingManager,
  getTelegramClient,
  getTelegramHealthSnapshot,
  isTelegramConfigured,
  isTelegramEnabled,
} from '@/lib/services/telegram';

export type NotificationDeliveryChannel = 'WHATSAPP' | 'TELEGRAM' | 'BOTH';

export interface TextChannelsSettingsSnapshot {
  whatsappPhoneNumber: string | null;
  whatsappVerified: boolean;
  twilioPhoneNumber: string | null;
  twilioVerified: boolean;
  notificationDeliveryChannel: NotificationDeliveryChannel;
  telegramConfigured: boolean;
  telegramEnabled: boolean;
  botUsername: string | null;
  links: Array<{
    id: string;
    telegramUserId: string;
    chatId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    linkedAt: string;
    lastSeenAt: string | null;
    updatedAt?: string;
  }>;
  pendingPairingRequests: Array<{
    id: string;
    pairingCode: string;
    telegramUserId: string;
    chatId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    expiresAt: string;
    createdAt: string;
  }>;
  telegramHealth: {
    configured: boolean;
    enabled: boolean;
    workerConnected: boolean;
    lastHeartbeatAt: string | null;
    heartbeatAgeMs: number | null;
    lastUpdateId: number | null;
    lastUpdateAt: string | null;
  };
}

function normalizeDeliveryChannel(
  value: string | null | undefined,
): NotificationDeliveryChannel {
  if (value === 'WHATSAPP' || value === 'TELEGRAM') return value;
  return 'BOTH';
}

export async function getTextChannelsSettingsSnapshot(
  userId: string,
): Promise<TextChannelsSettingsSnapshot> {
  const pairingManager = getPairingManager();

  const [settings, links, pendingPairingRequests, telegramHealth] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId },
      select: {
        whatsappPhoneNumber: true,
        whatsappVerified: true,
        twilioPhoneNumber: true,
        twilioVerified: true,
        notificationDeliveryChannel: true,
      },
    }),
    pairingManager.getActiveLinksForUser(userId),
    pairingManager.getPendingPairingRequests(),
    getTelegramHealthSnapshot(),
  ]);

  let botUsername: string | null = null;
  if (isTelegramConfigured()) {
    const identity = await getTelegramClient().getBotIdentity();
    botUsername = identity?.username ?? null;
  }

  return {
    whatsappPhoneNumber: settings?.whatsappPhoneNumber ?? null,
    whatsappVerified: !!settings?.whatsappVerified,
    twilioPhoneNumber: settings?.twilioPhoneNumber ?? null,
    twilioVerified: !!settings?.twilioVerified,
    notificationDeliveryChannel: normalizeDeliveryChannel(
      settings?.notificationDeliveryChannel,
    ),
    telegramConfigured: isTelegramConfigured(),
    telegramEnabled: isTelegramEnabled(),
    botUsername,
    links: links.map((link) => ({
      id: link.id,
      telegramUserId: link.telegramUserId,
      chatId: link.chatId,
      telegramUsername: link.telegramUsername,
      telegramFirstName: link.telegramFirstName,
      linkedAt: link.linkedAt.toISOString(),
      lastSeenAt: link.lastSeenAt?.toISOString() ?? null,
      updatedAt: link.updatedAt?.toISOString(),
    })),
    pendingPairingRequests: pendingPairingRequests.map((request) => ({
      id: request.id,
      pairingCode: request.pairingCode,
      telegramUserId: request.telegramUserId,
      chatId: request.chatId,
      telegramUsername: request.telegramUsername,
      telegramFirstName: request.telegramFirstName,
      expiresAt: request.expiresAt.toISOString(),
      createdAt: request.createdAt.toISOString(),
    })),
    telegramHealth,
  };
}
