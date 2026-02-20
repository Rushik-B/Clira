import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getExecutiveAgent } from '@/lib/ai/agents/executiveAgent';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';
import {
  getWhatsAppClient,
  isWhatsAppConfigured,
  getConversationManager as getWhatsAppConversationManager,
} from '@/lib/services/whatsapp';
import {
  getTelegramClient,
  getConversationManager as getTelegramConversationManager,
  getPairingManager,
  isTelegramEnabled,
} from '@/lib/services/telegram';
import {
  allowsMessagingChannel,
  normalizeNotificationDeliveryChannel,
} from '@/lib/services/messagingChannelPreferences';
import type { Prisma } from '@prisma/client';

interface AlertNotificationInput {
  userId: string;
  userEmail: string;
  email: { from: string; subject: string; snippet: string };
  alert: { id: string; description: string };
}

function buildNotificationProgressContext(
  channel: 'whatsapp' | 'telegram',
  conversationId: string,
): ProgressUpdateContext {
  return {
    channel,
    requestId: crypto.randomUUID(),
    conversationId,
    persistMessage: async () => undefined,
  };
}

// Orchestrates alert notifications via ExecutiveAgent + messaging channels.
export async function triggerAlertNotification(input: AlertNotificationInput): Promise<void> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: input.userId },
    select: {
      whatsappPhoneNumber: true,
      whatsappVerified: true,
      notificationDeliveryChannel: true,
    },
  });

  const deliveryChannelPreference = normalizeNotificationDeliveryChannel(
    settings?.notificationDeliveryChannel,
  );
  const hasWhatsAppAvailable =
    Boolean(settings?.whatsappPhoneNumber) &&
    settings?.whatsappVerified === true &&
    isWhatsAppConfigured();

  let availableTelegramTarget:
    | {
        chatId: string;
        telegramUserId: string;
      }
    | null = null;

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
  const hasWhatsApp =
    hasWhatsAppAvailable && allowsMessagingChannel(deliveryChannelPreference, 'whatsapp');
  const telegramTarget =
    hasTelegramAvailable && allowsMessagingChannel(deliveryChannelPreference, 'telegram')
      ? availableTelegramTarget
      : null;

  if (!hasWhatsApp && !telegramTarget) {
    logger.info(`[alertNotification] Skipping - no messaging channels configured for user ${input.userId}`);

    await prisma.actionHistory.create({
      data: {
        userId: input.userId,
        actionType: 'ALERT_SKIPPED',
        actionSummary: 'Alert matched but no eligible messaging channel is configured',
        actionDetails: {
          alertId: input.alert.id,
          email: input.email,
          reason:
            hasWhatsAppAvailable || hasTelegramAvailable
              ? 'preferred-channel-unavailable'
              : 'messaging-not-configured',
        },
        undoable: false,
      },
    });
    return;
  }

  const agent = getExecutiveAgent();
  const systemMessage =
    `ALERT NOTIFICATION: An email matching the user's alert has arrived.\n` +
    `Alert: "${input.alert.description}"\n` +
    `From: ${input.email.from}\n` +
    `Subject: ${input.email.subject}\n` +
    `Preview: ${input.email.snippet}\n\n` +
    'Notify the user about this email. Be helpful - you can offer to draft a reply, ' +
    'search for related emails, or just inform them. Keep it concise and friendly.';

  try {
    const whatsappConversationManager = getWhatsAppConversationManager();
    const telegramConversationManager = getTelegramConversationManager();
    const waId = settings?.whatsappPhoneNumber?.replace(/^\+/, '') ?? '';
    const whatsappConversation = hasWhatsApp
      ? await whatsappConversationManager.getOrCreateConversation(input.userId, waId)
      : null;
    const telegramConversation = telegramTarget
      ? await telegramConversationManager.getOrCreateConversation(
          input.userId,
          telegramTarget.chatId,
          telegramTarget.telegramUserId,
        )
      : null;

    if (whatsappConversation) {
      await whatsappConversationManager.addMessage(whatsappConversation.id, {
        content: systemMessage,
        role: 'USER',
        direction: 'INBOUND',
        metadata: { source: 'alert_notification', alertId: input.alert.id, channel: 'whatsapp' },
      });
    }
    if (telegramConversation) {
      await telegramConversationManager.addMessage(telegramConversation.id, {
        content: systemMessage,
        role: 'USER',
        direction: 'INBOUND',
        metadata: { source: 'alert_notification', alertId: input.alert.id, channel: 'telegram' },
      });
    }

    const primaryChannel: 'telegram' | 'whatsapp' = telegramConversation ? 'telegram' : 'whatsapp';
    const primaryConversationId = primaryChannel === 'telegram'
      ? telegramConversation!.id
      : whatsappConversation!.id;
    const primaryConversationMessages = primaryChannel === 'telegram'
      ? await telegramConversationManager.getRecentMessages(telegramConversation!.id, 15)
      : await whatsappConversationManager.getRecentMessages(whatsappConversation!.id, 15);
    const conversationHistory = primaryConversationMessages.map((msg) => ({
      id: msg.id,
      content: msg.content,
      role: msg.role,
      direction: msg.direction,
      createdAt: msg.createdAt,
      metadata: (msg.metadata != null && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata))
        ? (msg.metadata as Record<string, unknown>)
        : null,
    }));

    const result = await agent.process({
      userId: input.userId,
      userEmail: input.userEmail,
      userRequest: systemMessage,
      conversationId: primaryConversationId,
      conversationHistory,
      progressContext: buildNotificationProgressContext(primaryChannel, primaryConversationId),
    });

    const deliveredChannels: Array<'whatsapp' | 'telegram'> = [];

    if (whatsappConversation && settings?.whatsappPhoneNumber) {
      const client = getWhatsAppClient();
      const { messageId: waResponseId } = await client.sendMessage(settings.whatsappPhoneNumber, result.response);
      const outboundMetadata =
        result.metadata != null && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
          ? { ...(result.metadata as Record<string, unknown>) }
          : {};
      outboundMetadata.source = 'alert_notification';
      outboundMetadata.alertId = input.alert.id;
      outboundMetadata.channel = 'whatsapp';

      await whatsappConversationManager.addMessage(whatsappConversation.id, {
        content: result.response,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        waMessageId: waResponseId,
        metadata: outboundMetadata as Prisma.InputJsonObject,
      });
      deliveredChannels.push('whatsapp');
    }

    if (telegramConversation && telegramTarget) {
      const client = getTelegramClient();
      const { messageId: telegramResponseId } = await client.sendMessage(telegramTarget.chatId, result.response);
      const outboundMetadata =
        result.metadata != null && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
          ? { ...(result.metadata as Record<string, unknown>) }
          : {};
      outboundMetadata.source = 'alert_notification';
      outboundMetadata.alertId = input.alert.id;
      outboundMetadata.channel = 'telegram';

      await telegramConversationManager.addMessage(telegramConversation.id, {
        content: result.response,
        role: 'ASSISTANT',
        direction: 'OUTBOUND',
        telegramMessageId: telegramResponseId,
        metadata: outboundMetadata as Prisma.InputJsonObject,
      });
      deliveredChannels.push('telegram');
    }

    if (deliveredChannels.length === 0) {
      await prisma.actionHistory.create({
        data: {
          userId: input.userId,
          actionType: 'ALERT_SKIPPED',
          actionSummary: 'Alert matched but delivery to messaging channels failed',
          actionDetails: { alertId: input.alert.id, email: input.email },
          undoable: false,
        },
      });
      return;
    }

    logger.info(`[alertNotification] Sent notification for alert ${input.alert.id}`);

    await prisma.actionHistory.create({
      data: {
        userId: input.userId,
        actionType: 'ALERT_NOTIFIED',
        actionSummary: `Alert notification sent: ${input.alert.description}`,
        actionDetails: {
          alertId: input.alert.id,
          email: input.email,
          response: result.response,
          channels: deliveredChannels,
        },
        undoable: false,
      },
    });
  } catch (error) {
    logger.error('[alertNotification] Failed:', error);
  }
}
