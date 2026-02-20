import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { FeatureFlags } from '@/lib/services/utils/featureFlags';
import { batchSortQueue } from '@/lib/services/utils/queues';

/**
 * Sort Now API Endpoint
 * 
 * Allows users to manually trigger email sorting for their account.
 * This provides immediate feedback and testing capability for the always-on system.
 * 
 * Key Features:
 * - User-specific sorting (not bulk processing like cron)
 * - Immediate execution with real-time feedback
 * - Respects same safety measures as automated sorting
 * - Feature flag controlled access
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Check if Folder Management (which includes Sort Now) is enabled
    if (!FeatureFlags.isFolderManagementEnabled(session.user?.email)) {
      return NextResponse.json(
        { 
          error: 'Folder management features not available',
          message: 'Sort Now functionality is currently disabled'
        },
        { status: 403 }
      );
    }

    // Check if Always-On Sorting is enabled
    if (!FeatureFlags.isAlwaysOnSortingEnabled(session.user?.email)) {
      return NextResponse.json(
        { 
          error: 'Always-on sorting not available',
          message: 'Email sorting functionality is currently disabled'
        },
        { status: 403 }
      );
    }

    // Parse request body for any options
    const body = await request.json().catch(() => ({}));
    const { maxEmails = 50, daysBack = 1 } = body;

    console.log(`[SORT NOW] 🚀 User ${session.user.email} triggered manual sorting`);
    console.log(`[SORT NOW] ⚙️ Options: maxEmails=${maxEmails}, daysBack=${daysBack}`);
    // Resolve DB user id from session email
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    });
    if (!user?.id) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    const userId = user.id;

    // Enqueue sorting job for this specific user in BullMQ worker
    const job = await batchSortQueue.add(
      'user-batch-sort',
      {
        userId,
        maxEmailsPerBatch: Math.min(maxEmails, 100),
        includeSpam: false,
        includeTrash: false,
        daysBack: Math.min(daysBack, 7)
      },
      {
        jobId: `batch-sort:${userId}:${Date.now()}`
      }
    );

    const processingTimeMs = Date.now() - startTime;
    console.log(`[SORT NOW] 📥 Enqueued batch-sort job ${job.id} for ${session.user.email} in ${processingTimeMs}ms`);

    return NextResponse.json({
      success: true,
      message: 'Email sorting enqueued successfully',
      queued: true,
      jobId: job.id,
      enqueuedAt: new Date().toISOString()
    });

  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('[SORT NOW] ❌ Manual sorting failed:', error);
    console.error(`[SORT NOW] ⏱️ Failed after ${processingTimeMs}ms`);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sort emails',
        message: errorMessage,
        processingTimeMs,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// Handle GET requests for endpoint information
export async function GET() {
  const session = await getServerSession(authOptions);
  
  return NextResponse.json({
    endpoint: 'Sort Now - Manual Email Sorting',
    description: 'Trigger immediate email sorting for the authenticated user',
    authentication: 'Required - user session',
    method: 'POST',
    parameters: {
      maxEmails: 'number (optional, max 100, default 50) - Maximum emails to process',
      daysBack: 'number (optional, max 7, default 1) - Days back to fetch emails'
    },
    features: {
      folderManagement: FeatureFlags.isFolderManagementEnabled(session?.user?.email),
      alwaysOnSorting: FeatureFlags.isAlwaysOnSortingEnabled(session?.user?.email)
    },
    user: session?.user?.email || 'not authenticated',
    timestamp: new Date().toISOString()
  });
}