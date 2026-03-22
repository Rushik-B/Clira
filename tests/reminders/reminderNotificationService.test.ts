import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminder: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    actionHistory: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/ai/agents/executiveAgent', () => ({
  getExecutiveAgent: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/ai/tracing', () => ({
  createAiTraceRoot: vi.fn(),
  deriveOutputPreview: vi.fn(),
  deriveRunStatusFromError: vi.fn(() => 'ERROR'),
  finalizeAiTraceRun: vi.fn(),
}));

vi.mock('@/lib/services/whatsapp', () => ({
  getConversationManager: vi.fn(),
  getWhatsAppClient: vi.fn(),
}));

vi.mock('@/lib/services/telegram', () => ({
  getConversationManager: vi.fn(),
  getTelegramClient: vi.fn(),
}));

vi.mock('@/lib/services/messagingDeliveryTargets', () => ({
  resolveMessagingTargets: vi.fn(),
}));

vi.mock('@/lib/services/notificationProgressContext', () => ({
  buildNotificationProgressContext: vi.fn(),
}));

vi.mock('@/lib/utils/timezone', () => ({
  convertUserLocalTimeToUtc: vi.fn(),
  getZonedTimeComponents: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getExecutiveAgent } from '@/lib/ai/agents/executiveAgent';
import {
  getConversationManager as getWhatsAppConversationManager,
  getWhatsAppClient,
} from '@/lib/services/whatsapp';
import { resolveMessagingTargets } from '@/lib/services/messagingDeliveryTargets';
import {
  getReminderIdsEligibleForTerminalFailureMiss,
  markReminderMissed,
  REMINDER_PRE_DELIVERY_MISSABLE_STATUS_LIST,
  triggerReminderNotifications,
} from '@/lib/services/reminderNotificationService';

describe('reminder notification failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test('filters terminal worker miss writes to reminders still pending delivery', async () => {
    vi.mocked(prisma.reminder.findMany).mockResolvedValue([
      { id: 'reminder-2' },
      { id: 'reminder-1' },
    ] as never);

    const result = await getReminderIdsEligibleForTerminalFailureMiss({
      reminderIds: ['reminder-1', 'reminder-2', 'reminder-3'],
      userId: 'user-1',
    });

    expect(prisma.reminder.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['reminder-1', 'reminder-2', 'reminder-3'] },
        userId: 'user-1',
        status: { in: ['PENDING', 'SNOOZED'] },
      },
      select: { id: true },
    });
    expect(result).toEqual(['reminder-1', 'reminder-2']);
  });

  test('preserves delivered-to-missed transitions for async provider failure callbacks', async () => {
    vi.mocked(prisma.reminder.findFirst).mockResolvedValue({
      id: 'reminder-1',
      title: 'Pay rent',
      scheduledAt: new Date('2026-03-22T12:00:00.000Z'),
      status: 'DELIVERED',
    } as never);
    vi.mocked(prisma.reminder.updateMany).mockResolvedValue({ count: 1 } as never);

    await markReminderMissed({
      reminderId: 'reminder-1',
      userId: 'user-1',
      reason: 'whatsapp-status-failed',
    });

    expect(prisma.reminder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'reminder-1',
        userId: 'user-1',
        status: { in: ['PENDING', 'SNOOZED', 'DELIVERED'] },
      },
      data: { status: 'MISSED', deliveryClaimId: null },
    });
    expect(prisma.actionHistory.create).toHaveBeenCalledTimes(1);
  });

  test('blocks delivered reminders from worker terminal miss cleanup', async () => {
    vi.mocked(prisma.reminder.findFirst).mockResolvedValue({
      id: 'reminder-1',
      title: 'Pay rent',
      scheduledAt: new Date('2026-03-22T12:00:00.000Z'),
      status: 'DELIVERED',
    } as never);

    await markReminderMissed({
      reminderId: 'reminder-1',
      userId: 'user-1',
      reason: 'delivery-failed',
      allowedStatuses: REMINDER_PRE_DELIVERY_MISSABLE_STATUS_LIST,
    });

    expect(prisma.reminder.updateMany).not.toHaveBeenCalled();
    expect(prisma.actionHistory.create).not.toHaveBeenCalled();
  });

  test('uses snoozedUntil for delivering reminders when composing and recording delivery dueAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T12:05:30.000Z'));

    const reminderFindMany = vi.mocked(prisma.reminder.findMany);
    reminderFindMany
      .mockResolvedValueOnce([
        {
          id: 'reminder-1',
          userId: 'user-1',
          title: 'Pay rent',
          status: 'SNOOZED',
          scheduledAt: new Date('2026-03-22T11:00:00.000Z'),
          snoozedUntil: new Date('2026-03-22T12:05:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'reminder-1',
          userId: 'user-1',
          title: 'Pay rent',
          description: null,
          context: null,
          status: 'DELIVERING',
          scheduledAt: new Date('2026-03-22T11:00:00.000Z'),
          snoozedUntil: new Date('2026-03-22T12:05:00.000Z'),
          recurrence: null,
          linkedEmailId: null,
          linkedEventId: null,
          user: {
            email: 'user@example.com',
            settings: {
              whatsappPhoneNumber: '+15551234567',
              whatsappVerified: true,
              calendarTimezone: 'America/Vancouver',
              notificationDeliveryChannel: 'WHATSAPP',
            },
          },
        },
      ] as never);

    const reminderUpdateMany = vi.mocked(prisma.reminder.updateMany);
    reminderUpdateMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma as never) as never,
    );

    const addMessage = vi.fn();
    const getRecentMessages = vi.fn().mockResolvedValue([]);
    vi.mocked(getWhatsAppConversationManager).mockReturnValue({
      getOrCreateConversation: vi.fn().mockResolvedValue({ id: 'wa-conversation-1' }),
      addMessage,
      getRecentMessages,
    } as never);

    vi.mocked(resolveMessagingTargets).mockResolvedValue({
      shouldSendWhatsApp: true,
      telegramTarget: null,
      skipReason: null,
    } as never);

    vi.mocked(getExecutiveAgent).mockReturnValue({
      process: vi.fn().mockResolvedValue({
        status: 'ok',
        response: 'Reminder sent',
        metadata: null,
      }),
    } as never);

    vi.mocked(getWhatsAppClient).mockReturnValue({
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'wa-message-1' }),
    } as never);

    await triggerReminderNotifications({
      userId: 'user-1',
      userEmail: 'user@example.com',
      dueMinuteEpochMs: new Date('2026-03-22T12:05:00.000Z').getTime(),
      items: [{ reminderId: 'reminder-1' }],
    });

    expect(addMessage).toHaveBeenCalledWith(
      'wa-conversation-1',
      expect.objectContaining({
        content: expect.stringContaining('Scheduled for: 2026-03-22T12:05:00.000Z'),
      }),
    );
    expect(prisma.actionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        actionType: 'REMINDER_DELIVERED',
        actionDetails: expect.objectContaining({
          reminderId: 'reminder-1',
          dueAt: '2026-03-22T12:05:00.000Z',
        }),
      }),
    });
  });

  test('releases claimed reminders when inbound conversation persistence fails before send', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T12:05:30.000Z'));

    const reminderFindMany = vi.mocked(prisma.reminder.findMany);
    reminderFindMany
      .mockResolvedValueOnce([
        {
          id: 'reminder-1',
          userId: 'user-1',
          title: 'Pay rent',
          status: 'PENDING',
          scheduledAt: new Date('2026-03-22T12:05:00.000Z'),
          snoozedUntil: null,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'reminder-1',
          userId: 'user-1',
          title: 'Pay rent',
          description: null,
          context: null,
          status: 'DELIVERING',
          scheduledAt: new Date('2026-03-22T12:05:00.000Z'),
          snoozedUntil: null,
          recurrence: null,
          linkedEmailId: null,
          linkedEventId: null,
          user: {
            email: 'user@example.com',
            settings: {
              whatsappPhoneNumber: '+15551234567',
              whatsappVerified: true,
              calendarTimezone: 'America/Vancouver',
              notificationDeliveryChannel: 'WHATSAPP',
            },
          },
        },
      ] as never);

    const reminderUpdateMany = vi.mocked(prisma.reminder.updateMany);
    reminderUpdateMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);

    vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma as never) as never;
      }

      return Promise.all(arg as Promise<unknown>[]) as never;
    });

    const addMessage = vi.fn().mockRejectedValue(new Error('inbound persist failed'));
    vi.mocked(getWhatsAppConversationManager).mockReturnValue({
      getOrCreateConversation: vi.fn().mockResolvedValue({ id: 'wa-conversation-1' }),
      addMessage,
      getRecentMessages: vi.fn().mockResolvedValue([]),
    } as never);

    vi.mocked(resolveMessagingTargets).mockResolvedValue({
      shouldSendWhatsApp: true,
      telegramTarget: null,
      skipReason: null,
    } as never);

    const process = vi.fn();
    vi.mocked(getExecutiveAgent).mockReturnValue({
      process,
    } as never);

    await expect(triggerReminderNotifications({
      userId: 'user-1',
      userEmail: 'user@example.com',
      dueMinuteEpochMs: new Date('2026-03-22T12:05:00.000Z').getTime(),
      items: [{ reminderId: 'reminder-1' }],
    })).rejects.toThrow('inbound persist failed');

    expect(reminderUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['reminder-1'] },
          userId: 'user-1',
          status: 'DELIVERING',
          deliveryClaimId: expect.any(String),
        }),
        data: {
          status: 'PENDING',
          deliveryClaimId: null,
        },
      }),
    );
    expect(process).not.toHaveBeenCalled();
  });
});
