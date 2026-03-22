import { randomUUID } from 'node:crypto';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { getExecutiveAgent } from '@/lib/ai/agents/executiveAgent';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
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
import { convertUserLocalTimeToUtc, getZonedTimeComponents } from '@/lib/utils/timezone';
import type { ReminderNotificationJobData } from '@/lib/services/utils/queues';
import type { NotificationDeliveryChannel, Prisma, ReminderStatus } from '@prisma/client';

type ReminderRecurrence = {
  type: 'daily' | 'weekly' | 'monthly';
  daysOfWeek?: number[];
  dayOfMonth?: number;
  until?: string;
};

/** Start of the UTC minute containing `d`, in epoch ms (used for cron batching). */
export function utcDueMinuteEpochMs(d: Date): number {
  return Math.floor(d.getTime() / 60000) * 60000;
}

const REMINDER_CLAIMED_STATUS: ReminderStatus = 'DELIVERING';
const REMINDER_DELIVERABLE_STATUS_LIST: ReminderStatus[] = ['PENDING', 'SNOOZED'];
export const REMINDER_PRE_DELIVERY_MISSABLE_STATUS_LIST: readonly ReminderStatus[] = ['PENDING', 'SNOOZED'];
const REMINDER_MISSABLE_STATUS_LIST: ReminderStatus[] = [
  ...REMINDER_PRE_DELIVERY_MISSABLE_STATUS_LIST,
  REMINDER_CLAIMED_STATUS,
  'DELIVERED',
];

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

