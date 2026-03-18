import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getExecutiveAgent } from '@/lib/ai/agents/executiveAgent';
import {
  createAiTraceRoot,
  deriveOutputPreview,
  deriveRunStatusFromError,
  finalizeAiTraceRun,
  type AiTraceContext,
} from '@/lib/ai/tracing';
import {
  getWhatsAppClient,
  getConversationManager as getWhatsAppConversationManager,
} from '@/lib/services/whatsapp';
import {
  getTelegramClient,
  getConversationManager as getTelegramConversationManager,
} from '@/lib/services/telegram';
import { resolveMessagingTargets } from '@/lib/services/messagingDeliveryTargets';
import { buildNotificationProgressContext } from '@/lib/services/notificationProgressContext';
import type { Prisma } from '@prisma/client';

interface AlertNotificationInput {
  userId: string;
  userEmail: string;
  email: { from: string; subject: string; snippet: string };
  alert: { id: string; description: string };
  primaryChannelPreference?: 'whatsapp' | 'telegram';
}

type NotificationChannel = 'whatsapp' | 'telegram';
type PrimaryConversationMessage = {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  direction: 'INBOUND' | 'OUTBOUND';
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
};

function getMostRecentTimestamp(messages: Array<{ createdAt: Date }>): number {
  let latest = 0;

  for (const message of messages) {
    const timestamp = message.createdAt.getTime();
    if (timestamp > latest) {
      latest = timestamp;
    }
  }

  return latest;
}

async function selectPrimaryAlertChannel({
  preferredChannel,
  whatsappConversation,
  telegramConversation,
  whatsappConversationManager,
  telegramConversationManager,
}: {
  preferredChannel?: NotificationChannel;
  whatsappConversation: { id: string } | null;
  telegramConversation: { id: string } | null;
  whatsappConversationManager: ReturnType<typeof getWhatsAppConversationManager>;
  telegramConversationManager: ReturnType<typeof getTelegramConversationManager>;
}): Promise<{
  primaryChannel: NotificationChannel;
  primaryConversationId: string;
  primaryConversationMessages: PrimaryConversationMessage[];
}> {
  if (!whatsappConversation && !telegramConversation) {
    throw new Error('No messaging conversation available for primary channel selection');
  }

  if (preferredChannel === 'whatsapp' && whatsappConversation) {
    return {
      primaryChannel: 'whatsapp',
      primaryConversationId: whatsappConversation.id,
      primaryConversationMessages: await whatsappConversationManager.getRecentMessages(
        whatsappConversation.id,
        15,
      ),
    };
  }

  if (preferredChannel === 'telegram' && telegramConversation) {
    return {
      primaryChannel: 'telegram',
      primaryConversationId: telegramConversation.id,
      primaryConversationMessages: await telegramConversationManager.getRecentMessages(
        telegramConversation.id,
        15,
      ),
    };
  }

  if (!whatsappConversation) {
    return {
      primaryChannel: 'telegram',
      primaryConversationId: telegramConversation!.id,
      primaryConversationMessages: await telegramConversationManager.getRecentMessages(
        telegramConversation!.id,
        15,
      ),
    };
  }

  if (!telegramConversation) {
    return {
      primaryChannel: 'whatsapp',
      primaryConversationId: whatsappConversation.id,
      primaryConversationMessages: await whatsappConversationManager.getRecentMessages(
        whatsappConversation.id,
        15,
      ),
    };
  }

  const [whatsappMessages, telegramMessages] = await Promise.all([
    whatsappConversationManager.getRecentMessages(whatsappConversation.id, 15),
    telegramConversationManager.getRecentMessages(telegramConversation.id, 15),
  ]);

  const whatsappLatest = getMostRecentTimestamp(whatsappMessages);
  const telegramLatest = getMostRecentTimestamp(telegramMessages);

  if (telegramLatest > whatsappLatest) {
    return {
      primaryChannel: 'telegram',
      primaryConversationId: telegramConversation.id,
      primaryConversationMessages: telegramMessages,
    };
  }

  if (whatsappLatest > telegramLatest) {
    return {
      primaryChannel: 'whatsapp',
      primaryConversationId: whatsappConversation.id,
      primaryConversationMessages: whatsappMessages,
    };
  }

  if (telegramMessages.length > whatsappMessages.length) {
    return {
      primaryChannel: 'telegram',
      primaryConversationId: telegramConversation.id,
      primaryConversationMessages: telegramMessages,
    };
  }

  return {
    primaryChannel: 'whatsapp',
    primaryConversationId: whatsappConversation.id,
    primaryConversationMessages: whatsappMessages,
  };
}

