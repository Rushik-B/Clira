import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getExecutiveAgent } from '@/lib/ai/agents/executiveAgent';
import { getWhatsAppClient, isWhatsAppConfigured, getConversationManager } from '@/lib/services/whatsapp';
import type { Prisma } from '@prisma/client';

interface AlertNotificationInput {
  userId: string;
  userEmail: string;
  email: { from: string; subject: string; snippet: string };
  alert: { id: string; description: string };
}

// Orchestrates alert notifications via ExecutiveAgent + WhatsApp.
export async function triggerAlertNotification(input: AlertNotificationInput): Promise<void> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: input.userId },
    select: { whatsappPhoneNumber: true, whatsappVerified: true },
  });

  if (!settings?.whatsappPhoneNumber || !settings.whatsappVerified || !isWhatsAppConfigured()) {
    logger.info(`[alertNotification] Skipping - WhatsApp not configured for user ${input.userId}`);

    await prisma.actionHistory.create({
      data: {
        userId: input.userId,
        actionType: 'ALERT_SKIPPED',
        actionSummary: 'Alert matched but WhatsApp not configured',
        actionDetails: { alertId: input.alert.id, email: input.email },
        undoable: false,
      },
    });
    return;
  }

  const conversationManager = getConversationManager();
  const waId = settings.whatsappPhoneNumber.replace(/^\+/, '');
  const conversation = await conversationManager.getOrCreateConversation(input.userId, waId);

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
    // Log the system trigger as an inbound message for conversation continuity
    await conversationManager.addMessage(conversation.id, {
      content: systemMessage,
      role: 'USER',
      direction: 'INBOUND',
      metadata: { source: 'alert_notification', alertId: input.alert.id },
    });

    // Fetch recent conversation history so the EA has context
    const recentMessages = await conversationManager.getRecentMessages(conversation.id, 15);
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

    const result = await agent.process({
      userId: input.userId,
      userEmail: input.userEmail,
      userRequest: systemMessage,
      conversationId: conversation.id,
      conversationHistory,
    });

    const client = getWhatsAppClient();
    const { messageId: waResponseId } = await client.sendMessage(settings.whatsappPhoneNumber, result.response);

    // Log the assistant response for conversation continuity
    const outboundMetadata =
      result.metadata != null && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
        ? { ...(result.metadata as Record<string, unknown>) }
        : {};
    outboundMetadata.source = 'alert_notification';
    outboundMetadata.alertId = input.alert.id;

    await conversationManager.addMessage(conversation.id, {
      content: result.response,
      role: 'ASSISTANT',
      direction: 'OUTBOUND',
      waMessageId: waResponseId,
      metadata: outboundMetadata as Prisma.InputJsonObject,
    });

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
        },
        undoable: false,
      },
    });
  } catch (error) {
    logger.error('[alertNotification] Failed:', error);
  }
}
