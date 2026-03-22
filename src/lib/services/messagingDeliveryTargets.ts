import type { NotificationDeliveryChannel } from '@prisma/client';
import {
  getConversationManager as getTelegramConversationManager,
  getPairingManager,
  isTelegramEnabled,
} from '@/lib/services/telegram';
import { isWhatsAppConfigured } from '@/lib/services/whatsapp';
import {
  allowsMessagingChannel,
  normalizeNotificationDeliveryChannel,
} from '@/lib/services/messagingChannelPreferences';

interface ResolveMessagingTargetsInput {
  userId: string;
  whatsappPhoneNumber: string | null | undefined;
  whatsappVerified: boolean | null | undefined;
  notificationDeliveryChannel: NotificationDeliveryChannel | null | undefined;
}

interface TelegramTarget {
  chatId: string;
  telegramUserId: string;
}

function pickPreferredTelegramTarget(params: {
  recentConversation:
    | {
        chatId: string;
        telegramUserId: string;
        updatedAt: Date;
      }
    | null;
  recentLink:
    | {
        chatId: string;
        telegramUserId: string;
        updatedAt: Date;
      }
    | null;
}): TelegramTarget | null {
  const { recentConversation, recentLink } = params;

  if (recentConversation && recentLink) {
    return recentConversation.updatedAt >= recentLink.updatedAt
      ? {
          chatId: recentConversation.chatId,
          telegramUserId: recentConversation.telegramUserId,
        }
      : {
          chatId: recentLink.chatId,
          telegramUserId: recentLink.telegramUserId,
        };
  }

  if (recentConversation) {
    return {
      chatId: recentConversation.chatId,
      telegramUserId: recentConversation.telegramUserId,
    };
  }

  if (recentLink) {
    return {
      chatId: recentLink.chatId,
      telegramUserId: recentLink.telegramUserId,
    };
  }

  return null;
}

export async function resolveTelegramDeliveryTargetForUser(
  userId: string,
): Promise<TelegramTarget | null> {
  if (!isTelegramEnabled()) {
    return null;
  }

  const telegramConversationManager = getTelegramConversationManager();
  const pairingManager = getPairingManager();
  const [recentConversation, recentLink] = await Promise.all([
    telegramConversationManager.getMostRecentConversationForUser(userId),
    pairingManager.getMostRecentActiveLinkForUser(userId),
  ]);

  return pickPreferredTelegramTarget({
    recentConversation,
    recentLink,
  });
}

export interface MessagingTargetsResolution {
  notificationPreference: NotificationDeliveryChannel;
  hasWhatsAppAvailable: boolean;
  hasTelegramAvailable: boolean;
  shouldSendWhatsApp: boolean;
  telegramTarget: TelegramTarget | null;
  skipReason: 'messaging-not-configured' | 'preferred-channel-unavailable' | null;
}

export async function resolveMessagingTargets(
  input: ResolveMessagingTargetsInput,
): Promise<MessagingTargetsResolution> {
  const notificationPreference = normalizeNotificationDeliveryChannel(
    input.notificationDeliveryChannel,
  );

  const hasWhatsAppAvailable =
    Boolean(input.whatsappPhoneNumber) &&
    input.whatsappVerified === true &&
    isWhatsAppConfigured();

  let availableTelegramTarget: TelegramTarget | null = null;

  if (isTelegramEnabled()) {
    availableTelegramTarget = await resolveTelegramDeliveryTargetForUser(input.userId);
  }

  const hasTelegramAvailable = Boolean(availableTelegramTarget);
  const shouldSendWhatsApp =
    hasWhatsAppAvailable && allowsMessagingChannel(notificationPreference, 'whatsapp');
  const telegramTarget =
    hasTelegramAvailable && allowsMessagingChannel(notificationPreference, 'telegram')
      ? availableTelegramTarget
      : null;

  let skipReason: MessagingTargetsResolution['skipReason'] = null;
  if (!shouldSendWhatsApp && !telegramTarget) {
    skipReason =
      hasWhatsAppAvailable || hasTelegramAvailable
        ? 'preferred-channel-unavailable'
        : 'messaging-not-configured';
  }

  return {
    notificationPreference,
    hasWhatsAppAvailable,
    hasTelegramAvailable,
    shouldSendWhatsApp,
    telegramTarget,
    skipReason,
  };
}
