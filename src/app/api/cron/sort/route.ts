import { NextResponse } from 'next/server';
import { batchSortQueue } from '@/lib/services/utils/queues';
import { FeatureFlags } from '@/lib/services/utils/featureFlags';

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Always-On Email Sorting Cron Endpoint
 * 
 * This endpoint powers the persistent email sorting system that runs every 2 hours
 * to continuously organize emails for onboarded users. It uses the same logic and 
 * safety measures as the onboarding system but runs persistently.
 * 
 * Key Features:
 * - Uses existing BatchSortingWorker with comprehensive safety checks
 * - Respects feature flags for controlled rollout
 * - Includes full observability and error handling
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  
  try {
    if (!CRON_SECRET) {
      console.error('[ALWAYS-ON CRON] ❌ CRON_SECRET is not configured');
      return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
    }

    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      console.warn('[ALWAYS-ON CRON] ⚠️ Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if Always-On Sorting is enabled globally
    if (!FeatureFlags.isAlwaysOnSortingEnabled()) {
      console.log('[ALWAYS-ON CRON] ⏹️ Always-on sorting disabled via feature flag');
      return NextResponse.json({ 
        success: true, 
        message: 'Always-on sorting disabled via feature flag',
        skipped: true,
        timestamp: new Date().toISOString()
      });
    }

    // Validate configuration
    const configValidation = FeatureFlags.validateConfiguration();
    if (!configValidation.valid) {
      console.error('[ALWAYS-ON CRON] ❌ Invalid configuration:', configValidation.errors);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid configuration',
          details: configValidation.errors,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      );
    }

    // Log configuration for this run
    const config = FeatureFlags.getAlwaysOnSortingConfig();
    console.log('[ALWAYS-ON CRON] 🚀 Starting persistent email sorting job...');
    console.log('[ALWAYS-ON CRON] ⚙️ Configuration:', {
      maxBatchSize: config.maxBatchSize,
      confidenceThreshold: config.confidenceThreshold,
      tokenBudget: config.tokenBudgetPerRun
    });

    // Enqueue jobs for all eligible users; workers will process them
    const { prisma } = await import('@/lib/prisma');
    const eligibleUsers = await prisma.user.findMany({
      where: {
        labelingOnboardingGenerated: true,
        settings: {
          autoSortingEnabled: true
        },
        batchSortJobs: {
          none: {
            startedAt: { gte: new Date(Date.now() - 90 * 60 * 1000) }
          }
        }
      },
      select: { id: true, email: true }
    });

    let processed = 0;
    const errors: string[] = [];

    for (const user of eligibleUsers) {
      try {
        await batchSortQueue.add(
          'user-batch-sort',
          {
            userId: user.id,
            maxEmailsPerBatch: config.maxBatchSize,
            includeSpam: false,
            includeTrash: false,
            daysBack: 1
          },
          { jobId: `batch-sort:${user.id}:${Date.now()}` }
        );
        processed++;
      } catch (e: any) {
        const msg = `Failed to enqueue batch-sort for ${user.email}: ${e?.message || e}`;
        console.warn('[ALWAYS-ON CRON]', msg);
        errors.push(msg);
      }
    }

    const processingTimeMs = Date.now() - startTime;
    
    // Comprehensive success logging
    console.log('[ALWAYS-ON CRON] ✅ Persistent sorting completed successfully:');
    console.log(`[ALWAYS-ON CRON]   👥 Users enqueued: ${processed}`);
    console.log(`[ALWAYS-ON CRON]   ❌ Enqueue errors: ${errors.length}`);
    console.log(`[ALWAYS-ON CRON]   ⏱️ Total time: ${processingTimeMs}ms`);
    console.log(`[ALWAYS-ON CRON]   📊 Success rate: ${processed > 0 ? Math.round(((processed - errors.length) / processed) * 100) : 100}%`);

    return NextResponse.json({ 
      success: true, 
      message: 'Always-on email sorting completed successfully',
      stats: {
        usersProcessed: processed,
        errors: errors.length,
        processingTimeMs,
        successRate: processed > 0 ? Math.round(((processed - errors.length) / processed) * 100) : 100
      },
      errors,
      config: {
        maxBatchSize: config.maxBatchSize,
        confidenceThreshold: config.confidenceThreshold
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('[ALWAYS-ON CRON] ❌ Fatal error in persistent sorting:', error);
    console.error(`[ALWAYS-ON CRON] ⏱️ Failed after ${processingTimeMs}ms`);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to run always-on email sorting',
        message: errorMessage,
        processingTimeMs,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// Handle GET requests for system status and information
export async function GET() {
  const isEnabled = FeatureFlags.isAlwaysOnSortingEnabled();
  const config = FeatureFlags.getAlwaysOnSortingConfig();
  const configValidation = FeatureFlags.validateConfiguration();
  
  return NextResponse.json({ 
    service: 'Always-On Email Sorting',
    status: isEnabled ? 'enabled' : 'disabled',
    configuration: {
      cronSchedule: config.cronSchedule,
      maxBatchSize: config.maxBatchSize,
      confidenceThreshold: config.confidenceThreshold,
      tokenBudgetPerRun: config.tokenBudgetPerRun
    },
    configurationValid: configValidation.valid,
    configurationErrors: configValidation.errors,
    usage: {
      method: 'POST',
      authentication: 'Bearer token required',
      note: 'Use POST request with proper authorization to trigger sorting'
    },
    features: FeatureFlags.getAllFlags(),
    timestamp: new Date().toISOString()
  });
}
