// Email Categorization Service - Now uses worker-based processing
import { prisma } from '../../prisma';
import { emailCategorizationQueue } from '../utils/queues';
import redisConnection, { safeRedisOperation } from '../utils/redis';
import { getJobStatus } from './utils/queueStatus';
import {
  ExtractedEmailAddress,
  EmailCategorizationResult,
  EmailCategorizationOptions,
  JobStatus
} from './types';

/**
 * Email Categorization Service - Uses worker-based processing for LLM categorization
 * 
 * This service now triggers background jobs for heavy processing:
 * 1. Queue email categorization jobs
 * 2. Check job status and retrieve results
 * 3. Provide cached results for fast response
 * 
 * All heavy LLM work is moved to worker processes
 */
export class EmailCategorizationService {
  
  // In-memory cache to prevent duplicate jobs
  // In-memory cache (per-process) – still useful as a fallback but not shared between API & worker
  private static categorizationCache = new Map<string, {
    result: EmailCategorizationResult;
    timestamp: number;
  }>();
  
  // Cache TTL: 5 minutes
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes per-process cache
  private static readonly REDIS_TTL_SEC = 30 * 60; // 30 minutes shared cache
  
  /**
   * Clean up expired cache entries to prevent memory leaks
   */
  private static cleanupExpiredCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, value] of EmailCategorizationService.categorizationCache.entries()) {
      if (now - value.timestamp > EmailCategorizationService.CACHE_TTL) {
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => {
      EmailCategorizationService.categorizationCache.delete(key);
    });
    
    if (expiredKeys.length > 0) {
      console.log(`[EMAIL CATEGORIZATION] Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }
  
  constructor() {
    // Service is ready for worker-based processing
  }

  /**
   * Queue email categorization job and return job ID for status tracking
   */
  async queueCategorizationJob(userId: string, options: EmailCategorizationOptions = {}): Promise<{ jobId: string; cached?: boolean }> {
    const {
      maxEmails = 500,
      minFrequency = 1,
      daysBack = undefined // Remove default date constraint to fetch all emails
    } = options;

    console.log(`[EMAIL CATEGORIZATION] Queueing categorization job for user ${userId}: ${maxEmails} max emails, ${minFrequency} min frequency`);

    // Check in-memory cache first (has full results with email examples)
    const cacheKey = `${userId}_${maxEmails}_${minFrequency}`;
    const cachedInMemory = EmailCategorizationService.categorizationCache.get(cacheKey);
    if (cachedInMemory && (Date.now() - cachedInMemory.timestamp) < EmailCategorizationService.CACHE_TTL) {
      console.log(`[EMAIL CATEGORIZATION] Returning fresh in-memory cached result with email examples for user ${userId}`);
      return { jobId: 'cached', cached: true };
    }

    // Check Redis shared cache first
    const redisKey = `email_cat_full:${userId}`;
    const redisCachedRaw = await safeRedisOperation(() => redisConnection.get(redisKey), null, 'get categorization from Redis');
    if (redisCachedRaw) {
      try {
        const redisCached: EmailCategorizationResult = JSON.parse(redisCachedRaw);
        console.log(`[EMAIL CATEGORIZATION] Returning Redis cached result with email examples for user ${userId}`);
        return { jobId: 'cached', cached: true };
      } catch (err) {
        console.warn('[EMAIL CATEGORIZATION] Failed to parse Redis cached result, ignoring');
      }
    }

    // Check database cache (has metadata only, no email content for privacy)
    const cachedResult = await this.getCachedCategorizationResult(userId);
    if (cachedResult) {
      console.log(`[EMAIL CATEGORIZATION] Found cached metadata in database for user ${userId}`);
      
      // For onboarding flow, we ALWAYS need fresh data with email examples
      // Database cache only has metadata (no email content for privacy)
      // So we need to queue a fresh job to get email examples for display
      console.log(`[EMAIL CATEGORIZATION] Database has metadata but onboarding needs fresh email examples - queueing fresh job`);
      
      // Don't return cached metadata - always queue fresh job for onboarding
      // This ensures the frontend gets the email examples it needs
    }

    // No cached result or need fresh data, queue worker job
    console.log(`[EMAIL CATEGORIZATION] Queueing fresh worker job for user ${userId}`);

    try {
      // Use predictable job ID for deduplication
      const jobId = `email-categorization-${userId}`;
      
      // Check if job is already queued or running
      const existingJobs = await emailCategorizationQueue.getJobs(['waiting', 'active', 'delayed']);
      const existingJob = existingJobs.find(job => job.id === jobId);
      
      if (existingJob) {
        console.log(`[EMAIL CATEGORIZATION] Job already exists for user ${userId} (Job ID: ${jobId})`);
        return { jobId };
      }
      
      await emailCategorizationQueue.add('email-categorization', {
        userId,
        options: {
          maxEmails,
          minFrequency,
          daysBack
        }
      }, {
        // Job options
        jobId, // Fixed job ID to prevent duplicates
        priority: 1, // High priority for onboarding flow
        delay: 0,
        attempts: 3,
        removeOnComplete: 5, // Keep last 5 completed jobs
        removeOnFail: 10     // Keep last 10 failed jobs for debugging
      });

      console.log(`[EMAIL CATEGORIZATION] ✅ Queued categorization job ${jobId} for user ${userId}`);
      return { jobId };

    } catch (error) {
      console.error(`[EMAIL CATEGORIZATION] Error queueing categorization job:`, error);
      throw error;
    }
  }

  /**
   * Clear in-memory cache for a specific user
   */
  async clearUserCache(userId: string): Promise<void> {
    // Clear all cache entries for this user
    const keysToDelete: string[] = [];
    for (const [key] of EmailCategorizationService.categorizationCache) {
      if (key.startsWith(`${userId}_`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      EmailCategorizationService.categorizationCache.delete(key);
    });
    
    console.log(`[EMAIL CATEGORIZATION] Cleared ${keysToDelete.length} cache entries for user ${userId}`);
  }

  /**
   * Check if user already has an onboarding job running
   */
  async hasOnboardingJobRunning(userId: string): Promise<boolean> {
    try {
      const lockKey = `onboarding-lock:${userId}`;
      const lockExists = await redisConnection.exists(lockKey);
      return lockExists === 1;
    } catch (error) {
      console.warn(`[EMAIL CATEGORIZATION] Error checking onboarding job status:`, error);
      return false; // Assume no job running if we can't check
    }
  }

  /**
   * Store full categorization result in memory cache (called by worker when job completes)
   */
  async storeCategorizationResult(userId: string, result: EmailCategorizationResult, options: EmailCategorizationOptions = {}): Promise<void> {
    const {
      maxEmails = 500,
      minFrequency = 1
    } = options;

    const cacheKey = `${userId}_${maxEmails}_${minFrequency}`;
    
    // Store full result with email examples in memory cache (per-process)
    EmailCategorizationService.categorizationCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });

    // Store full result in Redis (shared cache) – expires automatically
    const redisKey = `email_cat_full:${userId}`;
    await safeRedisOperation(
      () => redisConnection.set(redisKey, JSON.stringify(result), 'EX', EmailCategorizationService.REDIS_TTL_SEC),
      null,
      'store full categorization in Redis'
    );

    console.log(`[EMAIL CATEGORIZATION] Stored full result with email examples in Redis and memory cache for user ${userId}`);
    
    // Also save metadata-only version to database for future reference (privacy-safe)
    try {
      await this.saveCachedCategorizationResult(userId, result);
    } catch (error) {
      console.warn(`[EMAIL CATEGORIZATION] Could not save metadata to database:`, error);
      // Don't fail if database save fails - memory cache is the primary source
    }
  }

  /**
   * Get categorization result (from cache or database)
   */
  async getCategorizationResult(userId: string, options: EmailCategorizationOptions = {}): Promise<EmailCategorizationResult | null> {
    const {
      maxEmails = 500,
      minFrequency = 1
    } = options;

    // Clean up expired cache entries first
    EmailCategorizationService.cleanupExpiredCache();
    
    // Check in-memory cache first (has full results with email examples)
    const cacheKey = `${userId}_${maxEmails}_${minFrequency}`;
    const cachedInMemory = EmailCategorizationService.categorizationCache.get(cacheKey);
    if (cachedInMemory && (Date.now() - cachedInMemory.timestamp) < EmailCategorizationService.CACHE_TTL) {
      console.log(`[EMAIL CATEGORIZATION] Returning in-memory cached result with email examples for user ${userId}`);
      return cachedInMemory.result;
    }

    // Check Redis shared cache
    const redisKey = `email_cat_full:${userId}`;
    const redisCachedRaw = await safeRedisOperation(() => redisConnection.get(redisKey), null, 'get categorization from Redis');
    if (redisCachedRaw) {
      try {
        const redisCached: EmailCategorizationResult = JSON.parse(redisCachedRaw);
        console.log(`[EMAIL CATEGORIZATION] Returning Redis cached result for user ${userId}`);
        // Also write to in-memory cache
        EmailCategorizationService.categorizationCache.set(cacheKey, {
          result: redisCached,
          timestamp: Date.now()
        });
        return redisCached;
      } catch (err) {
        console.warn('[EMAIL CATEGORIZATION] Failed to parse Redis cached result, ignoring');
      }
    }

    // For onboarding flow, we need fresh data with email examples
    // Database cache only has metadata (no email content for privacy)
    console.log(`[EMAIL CATEGORIZATION] No fresh cached result available for user ${userId} - need to wait for worker job completion`);
    return null;
  }

  /**
   * Check job status in the queue
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    return getJobStatus(emailCategorizationQueue, jobId);
  }

  // ===================== CACHE AND DATABASE HELPER METHODS =====================
  // These methods remain for managing cached results

  /**
   * Get cached categorization result from database
   */
  private async getCachedCategorizationResult(userId: string): Promise<any | null> {
    try {
      const cached = await prisma.emailCategorizationResult.findFirst({
        where: { 
          userId,
          isActive: true 
        },
        orderBy: { updatedAt: 'desc' }
      });

      if (!cached) {
        return null;
      }

      return {
        categorizedEmails: cached.categorizedEmails as any[],
        folderSuggestions: cached.folderSuggestions as any[],
        totalEmailsAnalyzed: cached.totalEmailsAnalyzed as number,
        categorizationTimeMs: cached.categorizationTimeMs as number,
        createdAt: cached.createdAt,
        updatedAt: cached.updatedAt
      };
    } catch (error) {
      console.error('[EMAIL CATEGORIZATION] Error getting cached result:', error);
      return null;
    }
  }

  /**
   * Save categorization result to database cache
   */
  private async saveCachedCategorizationResult(userId: string, result: EmailCategorizationResult): Promise<void> {
    try {
      // Upsert the categorization result (replace if exists)
      await prisma.emailCategorizationResult.upsert({
        where: { userId },
        update: {
          categorizedEmails: result.categorizedEmails as any,
          folderSuggestions: result.folderSuggestions as any,
          totalEmailsAnalyzed: result.totalEmailsAnalyzed,
          categorizationTimeMs: result.categorizationTimeMs,
          version: { increment: 1 },
          updatedAt: new Date()
        },
        create: {
          userId,
          categorizedEmails: result.categorizedEmails as any,
          folderSuggestions: result.folderSuggestions as any,
          totalEmailsAnalyzed: result.totalEmailsAnalyzed,
          categorizationTimeMs: result.categorizationTimeMs,
          llmTokensUsed: 0, // TODO: Track this from LLM service
          version: 1,
          isActive: true
        }
      });

      console.log(`[EMAIL CATEGORIZATION] Cached result for user ${userId} in database`);
    } catch (error) {
      console.error('[EMAIL CATEGORIZATION] Error saving cached result:', error);
      // Don't throw - caching failure shouldn't break the flow
    }
  }

  /**
   * Update cached categorization result (for user edits)
   */
  async updateCachedResult(userId: string, updates: Partial<EmailCategorizationResult>): Promise<void> {
    try {
      const existing = await prisma.emailCategorizationResult.findUnique({
        where: { userId }
      });

      if (!existing) {
        throw new Error('No cached result found to update');
      }

      await prisma.emailCategorizationResult.update({
        where: { userId },
        data: {
          categorizedEmails: (updates.categorizedEmails || existing.categorizedEmails) as any,
          folderSuggestions: (updates.folderSuggestions || existing.folderSuggestions) as any,
          totalEmailsAnalyzed: updates.totalEmailsAnalyzed || (existing.totalEmailsAnalyzed as number),
          version: { increment: 1 },
          updatedAt: new Date()
        }
      });

      console.log(`[EMAIL CATEGORIZATION] Updated cached result for user ${userId}`);
    } catch (error) {
      console.error('[EMAIL CATEGORIZATION] Error updating cached result:', error);
      throw error;
    }
  }

  /**
   * Clear cached categorization result (force fresh analysis)
   */
  async clearCachedResult(userId: string): Promise<void> {
    try {
      await prisma.emailCategorizationResult.updateMany({
        where: { userId },
        data: { isActive: false }
      });

      console.log(`[EMAIL CATEGORIZATION] Cleared cached result for user ${userId}`);
    } catch (error) {
      console.error('[EMAIL CATEGORIZATION] Error clearing cached result:', error);
      throw error;
    }
  }
} 