/**
 * Shared Queue Status Utilities
 * 
 * Consolidates common Bull queue status checking patterns used across
 * onboarding services to eliminate code duplication.
 */

import { JobStatus } from '../types';

/**
 * Standardized job status checker for Bull queues
 * 
 * This utility eliminates the duplicated queue status logic found in:
 * - EmailCategorizationService.getJobStatus()
 * - EmailLearningService.getLearningJobStatus() 
 * - EmailMappingService.getMappingJobStatus()
 */
export async function getJobStatus(queue: any, jobId: string): Promise<JobStatus> {
  if (jobId === 'cached') {
    return { status: 'cached' };
  }

  try {
    const job = await queue.getJob(jobId);
    
    if (!job) {
      return { status: 'failed', error: 'Job not found' };
    }

    if (job.finishedOn) {
      if (job.failedReason) {
        return { 
          status: 'failed', 
          error: job.failedReason 
        };
      } else {
        return { 
          status: 'completed', 
          progress: 100, 
          result: job.returnvalue 
        };
      }
    } else if (job.processedOn) {
      return { 
        status: 'active', 
        progress: (job.progress as number) || 0 
      };
    } else {
      return { status: 'waiting' };
    }
  } catch (error) {
    console.error('Error checking job status:', error);
    return { status: 'failed', error: 'Failed to check job status' };
  }
}

/**
 * Special job status handler for jobs that can return 'no-learning' responses
 * Used by EmailLearningService for corrections that don't require learning
 */
export async function getLearningJobStatus(queue: any, jobId: string): Promise<JobStatus> {
  if (jobId === 'no-learning') {
    return { status: 'cached' };
  }
  
  return getJobStatus(queue, jobId);
}