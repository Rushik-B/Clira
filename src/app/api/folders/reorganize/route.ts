import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { batchSortQueue } from '@/lib/services/utils/queues';
import { BatchSortingWorker } from '@/lib/services/batch/batchSortingWorker';

const ReorganizeFoldersSchema = z.object({
  newFolderId: z.string().min(1),
  newFolderInstruction: z.string().trim().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = ReorganizeFoldersSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { newFolderId } = parsed.data;

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log(`[REORGANIZE API] Starting email reorganization for user ${user.email}, new folder: ${newFolderId}`);

    const folder = await prisma.label.findFirst({
      where: {
        id: newFolderId,
        userId: user.id,
        isSystemLabel: false,
      },
      select: {
        id: true,
        name: true,
        mailboxId: true,
      },
    });

    if (!folder) {
      return NextResponse.json(
        {
          success: false,
          error: 'Folder not found',
        },
        { status: 404 },
      );
    }

    const batchSorter = new BatchSortingWorker();
    const eligibility = await batchSorter.isUserEligible(user.id);
    if (!eligibility.eligible) {
      return NextResponse.json(
        {
          success: false,
          error: eligibility.reason || 'Automatic reorganization is not available right now',
        },
        { status: 409 },
      );
    }

    const job = await batchSortQueue.add(
      'user-batch-sort',
      {
        userId: user.id,
        maxEmailsPerBatch: 100,
        includeSpam: false,
        includeTrash: false,
        daysBack: 7,
      },
      {
        jobId: `folder-reorganize:${user.id}:${folder.id}:${Date.now()}`,
      },
    );

    console.log(
      `[REORGANIZE API] Enqueued batch-sort job ${job.id} for user ${user.email} after creating/updating folder ${folder.name}`,
    );

    return NextResponse.json({
      success: true,
      queued: true,
      jobId: job.id,
      folderId: folder.id,
      message: `Queued background reorganization for ${folder.name}.`,
    });

  } catch (error) {
    console.error('[REORGANIZE API] Error during reorganization:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to reorganize emails',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}