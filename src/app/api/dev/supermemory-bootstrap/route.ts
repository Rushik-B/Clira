/**
 * DEV Endpoint: Supermemory Bootstrap
 *
 * Manual trigger for testing the Supermemory memory bootstrap process.
 * Per SUPERMEMORY.md Section 5, Step 0:
 * - Dev enqueue + status route with dryRun to iterate quickly without burning Supermemory tokens
 *
 * Endpoints:
 * - POST: Enqueue a bootstrap job
 * - GET: Get job status
 *
 * Auth: Uses dev-test-user if no session (per workspace rules).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import {
  enqueueSupermemoryBootstrap,
  getBootstrapJobStatus,
  isSupermemoryConfigured,
} from '@/lib/services/supermemory';
import { prisma } from '@/lib/prisma';
import { devOnlyGuard } from '@/lib/utils/devOnly';

const DEV_USER_ID = 'dev-test-user';

async function getEffectiveUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);

  if (session?.userId) {
    return session.userId as string;
  }

  // Auth bypass for dev
  if (process.env.NODE_ENV === 'development') {
    const devUser = await prisma.user.findFirst({
      where: { email: { contains: 'test' } },
      select: { id: true },
    });
    return devUser?.id ?? DEV_USER_ID;
  }

  return null;
}

/**
 * POST - Enqueue a Supermemory bootstrap job
 *
 * Body:
 * - maxSentEmails?: number (default: 250)
 * - budgetTokens?: number (default: 100000)
 * - dryRun?: boolean (default: true in dev)
 * - delayMs?: number (default: 0 for immediate)
 */
export async function POST(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const userId = await getEffectiveUserId();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if Supermemory is configured
    const configured = isSupermemoryConfigured();
    if (!configured) {
      return NextResponse.json(
        {
          error: 'Supermemory not configured',
          message: 'Set SUPERMEMORY_API_KEY environment variable to enable Supermemory integration',
        },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({}));

    const options = {
      maxSentEmails: body.maxSentEmails ?? 250,
      budgetTokens: body.budgetTokens ?? 100_000,
      dryRun: body.dryRun ?? (process.env.NODE_ENV === 'development'), // Default to dryRun in dev
      delayMs: body.delayMs ?? 0, // Immediate for manual trigger
    };

    console.log(`[DEV] Enqueuing Supermemory bootstrap for user ${userId}:`, options);

    const jobId = await enqueueSupermemoryBootstrap(userId, options);

    return NextResponse.json({
      success: true,
      jobId,
      userId,
      options,
      message: options.dryRun
        ? 'Job enqueued in DRY RUN mode (no Supermemory uploads)'
        : 'Job enqueued - will upload to Supermemory',
    });
  } catch (error) {
    console.error('[DEV] Failed to enqueue Supermemory bootstrap:', error);
    return NextResponse.json(
      { error: 'Failed to enqueue job', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET - Get status of a user's bootstrap job
 */
export async function GET() {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const userId = await getEffectiveUserId();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const configured = isSupermemoryConfigured();
    const status = await getBootstrapJobStatus(userId);

    return NextResponse.json({
      userId,
      supermemoryConfigured: configured,
      job: status,
    });
  } catch (error) {
    console.error('[DEV] Failed to get Supermemory bootstrap status:', error);
    return NextResponse.json(
      { error: 'Failed to get job status', details: String(error) },
      { status: 500 },
    );
  }
}
