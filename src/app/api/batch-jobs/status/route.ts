import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

interface BatchJobStatus {
  hasRunningJob: boolean;
  runningJob?: {
    id: string;
    status: string;
    startedAt: Date;
    emailsProcessed: number;
    emailsSorted: number;
    emailsToReview: number;
  };
  recentJobs: Array<{
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    emailsProcessed: number;
    emailsSorted: number;
    emailsToReview: number;
    errorMessage: string | null;
  }>;
  canModifyFolders: boolean;
  recommendation: string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🔍 Checking batch job status for user ${session.userId}`);

    // Check for running batch jobs and clean up stale ones
    let runningJob = await prisma.batchSortJob.findFirst({
      where: {
        userId: session.userId,
        status: 'running'
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        emailsProcessed: true,
        emailsSorted: true,
        emailsToReview: true
      }
    });

    // Clean up stale running jobs (older than 15 minutes)
    if (runningJob && runningJob.startedAt < new Date(Date.now() - 15 * 60 * 1000)) {
      console.log(`🔍 Cleaning up stale running job ${runningJob.id} for user ${session.userId}`);
      await prisma.batchSortJob.update({
        where: { id: runningJob.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: 'Job marked as failed due to timeout (stale cleanup)'
        }
      });
      // Clear the running job reference since we just marked it as failed
      runningJob = null;
    }

    // Get recent job history
    const recentJobs = await prisma.batchSortJob.findMany({
      where: {
        userId: session.userId
      },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        emailsProcessed: true,
        emailsSorted: true,
        emailsToReview: true,
        errorMessage: true
      }
    });

    const hasRunningJob = !!runningJob;
    const canModifyFolders = !hasRunningJob;

    // Generate recommendation
    let recommendation = '';
    if (hasRunningJob) {
      recommendation = '⚠️ Email processing is currently in progress. Please wait for completion before making folder changes to avoid conflicts.';
    } else if (recentJobs.length > 0) {
      const lastJob = recentJobs[0];
      const timeSinceLastJob = Date.now() - lastJob.startedAt.getTime();
      const minutesAgo = Math.floor(timeSinceLastJob / (1000 * 60));
      
      if (minutesAgo < 30) {
        recommendation = '✅ No active processing. Safe to modify folders. Recent job completed successfully.';
      } else {
        recommendation = '✅ No active processing. Safe to modify folders.';
      }
    } else {
      recommendation = '✅ No batch processing history found. Safe to modify folders.';
    }

    const response: BatchJobStatus = {
      hasRunningJob,
      runningJob: runningJob ? {
        id: runningJob.id,
        status: runningJob.status,
        startedAt: runningJob.startedAt,
        emailsProcessed: runningJob.emailsProcessed,
        emailsSorted: runningJob.emailsSorted,
        emailsToReview: runningJob.emailsToReview
      } : undefined,
      recentJobs: recentJobs.map(job => ({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        emailsProcessed: job.emailsProcessed,
        emailsSorted: job.emailsSorted,
        emailsToReview: job.emailsToReview,
        errorMessage: job.errorMessage
      })),
      canModifyFolders,
      recommendation
    };

    console.log(`🔍 Batch job status: ${hasRunningJob ? 'Running' : 'None'}, can modify: ${canModifyFolders}`);

    return NextResponse.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('Error checking batch job status:', error);
    return NextResponse.json({ 
      error: 'Failed to check batch job status' 
    }, { status: 500 });
  }
}