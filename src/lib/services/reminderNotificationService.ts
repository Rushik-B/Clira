import crypto from 'crypto';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { getExecutiveAgent } from '@/lib/ai/agents/executiveAgent';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
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
import { convertUserLocalTimeToUtc, getZonedTimeComponents } from '@/lib/utils/timezone';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';
import type { Prisma, ReminderStatus } from '@prisma/client';

type ReminderRecurrence = {
  type: 'daily' | 'weekly' | 'monthly';
  daysOfWeek?: number[];
  dayOfMonth?: number;
  until?: string;
};

export interface ReminderNotificationInput {
  reminderId: string;
  userId: string;
  userEmail: string;
  title: string;
  context?: string;
}

const REMINDER_DELIVERABLE_STATUS_LIST: ReminderStatus[] = ['PENDING', 'SNOOZED'];
const REMINDER_MISSABLE_STATUS_LIST: ReminderStatus[] = ['PENDING', 'SNOOZED', 'DELIVERED'];

function getLocalDayOfWeek(date: Date): number {
  return date.getUTCDay();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeRecurrence(value: unknown): ReminderRecurrence | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const type = record.type;
  if (type !== 'daily' && type !== 'weekly' && type !== 'monthly') return null;

  const recurrence: ReminderRecurrence = { type };

  if (Array.isArray(record.daysOfWeek)) {
    const days = record.daysOfWeek
      .filter((day) => typeof day === 'number' && Number.isInteger(day))
      .map((day) => Math.min(6, Math.max(0, day)));
    if (days.length > 0) {
      recurrence.daysOfWeek = Array.from(new Set(days)).sort((a, b) => a - b);
    }
  }

  if (typeof record.dayOfMonth === 'number' && Number.isInteger(record.dayOfMonth)) {
    const dayOfMonth = Math.min(31, Math.max(1, record.dayOfMonth));
    recurrence.dayOfMonth = dayOfMonth;
  }

  if (typeof record.until === 'string') {
    recurrence.until = record.until;
  }

  return recurrence;
}

function calculateNextOccurrence(
  scheduledAt: Date,
  recurrence: ReminderRecurrence,
  timeZone: string,
): Date | null {
  const local = getZonedTimeComponents(scheduledAt, timeZone);
  const baseLocalDate = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second),
  );

  let nextLocal: Date | null = null;

  if (recurrence.type === 'daily') {
    nextLocal = addDays(baseLocalDate, 1);
  } else if (recurrence.type === 'weekly') {
    const baseDay = getLocalDayOfWeek(baseLocalDate);
    const days = recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0
      ? recurrence.daysOfWeek
      : [baseDay];

    let deltaDays = 7;
    for (const day of days) {
      if (day > baseDay) {
        deltaDays = day - baseDay;
        break;
      }
    }
    if (deltaDays === 7) {
      deltaDays = 7 - baseDay + days[0];
    }

    nextLocal = addDays(baseLocalDate, deltaDays);
  } else if (recurrence.type === 'monthly') {
    let targetYear = local.year;
    let targetMonth = local.month + 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }

    const dayOfMonth = recurrence.dayOfMonth ?? local.day;
    const daysInTargetMonth = getDaysInMonth(targetYear, targetMonth);
    const targetDay = Math.min(dayOfMonth, daysInTargetMonth);

    nextLocal = new Date(
      Date.UTC(targetYear, targetMonth - 1, targetDay, local.hour, local.minute, local.second),
    );
  }

  if (!nextLocal) return null;

  const nextUtc = convertUserLocalTimeToUtc(nextLocal, timeZone);
  if (recurrence.until) {
    const untilDate = new Date(recurrence.until);
    if (!Number.isNaN(untilDate.getTime()) && nextUtc.getTime() > untilDate.getTime()) {
      return null;
    }
  }

  return nextUtc;
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