async function recordAlertChannelDeliveryFailure({
  userId,
  userEmail,
  alertId,
  email,
  channel,
  error,
}: {
  userId: string;
  userEmail: string;
  alertId: string;
  email: AlertNotificationInput['email'];
  channel: NotificationChannel;
  error: unknown;
}): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  try {
    await prisma.actionHistory.create({
      data: {
        userId,
        actionType: 'ALERT_SKIPPED',
        actionSummary: `Alert delivery failed on ${channel}`,
        actionDetails: {
          alertId,
          email,
          userEmail,
          channel,
          reason: 'messaging-delivery-failed',
          error: message,
        },
        undoable: false,
      },
    });
  } catch (historyError) {
    logger.error('[alertNotification] Failed to record channel delivery failure', {
      userId,
      alertId,
      channel,
      error: historyError,
    });
  }
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
  const targetResolution = await resolveMessagingTargets({
    userId: input.userId,
    whatsappPhoneNumber: settings?.whatsappPhoneNumber,
    whatsappVerified: settings?.whatsappVerified,
    notificationDeliveryChannel: settings?.notificationDeliveryChannel,
  });
  const hasWhatsApp = targetResolution.shouldSendWhatsApp;
  const telegramTarget = targetResolution.telegramTarget;

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
          reason: targetResolution.skipReason ?? 'messaging-not-configured',
        },
        undoable: false,
      },
    });
    return;
  }

  const agent = getExecutiveAgent();
  const systemMessage =
    `ALERT NOTIFICATION\n` +
    `Alert rule: "${input.alert.description}"\n` +
    `From: ${input.email.from}\n` +
    `Subject: ${input.email.subject}\n` +
    `Preview: ${input.email.snippet}`;

  let traceContext: AiTraceContext | undefined;

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

    const {
      primaryChannel,
      primaryConversationId,
      primaryConversationMessages,
    } = await selectPrimaryAlertChannel({
      preferredChannel: input.primaryChannelPreference,
      whatsappConversation,
      telegramConversation,
      whatsappConversationManager,
      telegramConversationManager,
    });

    traceContext = await createAiTraceRoot({
      pipeline: 'alert-notification',
      userId: input.userId,
      channel: primaryChannel,
      conversationId: primaryConversationId,
      label: 'alert-notification',
      inputPreview: systemMessage,
      metadata: {
        alertId: input.alert.id,
        email: input.email,
      },
    });

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
      channel: primaryChannel,
      conversationHistory,
      progressContext: buildNotificationProgressContext(primaryChannel, primaryConversationId),
      traceContext,
    });

    const deliveredChannels: Array<'whatsapp' | 'telegram'> = [];

    if (whatsappConversation && settings?.whatsappPhoneNumber) {
      try {
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
      } catch (error) {
        logger.error('[alertNotification] WhatsApp delivery failed', {
          userId: input.userId,
          userEmail: input.userEmail,
          alertId: input.alert.id,
          error,
        });
        await recordAlertChannelDeliveryFailure({
          userId: input.userId,
          userEmail: input.userEmail,
          alertId: input.alert.id,
          email: input.email,
          channel: 'whatsapp',
          error,
        });
      }
    }

    if (telegramConversation && telegramTarget) {
      try {
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
      } catch (error) {
        logger.error('[alertNotification] Telegram delivery failed', {
          userId: input.userId,
          userEmail: input.userEmail,
          alertId: input.alert.id,
          error,
        });
        await recordAlertChannelDeliveryFailure({
          userId: input.userId,
          userEmail: input.userEmail,
          alertId: input.alert.id,
          email: input.email,
          channel: 'telegram',
          error,
        });
      }
    }

    if (deliveredChannels.length === 0) {
      if (traceContext) {
        await finalizeAiTraceRun(traceContext, {
          status: 'FALLBACK',
          outputPreview: deriveOutputPreview(result.response),
          errorMessage: 'no-delivery-channel',
          metadata: {
            alertId: input.alert.id,
            channelsTried: deliveredChannels,
          },
        });
      }
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

    if (traceContext) {
      await finalizeAiTraceRun(traceContext, {
        status: result.status === 'ok' ? 'OK' : 'FALLBACK',
        outputPreview: deriveOutputPreview(result.response),
        errorMessage: result.status === 'ok' ? null : result.error ?? 'Executive Agent fallback',
        metadata: {
          alertId: input.alert.id,
          channels: deliveredChannels,
          agentStatus: result.status,
        },
      });
    }

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
    if (traceContext) {
      await finalizeAiTraceRun(traceContext, {
        status: deriveRunStatusFromError(error),
        outputPreview: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          alertId: input.alert.id,
        },
      });
    }
  }
}
