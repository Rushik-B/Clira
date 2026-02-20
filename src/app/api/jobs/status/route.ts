import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { allQueues } from '@/lib/services/utils/queues';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const queueName = searchParams.get('queue');

    if (!jobId || !queueName) {
      return NextResponse.json({ error: 'jobId and queue parameters are required' }, { status: 400 });
    }

    // Get the specified queue
    const queue = allQueues[queueName as keyof typeof allQueues];
    if (!queue) {
      return NextResponse.json({ error: 'Invalid queue name' }, { status: 400 });
    }

    // Get the job
    const job = await queue.getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Verify the job belongs to the current user
    if (job.data.userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized access to job' }, { status: 403 });
    }

    // Get job status
    const state = await job.getState();
    const progress = job.progress;
    const failedReason = job.failedReason;
    const returnValue = job.returnvalue;

    return NextResponse.json({
      jobId: job.id,
      state,
      progress,
      data: job.data,
      failedReason,
      returnValue,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null
    });

  } catch (error) {
    console.error('Error getting job status:', error);
    return NextResponse.json({ 
      error: 'Failed to get job status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 