export async function markReminderMissed({
  reminderId,
  userId,
  reason,
}: {
  reminderId: string;
  userId: string;
  reason?: string;
}): Promise<void> {
  const reminder = await prisma.reminder.findFirst({
    where: { id: reminderId, userId },
    select: { id: true, title: true, scheduledAt: true, status: true },
  });

  if (!reminder || !REMINDER_MISSABLE_STATUS_LIST.includes(reminder.status)) {
    return;
  }

  const updateResult = await prisma.reminder.updateMany({
    where: {
      id: reminderId,
      userId,
      status: { in: REMINDER_MISSABLE_STATUS_LIST },
    },
    data: { status: 'MISSED' },
  });

  if (updateResult.count === 0) {
    return;
  }

  await prisma.actionHistory.create({
    data: {
      userId,
      actionType: 'REMINDER_MISSED',
      actionSummary: `Reminder missed: ${reminder.title}`,
      actionDetails: {
        reminderId,
        scheduledAt: reminder.scheduledAt.toISOString(),
        reason: reason ?? 'delivery-failed',
      },
      undoable: false,
    },
  });
}

export async function triggerReminderNotification(input: ReminderNotificationInput): Promise<void> {
  const reminder = await prisma.reminder.findFirst({
    where: { id: input.reminderId, userId: input.userId },
    select: {
      id: true,
      userId: true,
      title: true,
      description: true,
      context: true,
      status: true,
      scheduledAt: true,
      snoozedUntil: true,
      recurrence: true,
      linkedEmailId: true,
      linkedEventId: true,
      user: {
        select: {
          email: true,
          settings: {
            select: {
              whatsappPhoneNumber: true,
              whatsappVerified: true,
              calendarTimezone: true,
              notificationDeliveryChannel: true,
            },
          },
        },
      },
    },
  });

  if (!reminder) {
    logger.warn(`[reminderNotification] Reminder not found: ${input.reminderId}`);
    return;
  }

  if (!REMINDER_DELIVERABLE_STATUS_LIST.includes(reminder.status)) {
    logger.info(`[reminderNotification] Skipping - status=${reminder.status} reminder=${reminder.id}`);
    return;
  }

  const now = new Date();
  const dueAt = reminder.status === 'SNOOZED' && reminder.snoozedUntil ? reminder.snoozedUntil : reminder.scheduledAt;
  const staleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  if (dueAt.getTime() < staleCutoff.getTime()) {
    await markReminderMissed({
      reminderId: reminder.id,
      userId: reminder.userId,
      reason: 'stale',
    });
    return;
  }

  const lookaheadMs = 65 * 1000; // match cron: allow delivery within 65s of due time
  if (dueAt.getTime() > now.getTime() + lookaheadMs) {
    logger.info(`[reminderNotification] Not due yet - reminder=${reminder.id}`);
    return;
  }

  const settings = reminder.user?.settings;
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
      telegramConversationManager.getMostRecentConversationForUser(reminder.userId),
      pairingManager.getMostRecentActiveLinkForUser(reminder.userId),
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
    logger.info(`[reminderNotification] Skipping - no messaging channels configured for user ${reminder.userId}`);
    await markReminderMissed({
      reminderId: reminder.id,
      userId: reminder.userId,
      reason:
        hasWhatsAppAvailable || hasTelegramAvailable
          ? 'preferred-channel-unavailable'
          : 'messaging-not-configured',
    });
    return;
  }

  const whatsappConversationManager = getWhatsAppConversationManager();
  const telegramConversationManager = getTelegramConversationManager();
  const waId = settings?.whatsappPhoneNumber?.replace(/^\+/, '') ?? '';
  const whatsappConversation = hasWhatsApp
    ? await whatsappConversationManager.getOrCreateConversation(reminder.userId, waId)
    : null;
  const telegramConversation = telegramTarget
    ? await telegramConversationManager.getOrCreateConversation(
        reminder.userId,
        telegramTarget.chatId,
        telegramTarget.telegramUserId,
      )
    : null;

  const agent = getExecutiveAgent();
  const systemMessage =
    `REMINDER DELIVERY: The user asked to be reminded.\n` +
    `Title: "${reminder.title}"\n` +
    (reminder.context ? `Context: ${reminder.context}\n` : '') +
    `Scheduled for: ${dueAt.toISOString()}\n\n` +
    'Notify the user naturally and concisely. Treat this as on-time delivery (within ~1 min of scheduled time); do not say "in X minutes" or "X minutes ago". ' +
    'Offer to snooze or dismiss if appropriate. If the user responds with a snooze or dismiss request, use the reminder tools.';

  if (whatsappConversation) {
    await whatsappConversationManager.addMessage(whatsappConversation.id, {
      content: systemMessage,
      role: 'USER',
      direction: 'INBOUND',
      metadata: { source: 'reminder_notification', reminderId: reminder.id, channel: 'whatsapp' },
    });
  }
  if (telegramConversation) {
    await telegramConversationManager.addMessage(telegramConversation.id, {
      content: systemMessage,
      role: 'USER',
      direction: 'INBOUND',
      metadata: { source: 'reminder_notification', reminderId: reminder.id, channel: 'telegram' },
    });
  }

  const primaryChannel: 'telegram' | 'whatsapp' = telegramConversation ? 'telegram' : 'whatsapp';
  const primaryConversationId = primaryChannel === 'telegram'
    ? telegramConversation!.id
    : whatsappConversation!.id;
  const primaryConversationHistorySource = primaryChannel === 'telegram'
    ? await telegramConversationManager.getRecentMessages(telegramConversation!.id, 15)
    : await whatsappConversationManager.getRecentMessages(whatsappConversation!.id, 15);
  const conversationHistory = primaryConversationHistorySource.map((msg) => ({
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
    userId: reminder.userId,
    userEmail: reminder.user?.email ?? input.userEmail,
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
    outboundMetadata.source = 'reminder_notification';
    outboundMetadata.reminderId = reminder.id;
    outboundMetadata.dueAt = dueAt.toISOString();
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
    outboundMetadata.source = 'reminder_notification';
    outboundMetadata.reminderId = reminder.id;
    outboundMetadata.dueAt = dueAt.toISOString();
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
    await markReminderMissed({
      reminderId: reminder.id,
      userId: reminder.userId,
      reason: 'messaging-delivery-failed',
    });
    return;
  }

  await prisma.reminder.update({
    where: { id: reminder.id },
    data: {
      status: 'DELIVERED',
      deliveredAt: now,
      snoozedUntil: null,
    },
  });

  await prisma.actionHistory.create({
    data: {
      userId: reminder.userId,
      actionType: 'REMINDER_DELIVERED',
      actionSummary: `Reminder delivered: ${reminder.title}`,
      actionDetails: {
        reminderId: reminder.id,
        scheduledAt: reminder.scheduledAt.toISOString(),
        dueAt: dueAt.toISOString(),
        deliveredAt: now.toISOString(),
        linkedEmailId: reminder.linkedEmailId,
        linkedEventId: reminder.linkedEventId,
        channels: deliveredChannels,
      },
      undoable: false,
    },
  });

  const recurrence = normalizeRecurrence(reminder.recurrence);
  if (recurrence) {
    const timeZone = settings?.calendarTimezone ?? DEFAULT_CALENDAR_TIMEZONE;
    const nextScheduledAt = calculateNextOccurrence(reminder.scheduledAt, recurrence, timeZone);

    if (nextScheduledAt) {
      await prisma.reminder.create({
        data: {
          userId: reminder.userId,
          title: reminder.title,
          description: reminder.description,
          context: reminder.context,
          scheduledAt: nextScheduledAt,
          recurrence: reminder.recurrence ?? undefined,
          linkedEmailId: reminder.linkedEmailId,
          linkedEventId: reminder.linkedEventId,
        },
      });
    }
  }
}
