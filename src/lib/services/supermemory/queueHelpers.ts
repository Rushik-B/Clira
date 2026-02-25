/**
 * Supermemory Queue Helpers
 *
 * Functions for enqueuing Supermemory bootstrap jobs.
 * Used to trigger memory graph building after core onboarding completes.
 */

import { supermemoryBootstrapQueue, SupermemoryBootstrapJobData } from '../utils/queues';
import { isSupermemoryConfigured } from './client';
import { logger } from '@/lib/logger';
import redisConnection from '../utils/redis';

const getSupermemoryBootstrapCompletedKey = (userId: string) =>
  `supermemory-bootstrap:completed:${userId}`;

/**
 * Enqueue a Supermemory bootstrap job for a user
 *
 * This should be called after core onboarding completes to build
 * the user's memory graph in the background.
 *
 * @param userId - The user ID to build memory graph for
 * @param options - Optional configuration
 * @returns The job ID if enqueued, null if Supermemory not configured
 */
export async function enqueueSupermemoryBootstrap(
  userId: string,
  options?: {
    maxSentEmails?: number;
    budgetTokens?: number;
    dryRun?: boolean;
    /**
     * Delay in milliseconds before starting the job.
     * Useful to avoid overloading the system during onboarding.
     * Default: 30 seconds
     */
    delayMs?: number;
  },
): Promise<string | null> {
  // Check if Supermemory is configured
  if (!isSupermemoryConfigured()) {
    logger.info(
      `[Supermemory] Skipping bootstrap enqueue for user ${userId} - API key not configured`,
    );
    return null;
  }

  const stableJobId = `supermemory-bootstrap-${userId}`;
  const completedKey = getSupermemoryBootstrapCompletedKey(userId);

  const jobData: SupermemoryBootstrapJobData = {
    userId,
    maxSentEmails: options?.maxSentEmails ?? 250,
    budgetTokens: options?.budgetTokens ?? 100_000,
    dryRun: options?.dryRun ?? false,
  };

  const delayMs = options?.delayMs ?? 30_000; // Default 30 second delay

  try {
    // If bootstrap completed recently, do not enqueue again.
    // This pairs with worker-level guard for end-to-end idempotency.
    if (!jobData.dryRun) {
      const completedAtIso = await redisConnection.get(completedKey);
      if (completedAtIso) {
        logger.info(
          `[Supermemory] Bootstrap recently completed for user ${userId} at ${completedAtIso}, skipping enqueue`,
        );
        return stableJobId;
      }
    }

    const existingJob = await supermemoryBootstrapQueue.getJob(stableJobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (['waiting', 'delayed', 'active'].includes(state)) {
        logger.info(
          `[Supermemory] Bootstrap job already ${state} for user ${userId}, not enqueueing a duplicate`,
        );
        return stableJobId;
      }

      if (state === 'completed' || state === 'failed') {
        await existingJob.remove();
      }
    }

    const job = await supermemoryBootstrapQueue.add('build-user-memory-graph', jobData, {
      delay: delayMs,
      // Ensure job ID is unique per user to prevent duplicate bootstrap jobs
      jobId: stableJobId,
    });

    logger.info(
      `[Supermemory] Enqueued bootstrap job for user ${userId}: ${job.id} (delay: ${delayMs}ms)`,
    );

    return job.id!;
  } catch (error) {
    // Handle duplicate job scenario
    if (error instanceof Error && error.message.includes('Job is not unique')) {
      logger.info(
        `[Supermemory] Bootstrap job already exists for user ${userId}, skipping`,
      );
      return stableJobId;
    }

    logger.error(`[Supermemory] Failed to enqueue bootstrap job for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Check if a user has a pending or active bootstrap job
 *
 * @param userId - The user ID to check
 * @returns True if job exists, false otherwise
 */
export async function hasActiveBootstrapJob(userId: string): Promise<boolean> {
  const jobId = `supermemory-bootstrap-${userId}`;

  try {
    const job = await supermemoryBootstrapQueue.getJob(jobId);

    if (!job) {
      return false;
    }

    const state = await job.getState();

    // Active if waiting, delayed, or running
    return ['waiting', 'delayed', 'active'].includes(state);
  } catch (error) {
    logger.warn(`[Supermemory] Error checking job status for user ${userId}:`, error);
    return false;
  }
}

/**
 * Get the status of a user's bootstrap job
 *
 * @param userId - The user ID to check
 * @returns Job status or null if no job exists
 */
export async function getBootstrapJobStatus(
  userId: string,
): Promise<{
  id: string;
  state: string;
  progress: number;
  data: SupermemoryBootstrapJobData;
  result?: unknown;
  failedReason?: string;
} | null> {
  const jobId = `supermemory-bootstrap-${userId}`;
  const MAX_JOB_DURATION_MS = 10 * 60 * 1000; // 15 minutes (slightly longer than 20min lock)

  try {
    const job = await supermemoryBootstrapQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = typeof job.progress === 'number' ? job.progress : 0;

    // Check if job has been stuck in "active" state for too long
    if (state === 'active') {
      const processedOn = job.processedOn;
      if (processedOn) {
        const duration = Date.now() - processedOn;
        if (duration > MAX_JOB_DURATION_MS) {
          logger.warn(
            `[Supermemory] Job ${jobId} has been active for ${Math.floor(duration / 1000 / 60)} minutes, marking as failed`,
          );
          // Try to move job to failed state
          try {
            const error = new Error(
              `Job exceeded maximum duration of ${MAX_JOB_DURATION_MS / 1000 / 60} minutes. Worker may have crashed or job is stuck.`,
            );
            await job.moveToFailed(error, job.token || '');
            // Re-fetch state after moving to failed
            const newState = await job.getState();
            return {
              id: job.id!,
              state: newState,
              progress,
              data: job.data,
              result: job.returnvalue,
              failedReason: `Job exceeded maximum duration. Worker may have crashed or job is stuck.`,
            };
          } catch (moveError) {
            logger.error(`[Supermemory] Failed to move stuck job to failed state:`, moveError);
            // Return the stuck state anyway so UI can show it
          }
        }
      }
    }

    return {
      id: job.id!,
      state,
      progress,
      data: job.data,
      result: job.returnvalue,
      failedReason: job.failedReason,
    };
  } catch (error) {
    logger.warn(`[Supermemory] Error getting job status for user ${userId}:`, error);
    return null;
  }
}

/**
 * Cancel a user's pending bootstrap job
 *
 * Works for jobs that haven't started yet (waiting/delayed).
 * For active jobs, attempts to remove them (force cancel).
 *
 * @param userId - The user ID to cancel job for
 * @param force - If true, force remove even active jobs (default: false)
 * @returns Object with success status and message
 */
export async function cancelBootstrapJob(
  userId: string,
  force: boolean = false,
): Promise<{ success: boolean; message: string }> {
  const jobId = `supermemory-bootstrap-${userId}`;

  try {
    const job = await supermemoryBootstrapQueue.getJob(jobId);

    if (!job) {
      return {
        success: false,
        message: 'Job not found. It may have already completed, been removed, or never existed.',
      };
    }

    const state = await job.getState();

    // If job is already completed or failed, consider it "cancelled" (already done)
    if (state === 'completed' || state === 'failed') {
      return {
        success: true,
        message: `Job is already ${state}. No action needed.`,
      };
    }

    // Can cancel jobs that haven't started
    if (state === 'waiting' || state === 'delayed') {
      try {
        await job.remove();
        logger.info(`[Supermemory] Cancelled ${state} bootstrap job for user ${userId}`);
        return {
          success: true,
          message: 'Job cancelled successfully',
        };
      } catch (removeError) {
        logger.error(
          `[Supermemory] Failed to remove ${state} job for user ${userId}:`,
          removeError,
        );
        return {
          success: false,
          message: `Failed to remove job: ${removeError instanceof Error ? removeError.message : 'Unknown error'}`,
        };
      }
    }

    // Force cancel for active jobs
    if (force && state === 'active') {
      try {
        const LOCK_DURATION_MS = 20 * 60 * 1000; // 20 minutes (matches worker config)
        const processedOn = job.processedOn;
        const isLockExpired = processedOn
          ? Date.now() - processedOn > LOCK_DURATION_MS
          : false;

        // If lock is expired, it's an orphaned job - we can safely unlock it
        if (isLockExpired) {
          logger.info(
            `[Supermemory] Detected orphaned job (lock expired) for user ${userId}, unlocking...`,
          );
          try {
            // Manually remove the lock key from Redis
            const lockKey = `bull:supermemory-bootstrap:${job.id}:lock`;
            await redisConnection.del(lockKey);
            
            // Then move to failed
            const error = new Error('Orphaned job - worker crashed or was killed. Lock expired.');
            await job.moveToFailed(error, job.token || '');
            logger.info(`[Supermemory] Unlocked and moved orphaned job to failed for user ${userId}`);
            return {
              success: true,
              message: 'Orphaned job unlocked and cancelled successfully (worker was not running)',
            };
          } catch (unlockError) {
            logger.warn(`[Supermemory] Could not unlock orphaned job, trying direct removal:`, unlockError);
            // Fall through to direct removal
          }
        }

        // Try to move to failed first (cleaner than just removing)
        try {
          const error = new Error('Job force cancelled by user');
          await job.moveToFailed(error, job.token || '');
          logger.info(`[Supermemory] Force moved ${state} job to failed for user ${userId}`);
          return {
            success: true,
            message: 'Stuck job force cancelled successfully',
          };
        } catch (moveError) {
          // If moveToFailed fails, try direct removal
          const moveErrorMsg = moveError instanceof Error ? moveError.message : String(moveError);
          
          if (moveErrorMsg.includes('locked') || moveErrorMsg.includes('Lock')) {
            // Job is locked - check if we can wait for lock to expire
            if (processedOn) {
              const lockExpiresAt = processedOn + LOCK_DURATION_MS;
              const timeUntilExpiry = lockExpiresAt - Date.now();
              
              if (timeUntilExpiry > 0) {
                const minutesLeft = Math.ceil(timeUntilExpiry / 1000 / 60);
                return {
                  success: false,
                  message: `Job is locked by a worker. The lock will expire in ${minutesLeft} minute(s). If the worker is not running, wait for the lock to expire or restart the worker to release it.`,
                };
              }
            }
            
            // Lock should be expired but still can't remove - try to unlock manually
            logger.warn(
              `[Supermemory] Job is locked but lock should be expired, attempting manual unlock:`,
              moveError,
            );
            try {
              // Try to get the lock key and remove it manually via Redis
              // BullMQ lock key format: bull:{queueName}:{jobId}:lock
              const lockKey = `bull:supermemory-bootstrap:${job.id}:lock`;
              await redisConnection.del(lockKey);
              
              // Also try to remove the processed key if it exists
              const processedKey = `bull:supermemory-bootstrap:${job.id}:processed`;
              await redisConnection.del(processedKey);
              
              // Now try to remove the job again
              await job.remove();
              logger.info(`[Supermemory] Manually unlocked and removed locked job for user ${userId}`);
              return {
                success: true,
                message: 'Orphaned job unlocked and removed successfully',
              };
            } catch (manualUnlockError) {
              logger.error(`[Supermemory] Failed to manually unlock job:`, manualUnlockError);
              const timeRemaining = processedOn
                ? Math.ceil((LOCK_DURATION_MS - (Date.now() - processedOn)) / 1000 / 60)
                : Math.ceil(LOCK_DURATION_MS / 1000 / 60);
              return {
                success: false,
                message: `Job is locked and cannot be unlocked. The lock will expire automatically in ${timeRemaining} minute(s), or you can restart the worker process to release it immediately.`,
              };
            }
          }
          
          // Other error - try direct removal
          logger.warn(
            `[Supermemory] Could not move job to failed, trying direct removal:`,
            moveError,
          );
          await job.remove();
          logger.info(`[Supermemory] Force removed ${state} bootstrap job for user ${userId}`);
          return {
            success: true,
            message: 'Job removed successfully',
          };
        }
      } catch (removeError) {
        logger.error(
          `[Supermemory] Failed to force cancel ${state} job for user ${userId}:`,
          removeError,
        );
        const errorMsg = removeError instanceof Error ? removeError.message : String(removeError);
        
        if (errorMsg.includes('locked') || errorMsg.includes('Lock')) {
          const processedOn = job.processedOn;
          if (processedOn) {
            const LOCK_DURATION_MS = 20 * 60 * 1000;
            const lockExpiresAt = processedOn + LOCK_DURATION_MS;
            const timeUntilExpiry = lockExpiresAt - Date.now();
            
            if (timeUntilExpiry > 0) {
              const minutesLeft = Math.ceil(timeUntilExpiry / 1000 / 60);
              return {
                success: false,
                message: `Job is locked by a worker. Lock expires in ${minutesLeft} minute(s). If the worker crashed, restart it to release the lock immediately, or wait for it to expire.`,
              };
            }
          }
        }
        
        return {
          success: false,
          message: `Failed to force cancel job: ${errorMsg}. The job may be locked by the worker.`,
        };
      }
    }

    // Job exists but can't be cancelled without force
    return {
      success: false,
      message: `Job is in "${state}" state and cannot be cancelled without force. Use force=true to force cancel stuck jobs.`,
    };
  } catch (error) {
    logger.error(`[Supermemory] Error cancelling job for user ${userId}:`, error);
    return {
      success: false,
      message: `Error cancelling job: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
