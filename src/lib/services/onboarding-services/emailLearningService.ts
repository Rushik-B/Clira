/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Email Learning Service - Now uses worker-based processing for LLM operations
import { prisma } from '../../prisma';
import { emailLearningQueue } from '../utils/queues';
import { getLearningJobStatus } from './utils/queueStatus';
import {
  EmailCorrection,
  EmailLearning,
  LearningContext,
  JobStatus
} from './types';

/**
 * Email Learning Service - Manages user feedback with worker-based AI processing
 * 
 * This service now handles:
 * 1. Queuing user corrections for worker processing
 * 2. Using workers for LLM-based learning generation
 * 3. Storing privacy-preserving learning summaries
 * 4. Retrieving learnings for future AI decisions
 * 5. Fast feedback processing with background LLM analysis
 */
export class EmailLearningService {
  
  constructor() {
    // Service is ready for worker-based processing
  }

  /**
   * @deprecated Use queueCorrectionsForProcessing() instead
   * Backwards-compatible shim: process corrections with feedback.
   * New worker-based flow queues a job and returns counts immediately.
   */
  async processCorrectionsWithFeedback(
    userId: string,
    corrections: EmailCorrection[]
  ): Promise<{ processedLearnings: number; errors: string[]; jobId?: string }> {
    console.warn('[EMAIL LEARNING] processCorrectionsWithFeedback is deprecated. Use queueCorrectionsForProcessing() instead.');
    
    try {
      const learningCorrections = corrections.filter(c => c.shouldLearn && !!c.reason);
      if (learningCorrections.length === 0) {
        return { processedLearnings: 0, errors: [] };
      }
      const { jobId } = await this.queueLearningJob(userId, learningCorrections);
      return { processedLearnings: learningCorrections.length, errors: [], jobId };
    } catch (error) {
      console.error('[EMAIL LEARNING] Error processing corrections with feedback:', error);
      return { processedLearnings: 0, errors: ['Failed to queue learning job'] };
    }
  }

  /**
   * Queue email learning job for worker processing
   */
  async queueLearningJob(
    userId: string,
    corrections: EmailCorrection[]
  ): Promise<{ jobId: string }> {
    console.log(`[EMAIL LEARNING] Queueing learning job for user ${userId}`);
    
    try {
      const job = await emailLearningQueue.add('email-learning', {
        userId,
        corrections
      }, {
        priority: 3, // Lower priority (lightweight job)
        delay: 0,
        attempts: 2
      });

      console.log(`[EMAIL LEARNING] ✅ Queued learning job ${job.id} for user ${userId}`);
      return { jobId: job.id! };

    } catch (error) {
      console.error(`[EMAIL LEARNING] Error queueing learning job:`, error);
      throw error;
    }
  }

  /**
   * Check learning job status
   */
  async getLearningJobStatus(jobId: string): Promise<JobStatus> {
    return getLearningJobStatus(emailLearningQueue, jobId);
  }

  /**
   * Queue user corrections for worker processing (fast response)
   */
  async queueCorrectionsForProcessing(
    userId: string, 
    corrections: EmailCorrection[]
  ): Promise<{ jobId: string; cached?: boolean }> {
    console.log(`[EMAIL LEARNING] Queueing ${corrections.length} corrections for processing by worker`);
    
    try {
      // Filter corrections that should create learnings
      const learningCorrections = corrections.filter(c => c.shouldLearn && c.reason);
      
      if (learningCorrections.length === 0) {
        console.log(`[EMAIL LEARNING] No corrections with reasoning found`);
        return { jobId: 'no-learning', cached: true };
      }

      // Queue worker job for LLM processing
      const result = await this.queueLearningJob(userId, learningCorrections);
      return result;

    } catch (error) {
      console.error(`[EMAIL LEARNING] Error queueing corrections:`, error);
      throw error;
    }
  }



  // ===================== REMOVED LLM METHODS =====================
  // LLM processing has been moved to worker-based processing in FolderGenerationWorkerService
  // The worker handles generateLearningSummaries, createLearningPrompt, and parseLearningResponse

