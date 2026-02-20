/**
 * Supermemory Bootstrap Test Endpoint
 *
 * Test harness for validating the Supermemory bootstrap process without calling the API.
 * Returns detailed JSON output including all generated summaries and profile.
 *
 * Usage:
 * GET  /api/dev/supermemory-test - Get current status or run default test
 * POST /api/dev/supermemory-test - Run test with custom config
 *
 * Example:
 * ```bash
 * # Run with defaults (50 emails, 10k budget)
 * curl http://localhost:3000/api/dev/supermemory-test
 *
 * # Run with custom config
 * curl -X POST http://localhost:3000/api/dev/supermemory-test \
 *   -H "Content-Type: application/json" \
 *   -d '{"maxSentEmails": 100, "budgetTokens": 20000, "userId": "user-123"}'
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { runSupermemoryBootstrap } from '@/lib/services/supermemory';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { devOnlyGuard } from '@/lib/utils/devOnly';

// Test defaults (smaller scope for testing)
const TEST_DEFAULTS = {
  maxSentEmails: 50,
  budgetTokens: 10_000,
  dryRun: true,
  includeGeneratedContent: true,
};

const DEV_USER_ID = 'dev-test-user';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Get the effective user ID - uses session first, then dev fallback
 */
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
 * POST - Run bootstrap test with custom config
 */
export async function POST(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const body = await request.json();

    // Get effective userId from session or dev fallback
    const effectiveUserId = await getEffectiveUserId();
    if (!effectiveUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - no session found' },
        { status: 401 },
      );
    }

    const {
      userId = effectiveUserId,
      maxSentEmails = TEST_DEFAULTS.maxSentEmails,
      budgetTokens = TEST_DEFAULTS.budgetTokens,
    } = body;

    logger.info(`[SupermemoryTest] Starting test run for user ${userId}`);

    const result = await runSupermemoryBootstrap({
      userId,
      maxSentEmails,
      budgetTokens,
      dryRun: true,
      includeGeneratedContent: true,
    });

    logger.info(
      `[SupermemoryTest] Test complete: ${result.threadsProcessed} threads, ${result.estimatedTokensUsed} tokens`,
    );

    return NextResponse.json(
      {
        success: true,
        test: true,
        result,
        instructions: {
          message: 'Test run completed successfully',
          whatHappened: [
            `Processed ${result.threadsProcessed} email threads`,
            `Generated ${result.generatedContent?.episodes.length || 0} episode summaries`,
            `Generated user profile: ${result.generatedContent?.profile ? 'Yes' : 'No'}`,
            `Estimated ${result.estimatedTokensUsed} tokens would be used`,
            `Thread fetch: ${result.generatedContent?.threadFetchStats.success || 0} success, ${result.generatedContent?.threadFetchStats.empty || 0} empty, ${result.generatedContent?.threadFetchStats.failed || 0} failed`,
          ],
          nextSteps: [
            'Review the generated content in result.generatedContent',
            'Check episode summaries for quality and accuracy',
            'Verify user profile extraction makes sense',
            'When ready, set dryRun=false to actually call Supermemory API',
          ],
        },
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('[SupermemoryTest] Test failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}

/**
 * GET - Run test with defaults
 */
export async function GET() {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    // Get effective userId from session or dev fallback
    const effectiveUserId = await getEffectiveUserId();
    if (!effectiveUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - no session found' },
        { status: 401 },
      );
    }

    logger.info(`[SupermemoryTest] Running default test for user ${effectiveUserId}`);

    const result = await runSupermemoryBootstrap({
      userId: effectiveUserId,
      ...TEST_DEFAULTS,
    });

    return NextResponse.json(
      {
        success: true,
        test: true,
        result,
        config: TEST_DEFAULTS,
        instructions: {
          message: 'Test run completed with default config',
          whatHappened: [
            `Fetched up to ${TEST_DEFAULTS.maxSentEmails} sent emails`,
            `Processed ${result.threadsProcessed} unique threads`,
            `Generated ${result.generatedContent?.episodes.length || 0} episode summaries`,
            `Generated user profile: ${result.generatedContent?.profile ? 'Yes' : 'No'}`,
            `Token budget: ${result.estimatedTokensUsed}/${TEST_DEFAULTS.budgetTokens}`,
            `Duration: ${result.durationMs}ms`,
          ],
          viewResults: 'Open /dev/supermemory-test in your browser for a visual UI',
          api: {
            customTest: 'POST /api/dev/supermemory-test with JSON body',
            example: {
              userId: 'user-id',
              maxSentEmails: 100,
              budgetTokens: 20000,
            },
          },
        },
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('[SupermemoryTest] Default test failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
