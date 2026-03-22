import { beforeEach, describe, expect, test, vi } from 'vitest';

import { logger } from '@/lib/logger';
import {
  claimReminderBatchForDelivery,
  utcDueMinuteEpochMs,
} from '@/lib/services/reminderNotificationService';

describe('claimReminderBatchForDelivery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  test('claims only due reminders and marks stale reminders missed before delivery', async () => {
    const now = new Date('2026-03-22T12:00:00.000Z');
    const dueMinuteEpochMs = utcDueMinuteEpochMs(new Date('2026-03-22T11:59:00.000Z'));
    const initialFindMany = vi.fn().mockResolvedValue([
      {
        id: 'r-due',
        userId: 'user-1',
        title: 'Due reminder',
        status: 'PENDING',
        scheduledAt: new Date('2026-03-22T11:59:00.000Z'),
        snoozedUntil: null,
      },
      {
        id: 'r-stale',
        userId: 'user-1',
        title: 'Stale reminder',
        status: 'SNOOZED',
        scheduledAt: new Date('2026-03-20T09:00:00.000Z'),
        snoozedUntil: new Date('2026-03-20T10:00:00.000Z'),
      },
      {
        id: 'r-future',
        userId: 'user-1',
        title: 'Future reminder',
        status: 'PENDING',
        scheduledAt: new Date('2026-03-22T12:05:00.000Z'),
        snoozedUntil: null,
      },
    ]);
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txFindMany = vi.fn().mockResolvedValue([
      {
        id: 'r-due',
        userId: 'user-1',
        title: 'Due reminder',
        description: null,
        context: null,
        status: 'DELIVERING',
        scheduledAt: new Date('2026-03-22T11:59:00.000Z'),
        snoozedUntil: null,
        recurrence: null,
        linkedEmailId: null,
        linkedEventId: null,
        user: null,
      },
    ]);
    const db = {
      reminder: {
        findMany: initialFindMany,
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        reminder: {
          updateMany: txUpdateMany,
          findMany: txFindMany,
        },
      })),
    } as never;
    const markMissed = vi.fn().mockResolvedValue(undefined);

    const result = await claimReminderBatchForDelivery({
      userId: 'user-1',
      dueMinuteEpochMs,
      uniqueIds: ['r-due', 'r-stale', 'r-future'],
      now,
      db,
      markMissed,
    });

    expect(markMissed).toHaveBeenCalledWith({
      reminderId: 'r-stale',
      userId: 'user-1',
      reason: 'stale',
    });
    expect(txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['r-due'] },
        userId: 'user-1',
      }),
      data: expect.objectContaining({
        status: 'DELIVERING',
        deliveryClaimId: expect.any(String),
      }),
    }));
    expect(result.candidateIds).toEqual(['r-due']);
    expect(result.claimed.map((reminder) => reminder.id)).toEqual(['r-due']);
    expect(result.originalStatuses.get('r-due')).toBe('PENDING');
  });

  test('warns when fewer reminders are claimed than expected', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const now = new Date('2026-03-22T12:00:00.000Z');
    const dueMinuteEpochMs = utcDueMinuteEpochMs(new Date('2026-03-22T11:59:00.000Z'));
    const initialFindMany = vi.fn().mockResolvedValue([
      {
        id: 'r-1',
        userId: 'user-1',
        title: 'Reminder 1',
        status: 'PENDING',
        scheduledAt: new Date('2026-03-22T11:59:00.000Z'),
        snoozedUntil: null,
      },
      {
        id: 'r-2',
        userId: 'user-1',
        title: 'Reminder 2',
        status: 'SNOOZED',
        scheduledAt: new Date('2026-03-22T11:00:00.000Z'),
        snoozedUntil: new Date('2026-03-22T11:59:00.000Z'),
      },
    ]);
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txFindMany = vi.fn().mockResolvedValue([
      {
        id: 'r-1',
        userId: 'user-1',
        title: 'Reminder 1',
        description: null,
        context: null,
        status: 'DELIVERING',
        scheduledAt: new Date('2026-03-22T11:59:00.000Z'),
        snoozedUntil: null,
        recurrence: null,
        linkedEmailId: null,
        linkedEventId: null,
        user: null,
      },
    ]);
    const db = {
      reminder: {
        findMany: initialFindMany,
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        reminder: {
          updateMany: txUpdateMany,
          findMany: txFindMany,
        },
      })),
    } as never;

    await claimReminderBatchForDelivery({
      userId: 'user-1',
      dueMinuteEpochMs,
      uniqueIds: ['r-1', 'r-2'],
      now,
      db,
      markMissed: vi.fn().mockResolvedValue(undefined),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[reminderNotification] Partial reminder claim before delivery',
      expect.objectContaining({
        userId: 'user-1',
        expectedClaimCount: 2,
        claimCount: 1,
        claimedRowCount: 1,
        reminderIds: ['r-1', 'r-2'],
      }),
    );
  });

  test('reapplies the due-time predicates inside the claim transaction', async () => {
    const now = new Date('2026-03-22T12:00:30.000Z');
    const dueMinuteEpochMs = utcDueMinuteEpochMs(new Date('2026-03-22T11:59:00.000Z'));
    const initialFindMany = vi.fn().mockResolvedValue([
      {
        id: 'r-raced',
        userId: 'user-1',
        title: 'Raced reminder',
        status: 'PENDING',
        scheduledAt: new Date('2026-03-22T11:59:30.000Z'),
        snoozedUntil: null,
      },
    ]);
    const txUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const txFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      reminder: {
        findMany: initialFindMany,
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        reminder: {
          updateMany: txUpdateMany,
          findMany: txFindMany,
        },
      })),
    } as never;

    const result = await claimReminderBatchForDelivery({
      userId: 'user-1',
      dueMinuteEpochMs,
      uniqueIds: ['r-raced'],
      now,
      db,
      markMissed: vi.fn().mockResolvedValue(undefined),
    });

    expect(txUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['r-raced'] },
        userId: 'user-1',
        status: { in: ['PENDING', 'SNOOZED'] },
        OR: [
          {
            status: 'PENDING',
            scheduledAt: {
              gte: new Date('2026-03-22T11:59:00.000Z'),
              lte: now,
              lt: new Date('2026-03-22T12:00:00.000Z'),
            },
          },
          {
            status: 'SNOOZED',
            snoozedUntil: {
              gte: new Date('2026-03-22T11:59:00.000Z'),
              lte: now,
              lt: new Date('2026-03-22T12:00:00.000Z'),
            },
          },
          {
            status: 'SNOOZED',
            snoozedUntil: null,
            scheduledAt: {
              gte: new Date('2026-03-22T11:59:00.000Z'),
              lte: now,
              lt: new Date('2026-03-22T12:00:00.000Z'),
            },
          },
        ],
      },
      data: {
        status: 'DELIVERING',
        deliveryClaimId: expect.any(String),
      },
    });
    expect(result.candidateIds).toEqual(['r-raced']);
    expect(result.claimed).toEqual([]);
  });
});