  /**
   * Get active learnings for a user to include in AI context
   */
  async getUserLearnings(userId: string): Promise<EmailLearning[]> {
    try {
      const learnings = await prisma.emailLearning.findMany({
        where: {
          userId,
          isActive: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 50 // Limit to recent learnings to avoid context overflow
      });

      console.log(`[EMAIL LEARNING] Retrieved ${learnings.length} active learnings for user ${userId}`);
      return learnings;

    } catch (error) {
      console.error(`[EMAIL LEARNING] Error retrieving user learnings:`, error);
      return [];
    }
  }

  /**
   * Get learnings formatted for LLM context
   */
  async getLearningsForLLMContext(userId: string): Promise<string> {
    try {
      const learnings = await this.getUserLearnings(userId);
      
      if (learnings.length === 0) {
        return '';
      }

      const learningContext = learnings.map((learning, index) => 
        `${index + 1}. ${learning.aiSummary} (from ${learning.emailFrom}: ${learning.originalFolder} → ${learning.correctedFolder})`
      ).join('\n');

      return `PREVIOUS USER CORRECTIONS AND LEARNINGS:
The user has previously made the following corrections with reasoning:

${learningContext}

Use these learnings to improve categorization accuracy and avoid similar mistakes.`;

    } catch (error) {
      console.error(`[EMAIL LEARNING] Error formatting learnings for LLM:`, error);
      return '';
    }
  }

  /**
   * Get learning statistics for analytics
   */
  async getLearningStats(userId: string): Promise<{
    totalLearnings: number;
    activeLearnings: number;
    recentLearnings: number;
    topCorrectedFolders: Array<{ folder: string; count: number }>;
    topCorrectedSenders: Array<{ sender: string; count: number }>;
  }> {
    try {
      const [totalCount, activeCount, recentCount, folderCounts, senderCounts] = await Promise.all([
        // Total learnings
        prisma.emailLearning.count({
          where: { userId }
        }),
        
        // Active learnings
        prisma.emailLearning.count({
          where: {
            userId,
            isActive: true
          }
        }),
        
        // Recent learnings (last 7 days)
        prisma.emailLearning.count({
          where: {
            userId,
            isActive: true,
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            }
          }
        }),
        
        // Learnings by corrected folder
        prisma.emailLearning.groupBy({
          by: ['correctedFolder'],
          where: {
            userId,
            isActive: true
          },
          _count: {
            id: true
          },
          orderBy: {
            _count: {
              id: 'desc'
            }
          },
          take: 5
        }),
        
        // Learnings by email sender
        prisma.emailLearning.groupBy({
          by: ['emailFrom'],
          where: {
            userId,
            isActive: true
          },
          _count: {
            id: true
          },
          orderBy: {
            _count: {
              id: 'desc'
            }
          },
          take: 5
        })
      ]);

      const topCorrectedFolders = folderCounts.map(fc => ({
        folder: fc.correctedFolder,
        count: fc._count.id
      }));

      const topCorrectedSenders = senderCounts.map(sc => ({
        sender: sc.emailFrom,
        count: sc._count.id
      }));

      console.log(`[EMAIL LEARNING] Learning stats for user ${userId}: ${totalCount} total, ${activeCount} active, ${recentCount} recent`);

      return {
        totalLearnings: totalCount,
        activeLearnings: activeCount,
        recentLearnings: recentCount,
        topCorrectedFolders,
        topCorrectedSenders
      };

    } catch (error) {
      console.error(`[EMAIL LEARNING] Error getting learning stats:`, error);
      return {
        totalLearnings: 0,
        activeLearnings: 0,
        recentLearnings: 0,
        topCorrectedFolders: [],
        topCorrectedSenders: []
      };
    }
  }

  /**
   * Deactivate a learning (soft delete)
   */
  async deactivateLearning(userId: string, learningId: string): Promise<void> {
    try {
      await prisma.emailLearning.updateMany({
        where: {
          id: learningId,
          userId // Ensure user owns this learning
        },
        data: {
          isActive: false
        }
      });

      console.log(`[EMAIL LEARNING] Deactivated learning ${learningId} for user ${userId}`);

    } catch (error) {
      console.error(`[EMAIL LEARNING] Error deactivating learning:`, error);
      throw error;
    }
  }

  /**
   * Clear all learnings for a user (soft delete)
   */
  async clearUserLearnings(userId: string): Promise<void> {
    try {
      await prisma.emailLearning.updateMany({
        where: { userId },
        data: {
          isActive: false
        }
      });

      console.log(`[EMAIL LEARNING] Cleared all learnings for user ${userId}`);

    } catch (error) {
      console.error(`[EMAIL LEARNING] Error clearing user learnings:`, error);
      throw error;
    }
  }
}