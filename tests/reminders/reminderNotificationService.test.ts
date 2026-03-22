import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
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
import {
  getReminderIdsEligibleForTerminalFailureMiss,
  markReminderMissed,
  REMINDER_PRE_DELIVERY_MISSABLE_STATUS_LIST,
} from '@/lib/services/reminderNotificationService';

describe('reminder notification failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
