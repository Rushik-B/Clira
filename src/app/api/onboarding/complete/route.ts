import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { emailQueue } from '@/lib/services/utils/queues';
import { enqueueSupermemoryBootstrap } from '@/lib/services/supermemory/queueHelpers';
import { enqueueInboxBackfillForConnectedMailboxes } from '@/lib/services/inbox-search';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { step, corrections, stats } = body;
    const reviewedFolders = body.reviewedFolders || body.data?.reviewedFolders || null;

    console.log(`🎉 Marking onboarding complete for user ${session.userId} at step: ${step}`);

    // Update the user to mark folder onboarding as complete
    // DO NOT set prompt flags here - they should only be set when prompts are actually generated
    await prisma.user.update({
      where: { id: session.userId },
      data: { 
        labelingOnboardingGenerated: true,
        labelingOnboardingQualityGenerated: true
      }
    });

    // If the step is 'detailed_inbox_review', trigger a background job to create Gmail labels
    if (step === 'detailed_inbox_review' && reviewedFolders) {
      console.log(`📥 Triggering background job to create Gmail labels for user ${session.userId}`);
      // Deduplicate concurrent enqueues by using a fixed jobId per user
      const jobId = `create-gmail-labels-${session.userId}`;
      try {
        const existing = await emailQueue.getJob(jobId);
        if (existing && !existing.finishedOn) {
          console.log(`⏭️  Skipping enqueue: job ${jobId} already ${existing.processedOn ? 'active' : 'queued'}`);
        } else {
          await emailQueue.add(
            'create-gmail-labels',
            { userId: session.userId, folders: reviewedFolders },
            { jobId, removeOnComplete: 10, removeOnFail: 5 }
          );
          console.log(`✅ Job queued successfully as ${jobId}`);
        }
      } catch (e) {
        console.warn(`⚠️ Could not check existing job for ${jobId}, enqueueing anyway`);
        await emailQueue.add(
          'create-gmail-labels',
          { userId: session.userId, folders: reviewedFolders },
          { jobId, removeOnComplete: 10, removeOnFail: 5 }
        );
        console.log(`✅ Job queued (fallback) as ${jobId}`);
      }
    } else {
      console.log(`⚠️ Not triggering Gmail labels job: step=${step}, hasFolders=${!!reviewedFolders}`);
    }

    try {
      const backfillEnqueue = await enqueueInboxBackfillForConnectedMailboxes(session.userId as string);
      console.log(
        `📚 Inbox backfill enqueue result for user ${session.userId}: ` +
        `${backfillEnqueue.enqueuedCount} mailbox job(s)` +
        (backfillEnqueue.skippedReason ? `, skippedReason=${backfillEnqueue.skippedReason}` : ''),
      );
    } catch (error) {
      console.warn(
        `⚠️ Failed to enqueue inbox backfill for user ${session.userId}:`,
        error,
      );
    }

    // Always enqueue Supermemory bootstrap once onboarding completes.
    // This is safe even if already enqueued elsewhere (queue helper dedupes per user).
    try {
      const supermemoryJobId = await enqueueSupermemoryBootstrap(session.userId as string, {
        delayMs: 90_000,
      });

      if (supermemoryJobId) {
        console.log(
          `🧠 Enqueued Supermemory bootstrap job ${supermemoryJobId} for user ${session.userId} (starts in 90s)`,
        );
      } else {
        console.log(
          `⚠️ Supermemory bootstrap not enqueued for user ${session.userId} (missing SUPERMEMORY_API_KEY)`,
        );
      }
    } catch (error) {
      console.warn(
        `⚠️ Failed to enqueue Supermemory bootstrap for user ${session.userId}:`,
        error,
      );
    }

    console.log(`✅ Onboarding completed for user ${session.userId}`);

    return NextResponse.json({
      success: true,
      message: 'Onboarding marked as complete',
      data: {
        step,
        corrections: corrections || 0,
        stats: stats || {}
      }
    });

  } catch (error) {
    console.error('Error marking onboarding complete:', error);
    return NextResponse.json({ 
      error: 'Failed to mark onboarding complete' 
    }, { status: 500 });
  }
}