export async function markReminderMissed({
  reminderId,
  userId,
  reason,
  allowedStatuses = REMINDER_MISSABLE_STATUS_LIST,
}: {
  reminderId: string;
  userId: string;
  reason?: string;
  allowedStatuses?: readonly ReminderStatus[];
}): Promise<void> {
  if (allowedStatuses.length === 0) {
    return;
  }

  const reminder = await prisma.reminder.findFirst({
    where: { id: reminderId, userId },
    select: { id: true, title: true, scheduledAt: true, status: true },
  });

  if (!reminder || !allowedStatuses.includes(reminder.status)) {
    return;
  }

  const updateResult = await prisma.reminder.updateMany({
    where: {
      id: reminderId,
      userId,
      status: { in: [...allowedStatuses] },
    },
    data: {
      status: 'MISSED',
      deliveryClaimId: null,
    },
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

export async function getReminderIdsEligibleForTerminalFailureMiss({
  reminderIds,
  userId,
}: {
  reminderIds: string[];
  userId: string;
}): Promise<string[]> {
  const uniqueReminderIds = [...new Set(reminderIds)];
  if (uniqueReminderIds.length === 0) {
    return [];
  }

  const eligibleReminders = await prisma.reminder.findMany({
    where: {
      id: { in: uniqueReminderIds },
      userId,
      status: { in: [...REMINDER_PRE_DELIVERY_MISSABLE_STATUS_LIST] },
    },
    select: { id: true },
  });

  const eligibleIds = new Set(eligibleReminders.map((reminder) => reminder.id));
  return reminderIds.filter((reminderId) => eligibleIds.has(reminderId));
}

type ReminderDeliveryRow = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  context: string | null;
  status: ReminderStatus;
  scheduledAt: Date;
  snoozedUntil: Date | null;
  recurrence: Prisma.JsonValue | null;
  linkedEmailId: string | null;
  linkedEventId: string | null;
  user: {
    email: string | null;
    settings: {
      whatsappPhoneNumber: string | null;
      whatsappVerified: boolean | null;
      calendarTimezone: string | null;
      notificationDeliveryChannel: string | null;
    } | null;
  } | null;
};

const REMINDER_DELIVERY_SELECT = {
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
} satisfies Prisma.ReminderSelect;

function reminderDueAt(r: ReminderDeliveryRow): Date {
  return r.status === 'SNOOZED' && r.snoozedUntil ? r.snoozedUntil : r.scheduledAt;
}

function buildBatchReminderSystemMessage(reminders: ReminderDeliveryRow[]): string {
  const n = reminders.length;
  if (n === 1) {
    const r = reminders[0];
    const dueAt = reminderDueAt(r);
    return (
      `REMINDER DELIVERY\n` +
      `Title: "${r.title}"\n` +
      (r.context ? `Context: ${r.context}\n` : '') +
      `Scheduled for: ${dueAt.toISOString()}`
    );
  }

  const lines = reminders.map((r, i) => {
    const dueAt = reminderDueAt(r);
    return (
      `${i + 1}) Title: "${r.title}"\n` +
      (r.context ? `   Context: ${r.context}\n` : '') +
      `   Scheduled for: ${dueAt.toISOString()}`
    );
  });
  return (
    `REMINDER DELIVERY (batch: ${n} reminders due this minute)\n\n` +
    `This is one delivery covering every item below. Address every item in a single message. ` +
    `Use a short numbered or bulleted list when it keeps things clear. ` +
    `Do not omit an item, do not merge two items into one vague line, and do not add topics that are not listed.\n\n` +
    lines.join('\n\n')
  );
}

/**
 * Delivers one or more reminders for the same user that share the same UTC minute bucket.
 * Enqueued by the reminder cron as one job per (user, minute).
 *
 * This flow is intentionally non-atomic across the batch: a reminder can already be
 * persisted as DELIVERED before later work in the same batch fails. Callers reconciling
 * terminal worker failures must reload current statuses before writing MISSED.
 */
export async function triggerReminderNotifications(data: ReminderNotificationJobData): Promise<void> {
  const { userId, userEmail, dueMinuteEpochMs, items } = data;
  if (items.length === 0) {
    logger.warn('[reminderNotification] Empty batch, skipping');
    return;
  }

  const uniqueIds = [...new Set(items.map((i) => i.reminderId))];
  const loaded = await prisma.reminder.findMany({
    where: { id: { in: uniqueIds }, userId },
    select: REMINDER_DELIVERY_SELECT,
  });

  const byId = new Map(loaded.map((r) => [r.id, r as ReminderDeliveryRow]));
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const deliverable: ReminderDeliveryRow[] = [];

  for (const id of uniqueIds) {
    const reminder = byId.get(id);
    if (!reminder) {
      logger.warn(`[reminderNotification] Reminder not found: ${id}`);
      continue;
    }
    if (!REMINDER_DELIVERABLE_STATUS_LIST.includes(reminder.status)) {
      logger.info(`[reminderNotification] Skipping - status=${reminder.status} reminder=${reminder.id}`);
      continue;
    }

    const dueAt = reminderDueAt(reminder);
    if (dueAt.getTime() < staleCutoff.getTime()) {
      await markReminderMissed({
        reminderId: reminder.id,
        userId: reminder.userId,
        reason: 'stale',
      });
      continue;
    }
    if (dueAt.getTime() > now.getTime()) {
      logger.info(`[reminderNotification] Not due yet - reminder=${reminder.id}`);
      continue;
    }
    if (
      dueMinuteEpochMs !== 0 &&
      utcDueMinuteEpochMs(dueAt) !== dueMinuteEpochMs
    ) {
      logger.warn('[reminderNotification] due minute mismatch (still delivering)', {
        reminderId: reminder.id,
        expectedBucket: dueMinuteEpochMs,
        actualBucket: utcDueMinuteEpochMs(dueAt),
      });
    }
    deliverable.push(reminder);
  }

  if (deliverable.length === 0) {
    return;
  }

  deliverable.sort((a, b) => {
    const da = reminderDueAt(a).getTime();
    const db = reminderDueAt(b).getTime();
    return da - db || a.title.localeCompare(b.title);
  });

  const primary = deliverable[0];
  const settings = primary.user?.settings;
  const targetResolution = await resolveMessagingTargets({
    userId,
    whatsappPhoneNumber: settings?.whatsappPhoneNumber,
    whatsappVerified: settings?.whatsappVerified,
    notificationDeliveryChannel: settings?.notificationDeliveryChannel as
      | NotificationDeliveryChannel
      | null
      | undefined,
  });
  const hasWhatsApp = targetResolution.shouldSendWhatsApp;
  const telegramTarget = targetResolution.telegramTarget;

  if (!hasWhatsApp && !telegramTarget) {
    logger.info(`[reminderNotification] Skipping batch - no messaging channels configured for user ${userId}`);
    for (const r of deliverable) {
      await markReminderMissed({
        reminderId: r.id,
        userId,
        reason: targetResolution.skipReason ?? 'messaging-not-configured',
      });
    }
    return;
  }

  const whatsappConversationManager = getWhatsAppConversationManager();
  const telegramConversationManager = getTelegramConversationManager();
  const waId = settings?.whatsappPhoneNumber?.replace(/^\+/, '') ?? '';
  const whatsappConversation = hasWhatsApp
    ? await whatsappConversationManager.getOrCreateConversation(userId, waId)
    : null;
  const telegramConversation = telegramTarget
    ? await telegramConversationManager.getOrCreateConversation(
        userId,
        telegramTarget.chatId,
        telegramTarget.telegramUserId,
      )
    : null;

  const agent = getExecutiveAgent();
  const systemMessage = buildBatchReminderSystemMessage(deliverable);
  const reminderIds = deliverable.map((r) => r.id);

  const inboundMetadataBase = {
    source: 'reminder_notification',
    reminderIds,
    batch: deliverable.length > 1,
  };

  if (whatsappConversation) {
    await whatsappConversationManager.addMessage(whatsappConversation.id, {
      content: systemMessage,
      role: 'USER',
      direction: 'INBOUND',
      metadata: { ...inboundMetadataBase, channel: 'whatsapp' } as Prisma.InputJsonObject,
    });
  }
  if (telegramConversation) {
    await telegramConversationManager.addMessage(telegramConversation.id, {
      content: systemMessage,
      role: 'USER',
      direction: 'INBOUND',
      metadata: { ...inboundMetadataBase, channel: 'telegram' } as Prisma.InputJsonObject,
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

  let traceContext: AiTraceContext | undefined;

  try {
    traceContext = await createAiTraceRoot({
      pipeline: 'reminder-notification',
      userId,
      channel: primaryChannel,
      conversationId: primaryConversationId,
      label: 'reminder-notification',
      inputPreview: systemMessage.slice(0, 2000),
      metadata: {
        reminderIds,
        batchSize: deliverable.length,
        dueMinuteEpochMs,
      },
    });

    const result = await agent.process({
      userId,
      userEmail: primary.user?.email ?? userEmail,
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
        outboundMetadata.source = 'reminder_notification';
        outboundMetadata.reminderIds = reminderIds;
        outboundMetadata.batch = deliverable.length > 1;
        outboundMetadata.dueMinuteEpochMs = dueMinuteEpochMs;
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
        logger.error('[reminderNotification] WhatsApp delivery failed', {
          reminderIds,
          userId,
          userEmail,
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
        outboundMetadata.source = 'reminder_notification';
        outboundMetadata.reminderIds = reminderIds;
        outboundMetadata.batch = deliverable.length > 1;
        outboundMetadata.dueMinuteEpochMs = dueMinuteEpochMs;
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
        logger.error('[reminderNotification] Telegram delivery failed', {
          reminderIds,
          userId,
          userEmail,
          error,
        });
      }
    }

    if (deliveredChannels.length === 0) {
      if (traceContext) {
        await finalizeAiTraceRun(traceContext, {
          status: 'FALLBACK',
          outputPreview: deriveOutputPreview(result.response),
          errorMessage: 'messaging-delivery-failed',
          metadata: {
            reminderIds,
            channelsTried: deliveredChannels,
          },
        });
      }
      for (const r of deliverable) {
        await markReminderMissed({
          reminderId: r.id,
          userId,
          reason: 'messaging-delivery-failed',
        });
      }
      return;
    }

    for (const reminder of deliverable) {
      const dueAt = reminderDueAt(reminder);
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
            batchReminderIds: reminderIds,
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

    if (traceContext) {
      await finalizeAiTraceRun(traceContext, {
        status: result.status === 'ok' ? 'OK' : 'FALLBACK',
        outputPreview: deriveOutputPreview(result.response),
        errorMessage: result.status === 'ok' ? null : result.error ?? 'Executive Agent fallback',
        metadata: {
          reminderIds,
          channels: deliveredChannels,
          agentStatus: result.status,
        },
      });
    }
  } catch (error) {
    logger.error('[reminderNotification] Failed during delivery pipeline', {
      reminderIds,
      userId,
      error,
    });
    if (traceContext) {
      await finalizeAiTraceRun(traceContext, {
        status: deriveRunStatusFromError(error),
        outputPreview: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          reminderIds,
        },
      });
    }
  }
}
