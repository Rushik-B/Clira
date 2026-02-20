import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailCategorizationService } from '@/lib/services/onboarding-services/emailCategorizationService';
import { onboardingQueue } from '@/lib/services/utils/queues';
import redisConnection from '@/lib/services/utils/redis';
import { devOnlyGuard } from '@/lib/utils/devOnly';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, email: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userId = user.id;
    const testResults = {
      userId,
      email: user.email,
      timestamp: new Date().toISOString(),
      tests: {} as any
    };

    logger.debug(`Checking for duplicate onboarding jobs for user ${userId}`);
    const existingOnboardingJobs = await onboardingQueue.getJobs(['waiting', 'active', 'delayed']);
    const userOnboardingJobs = existingOnboardingJobs.filter(job => job.data.userId === userId);
    testResults.tests.duplicateOnboardingJobs = {
      totalJobs: userOnboardingJobs.length,
      jobIds: userOnboardingJobs.map(job => job.id),
      hasDuplicates: userOnboardingJobs.length > 1,
      status: userOnboardingJobs.length > 1 ? 'FAILED' : 'PASSED'
    };

    logger.debug(`Checking for duplicate email categorization jobs for user ${userId}`);
    const emailCategorizationService = new EmailCategorizationService();
    const jobResult = await emailCategorizationService.queueCategorizationJob(userId, {
      maxEmails: 500,
      minFrequency: 1
    });
    
    // Check if job was actually queued or returned cached
    const existingCategorizationJobs = await emailCategorizationService.getJobStatus(jobResult.jobId);
    testResults.tests.emailCategorizationJobs = {
      jobId: jobResult.jobId,
      wasCached: jobResult.cached || false,
      jobStatus: existingCategorizationJobs.status,
      hasEmailExamples: 'pending' // Will be checked when job completes
    };

    logger.debug(`Checking Redis locks for user ${userId}`);
    const onboardingLockKey = `onboarding-lock:${userId}`;
    const categorizationLockKey = `email-categorization-lock:${userId}`;
    const onboardingLockExists = await redisConnection.exists(onboardingLockKey);
    const categorizationLockExists = await redisConnection.exists(categorizationLockKey);
    
    testResults.tests.redisLocks = {
      onboardingLockExists: onboardingLockExists === 1,
      categorizationLockExists: categorizationLockExists === 1,
      status: (onboardingLockExists || categorizationLockExists) ? 'ACTIVE' : 'CLEAR'
    };

    logger.debug(`Checking cache state for user ${userId}`);
    const cacheKey = `${userId}_500_1`;
    const cachedResult = await emailCategorizationService.getCategorizationResult(userId, {
      maxEmails: 500,
      minFrequency: 1
    });
    
    testResults.tests.cacheState = {
      hasCachedResult: !!cachedResult,
      hasEmailExamples: cachedResult ? 
        (cachedResult.categorizedEmails?.[0]?.sampleBodies?.length > 0) : false,
      status: cachedResult ? 'CACHED' : 'NO_CACHE'
    };

    logger.debug(`Checking user completion status for user ${userId}`);
    const userStatus = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        masterPromptGenerated: true,
        labelingOnboardingGenerated: true
      }
    });
    
    testResults.tests.userStatus = {
      masterPromptGenerated: userStatus?.masterPromptGenerated || false,
      labelingOnboardingGenerated: userStatus?.labelingOnboardingGenerated || false,
      isComplete: !!(userStatus?.masterPromptGenerated && userStatus?.labelingOnboardingGenerated)
    };

    logger.debug(`Test results for user ${userId}:`, testResults);

    return NextResponse.json({
      success: true,
      message: 'Fix verification tests completed',
      results: testResults
    });

  } catch (error) {
    logger.error('Error running fix verification tests:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to run tests',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 