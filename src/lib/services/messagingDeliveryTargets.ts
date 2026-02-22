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
    const telegramConversationManager = getTelegramConversationManager();
    const pairingManager = getPairingManager();
    const [recentConversation, recentLink] = await Promise.all([
      telegramConversationManager.getMostRecentConversationForUser(input.userId),
      pairingManager.getMostRecentActiveLinkForUser(input.userId),
    ]);

    if (recentConversation && recentLink) {
      availableTelegramTarget =
        recentConversation.updatedAt >= recentLink.updatedAt
          ? {
              chatId: recentConversation.chatId,
              telegramUserId: recentConversation.telegramUserId,
            }
          : {
              chatId: recentLink.chatId,
              telegramUserId: recentLink.telegramUserId,
            };
    } else if (recentConversation) {
      availableTelegramTarget = {
        chatId: recentConversation.chatId,
        telegramUserId: recentConversation.telegramUserId,
      };
    } else if (recentLink) {
      availableTelegramTarget = {
        chatId: recentLink.chatId,
        telegramUserId: recentLink.telegramUserId,
      };
    }
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
