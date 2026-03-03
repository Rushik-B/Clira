import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reminderNotificationQueue } from '@/lib/services/utils/queues';
import { markReminderMissed } from '@/lib/services/reminderNotificationService';

const CRON_SECRET = process.env.CRON_SECRET;
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Reminder Notification Cron Endpoint
 *
 * Runs on cron schedule to check for due reminders and enqueue them for delivery.
 * - Queues reminders that are due now or overdue (`current_time >= reminder_time`)
 * - Marks stale reminders (>24h old) as MISSED
 * - Uses deduplication via jobId to prevent double-delivery
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  if (!CRON_SECRET) {
    console.error('[REMINDER CRON] ❌ CRON_SECRET is not configured');
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    console.warn('[REMINDER CRON] ⚠️ Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[REMINDER CRON] 🚀 Starting reminder check...');

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_MS);

  const reminders = await prisma.reminder.findMany({
    where: {
      OR: [
        { status: 'PENDING', scheduledAt: { lte: now } },
        { status: 'SNOOZED', snoozedUntil: { lte: now } },
        { status: 'SNOOZED', snoozedUntil: null, scheduledAt: { lte: now } },
      ],
    },
    select: {
      id: true,
      userId: true,
      title: true,
      context: true,
      scheduledAt: true,
      snoozedUntil: true,
      status: true,
      user: { select: { email: true } },
    },
  });

  let queued = 0;
  let skipped = 0;
  let staleMarked = 0;

  for (const reminder of reminders) {
    const dueAt = reminder.status === 'SNOOZED' && reminder.snoozedUntil
      ? reminder.snoozedUntil
      : reminder.scheduledAt;

    if (dueAt.getTime() < staleCutoff.getTime()) {
      await markReminderMissed({
        reminderId: reminder.id,
        userId: reminder.userId,
        reason: 'stale',
      });
      staleMarked += 1;
      continue;
    }

    const jobId = `reminder-${reminder.id}-${dueAt.getTime()}`;
    try {
      await reminderNotificationQueue.add(
        'reminder-notification',
        {
          reminderId: reminder.id,
          userId: reminder.userId,
          userEmail: reminder.user.email,
          title: reminder.title,
          context: reminder.context ?? undefined,
        },
        { jobId },
      );
      queued += 1;
    } catch (error) {
      console.warn(`[REMINDER CRON] Skipped duplicate job ${jobId}`, error);
      skipped += 1;
    }
  }

  const processingTimeMs = Date.now() - startTime;

  console.log('[REMINDER CRON] ✅ Reminder check completed:');
  console.log(`[REMINDER CRON]   📋 Scanned: ${reminders.length}`);
  console.log(`[REMINDER CRON]   ✉️ Queued: ${queued}`);
  console.log(`[REMINDER CRON]   ⏭️ Skipped (duplicates): ${skipped}`);
  console.log(`[REMINDER CRON]   ⏰ Stale marked MISSED: ${staleMarked}`);
  console.log(`[REMINDER CRON]   ⏱️ Time: ${processingTimeMs}ms`);

  return NextResponse.json({
    success: true,
    queued,
    skipped,
    staleMarked,
    scanned: reminders.length,
    processingTimeMs,
    timestamp: now.toISOString(),
  });
}

// Handle GET requests for system status and information
export async function GET() {
  const now = new Date();

  const pendingCount = await prisma.reminder.count({
    where: {
      OR: [
        { status: 'PENDING', scheduledAt: { lte: now } },
        { status: 'SNOOZED', snoozedUntil: { lte: now } },
        { status: 'SNOOZED', snoozedUntil: null, scheduledAt: { lte: now } },
      ],
    },
  });

  return NextResponse.json({
    service: 'Reminder Notification Cron',
    status: 'active',
    configuration: {
      triggerRule: 'current_time_gte_reminder_time',
      staleThresholdHours: STALE_MS / 3600000,
    },
    pendingReminders: pendingCount,
    usage: {
      method: 'POST',
      authentication: 'Bearer token required',
      note: 'Use POST request with proper authorization to trigger reminder processing',
    },
    timestamp: now.toISOString(),
  });
}
