import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailCategorizationService } from '@/lib/services/onboarding-services/emailCategorizationService';

// In-memory lock to prevent concurrent categorization for the same user
const categorizationLocks = new Map<string, { promise: Promise<any>, startTime: number, requestId: string }>();

// Cleanup stale locks (older than 10 minutes)
const cleanupStaleLocks = () => {
  const now = Date.now();
  const staleThreshold = 10 * 60 * 1000; // 10 minutes
  
  for (const [userId, lockInfo] of categorizationLocks.entries()) {
    if (now - lockInfo.startTime > staleThreshold) {
      console.log(`[EMAIL CATEGORIZATION API] Cleaning up stale lock for user ${userId}, requestId: ${lockInfo.requestId}`);
      categorizationLocks.delete(userId);
    }
  }
};

// Run cleanup every 5 minutes
setInterval(cleanupStaleLocks, 5 * 60 * 1000);

/**
 * POST /api/onboarding/email-categorization
 * Kicks off (or rejoins) the expensive categorization worker so onboarding can
 * preview suggested folders without racing multiple concurrent jobs.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { 
      daysBack = undefined, // Remove default date constraint to fetch all emails
      maxEmails = 500, 
      minFrequency = 1
    } = body;

    const requestId = Math.random().toString(36).substring(2, 11);
    console.log(`[EMAIL CATEGORIZATION API] Starting LLM categorization for user ${user.id}: ${daysBack} days, ${maxEmails} max emails, requestId: ${requestId}`);

    // Check if there's already a categorization in progress for this user
    const existingLock = categorizationLocks.get(user.id);
    if (existingLock) {
      console.log(`[EMAIL CATEGORIZATION API] Categorization already in progress for user ${user.id}, waiting for existing request: ${existingLock.requestId}, current request: ${requestId}`);
      try {
        const existingResult = await existingLock.promise;
        return NextResponse.json(existingResult);
      } catch (error) {
        console.error(`[EMAIL CATEGORIZATION API] Existing request failed for user ${user.id}, requestId: ${existingLock.requestId}, error:`, error);
        // Continue with new request if existing one failed
        categorizationLocks.delete(user.id);
      }
    }

    // Create a new categorization promise and store it in the lock map
    const categorizationPromise = (async () => {
      try {
        console.log(`[EMAIL CATEGORIZATION API] Starting categorization execution for user ${user.id}, requestId: ${requestId}`);
        // Initialize email categorization service
        const categorizationService = new EmailCategorizationService();

        // Queue categorization job for worker processing (non-blocking)
        const jobResult = await categorizationService.queueCategorizationJob(user.id, {
          daysBack,
          maxEmails,
          minFrequency
        });

        // If cached result available, return immediately
        if (jobResult.cached) {
          const result = await categorizationService.getCategorizationResult(user.id, {
            daysBack,
            maxEmails,
            minFrequency
          });

          if (!result) {
            throw new Error('Cached result was indicated but not found');
          }

          return {
            success: true,
            cached: true,
            result: {
              categorizedEmails: result.categorizedEmails,
              folderSuggestions: result.folderSuggestions,
              totalEmailsAnalyzed: result.totalEmailsAnalyzed,
              categorizationTimeMs: result.categorizationTimeMs
            }
          };
        }

        // For new jobs, we need to wait for completion or return job ID
        // Since this is onboarding, we'll wait for completion with timeout
        const MAX_WAIT_TIME = 180000; // 180 seconds (3 minutes) for LLM processing
        const POLL_INTERVAL = 2000; // 2 seconds
        let waitTime = 0;
        
        while (waitTime < MAX_WAIT_TIME) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
          waitTime += POLL_INTERVAL;

          const status = await categorizationService.getJobStatus(jobResult.jobId);
          
          if (status.status === 'completed') {
            // Get the full result directly from the worker job (includes email examples)
            const workerResult = status.result;

            if (!workerResult) {
              throw new Error('Job completed but no result returned from worker');
            }

            return {
              success: true,
              cached: false,
              result: {
                categorizedEmails: workerResult.categorizedEmails,
                folderSuggestions: workerResult.folderSuggestions,
                totalEmailsAnalyzed: workerResult.totalEmailsAnalyzed,
                categorizationTimeMs: workerResult.categorizationTimeMs
              }
            };
          } else if (status.status === 'failed') {
            throw new Error(`Categorization job failed: ${status.error}`);
          }
        }

        // Timeout - return job ID for client to poll
        return {
          success: false,
          timeout: true,
          jobId: jobResult.jobId,
          message: 'Categorization is taking longer than expected. Please check status.',
          estimatedTime: 'This usually takes 30-60 seconds'
        };
      } finally {
        // Clean up the lock when done
        console.log(`[EMAIL CATEGORIZATION API] Cleaning up categorization lock for user ${user.id}, requestId: ${requestId}`);
        categorizationLocks.delete(user.id);
      }
    })();

    // Store the promise with metadata in the lock map
    categorizationLocks.set(user.id, {
      promise: categorizationPromise,
      startTime: Date.now(),
      requestId
    });

    // Wait for the categorization to complete
    const lockInfo = categorizationLocks.get(user.id);
    const result = await lockInfo!.promise;
    return NextResponse.json(result);

  } catch (error) {
    console.error('[EMAIL CATEGORIZATION API] Error categorizing emails:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to categorize emails',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * GET /api/onboarding/email-categorization
 * Returns the cached categorization snapshot, falling back to the in-flight job
 * so the client always sees the latest onboarding analysis.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const requestId = Math.random().toString(36).substring(2, 11);
    console.log(`[EMAIL CATEGORIZATION API] Generating categorization data for user ${user.id}, requestId: ${requestId}`);

    // Check if there's already a categorization in progress for this user
    const existingLock = categorizationLocks.get(user.id);
    if (existingLock) {
      console.log(`[EMAIL CATEGORIZATION API] Categorization already in progress for user ${user.id}, waiting for existing request: ${existingLock.requestId}, current request: ${requestId}`);
      try {
        const existingResult = await existingLock.promise;
        return NextResponse.json(existingResult);
      } catch (error) {
        console.error(`[EMAIL CATEGORIZATION API] Existing request failed for user ${user.id}, requestId: ${existingLock.requestId}, error:`, error);
        // Continue with new request if existing one failed
        categorizationLocks.delete(user.id);
      }
    }

    // Create a new categorization promise and store it in the lock map
    const categorizationPromise = (async () => {
      try {
        console.log(`[EMAIL CATEGORIZATION API] Starting categorization execution for user ${user.id}, requestId: ${requestId}`);
        const categorizationService = new EmailCategorizationService();
        
        // Get cached categorization result or queue new job
        const jobResult = await categorizationService.queueCategorizationJob(user.id, {
          maxEmails: 500,
          minFrequency: 1
        });

        let categorizationResult;

        if (jobResult.cached) {
          categorizationResult = await categorizationService.getCategorizationResult(user.id, {
            maxEmails: 500,
            minFrequency: 1
          });

          if (!categorizationResult) {
            throw new Error('Cached result was indicated but not found');
          }
        } else {
          // Wait for worker job completion with polling
          const MAX_WAIT_TIME = 180000; // 180 seconds (3 minutes) for LLM processing
          const POLL_INTERVAL = 2000; // 2 seconds
          let waitTime = 0;
          
          while (waitTime < MAX_WAIT_TIME) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            waitTime += POLL_INTERVAL;

            const status = await categorizationService.getJobStatus(jobResult.jobId);
            
            if (status.status === 'completed') {
              // Get the full result directly from the worker job (includes email examples)
              categorizationResult = status.result;

              if (!categorizationResult) {
                throw new Error('Job completed but no result returned from worker');
              }
              break;
            } else if (status.status === 'failed') {
              throw new Error(`Categorization job failed: ${status.error}`);
            }
          }

          if (!categorizationResult) {
            throw new Error('Categorization timeout - job is still processing');
          }
        }

        // Transform categorization results into frontend-friendly format
        const analysisData = transformToAnalysisData(categorizationResult);

        console.log(`[EMAIL CATEGORIZATION API] Generated categorization data: ${analysisData.totalEmails} emails analyzed`);

        const result = {
          success: true,
          // Original detailed result expected by frontend components
          result: {
            categorizedEmails: categorizationResult.categorizedEmails,
            folderSuggestions: categorizationResult.folderSuggestions,
            totalEmailsAnalyzed: categorizationResult.totalEmailsAnalyzed,
            categorizationTimeMs: categorizationResult.categorizationTimeMs
          },
          // Additional high-level analysis already computed (kept for analytics/future)
          analysisData,
          rawCategorizationData: {
            totalEmailsAnalyzed: categorizationResult.totalEmailsAnalyzed,
            categorizedEmailsCount: categorizationResult.categorizedEmails.length,
            folderSuggestionsCount: categorizationResult.folderSuggestions.length,
            categorizationTimeMs: categorizationResult.categorizationTimeMs
          }
        };

        return result;
      } finally {
        // Clean up the lock when done
        console.log(`[EMAIL CATEGORIZATION API] Cleaning up categorization lock for user ${user.id}, requestId: ${requestId}`);
        categorizationLocks.delete(user.id);
      }
    })();

    // Store the promise with metadata in the lock map
    categorizationLocks.set(user.id, {
      promise: categorizationPromise,
      startTime: Date.now(),
      requestId
    });

    // Wait for the categorization to complete
    const lockInfo = categorizationLocks.get(user.id);
    const result = await lockInfo!.promise;
    return NextResponse.json(result);

  } catch (error) {
    console.error('[EMAIL CATEGORIZATION API] Error getting email categorization:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to categorize emails',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Helper function to transform categorization results into frontend-friendly format
function transformToAnalysisData(categorizationResult: any) {
  const { categorizedEmails, folderSuggestions, totalEmailsAnalyzed } = categorizationResult;
  
  // Calculate category percentages based on email frequency
  const categoryCounts: Record<string, number> = {};
  const categorySources: Record<string, string[]> = {};

  // Initialize categories
  for (const folder of folderSuggestions) {
    categoryCounts[folder.name.toLowerCase()] = 0;
    categorySources[folder.name.toLowerCase()] = [];
  }

  // Count emails per category
  for (const email of categorizedEmails) {
    // Skip emails without a suggested folder (null/undefined)
    if (!email.suggestedFolder) {
      continue;
    }
    
    const categoryKey = email.suggestedFolder.toLowerCase();
    if (categoryCounts[categoryKey] !== undefined) {
      categoryCounts[categoryKey] += email.frequency;
      
      // Add sender to top sources if not already included
      const senderName = email.senderName || email.emailAddress.split('@')[0];
      if (categorySources[categoryKey].length < 4 && !categorySources[categoryKey].includes(senderName)) {
        categorySources[categoryKey].push(senderName);
      }
    }
  }

  // Calculate total for percentage calculation
  const totalCategorizedEmails = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0);
  
  // Top contacts (high frequency senders)
  const topContacts = categorizedEmails
    .filter((email: any) => email.frequency >= 3)
    .sort((a: any, b: any) => b.frequency - a.frequency)
    .slice(0, 5)
    .map((email: any) => email.senderName || email.emailAddress.split('@')[0]);

  // Build categories object
  const categories: Record<string, { percentage: number; topSources: string[] }> = {};
  
  for (const folder of folderSuggestions) {
    const categoryKey = folder.name.toLowerCase();
    const count = categoryCounts[categoryKey] || 0;
    const percentage = totalCategorizedEmails > 0 ? Math.round((count / totalCategorizedEmails) * 100) : 0;
    
    categories[categoryKey] = {
      percentage,
      topSources: categorySources[categoryKey] || []
    };
  }

  return {
    totalEmails: totalEmailsAnalyzed,
    categories,
    topContacts: topContacts.length > 0 ? topContacts : ['No frequent contacts found'],
    folderSuggestions: folderSuggestions,
    categorizedEmails: categorizedEmails
  };
} 
