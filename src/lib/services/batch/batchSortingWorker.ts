import { prisma } from '../../prisma';
import { GmailService } from '../../email/gmail';
import { EmailRouterService, EmailToRoute, BatchRouterResult } from '../../email/emailRouterService';
import { updateFolderEmailCount } from '../onboarding-services/utils/folderLabelUtils';
import { GmailLabelClassifier } from '../utils/gmailLabelClassifier';
import { FeatureFlags } from '../utils/featureFlags';
import { createGmailServiceForUser, getUserGmailCredentials } from '@/lib/security/getUserGmailCredentials';

export interface BatchSortConfig {
  userId: string;
  maxEmailsPerBatch?: number;
  includeSpam?: boolean;
  includeTrash?: boolean;
  daysBack?: number;
}

export interface BatchSortStats {
  jobId?: string;
  emailsProcessed: number;
  emailsSorted: number;
  emailsToReview: number;
  labelUpdatesApplied: number;
  processingTimeMs: number;
  tokensUsed: number;
  errors: string[];
  routingStats: {
    hardMappingRouted: number;
    llmRouted: number;
    fallbackRouted: number;
    averageConfidence: number;
    exactMatches: number;
    domainMatches: number;
  };
}

export interface EmailLabelUpdate {
  gmailMessageId: string;
  gmailLabelId: string;
  labelName: string;
  confidence: number;
}

/**
 * Batch Sorting Worker - Processes emails every 2 hours using LLM-based routing with hard mapping
 * 
 * Main Functions:
 * - Fetches new unlabeled emails from Gmail
 * - Routes emails using EmailRouterService (Hard Mapping -> LLM -> Review)
 * - Applies Gmail labels via API
 * - Tracks sorting decisions for analytics and system improvement
 * - Logs routing analytics for monitoring system performance
 */
export class BatchSortingWorker {
  private emailRouterService: EmailRouterService;

  constructor() {
    this.emailRouterService = new EmailRouterService();
  }

  /**
   * Main entry point: sort emails for a user
   */
  async sortEmailsForUser(config: BatchSortConfig): Promise<BatchSortStats> {
    console.log(`[BATCH SORTER] Starting email sorting for user ${config.userId}`);
    const startTime = Date.now();
    
    const stats: BatchSortStats = {
      emailsProcessed: 0,
      emailsSorted: 0,
      emailsToReview: 0,
      labelUpdatesApplied: 0,
      processingTimeMs: 0,
      tokensUsed: 0,
      errors: [],
      routingStats: {
        hardMappingRouted: 0,
        llmRouted: 0,
        fallbackRouted: 0,
        averageConfidence: 0,
        exactMatches: 0,
        domainMatches: 0
      }
    };

    try {
      // Check if user is eligible for batch sorting
      const eligibility = await this.isUserEligible(config.userId);
      if (!eligibility.eligible) {
        console.log(`[BATCH SORTER] User ${config.userId} not eligible: ${eligibility.reason}`);
        stats.errors.push(eligibility.reason || 'User not eligible for batch sorting');
        return stats;
      }

      // Create batch sort job record
      const batchJob = await this.createBatchSortJob(config.userId);
      // Expose job id to callers for UI/status linking
      stats.jobId = batchJob.id;
      console.log(`[BATCH SORTER] Created batch job ${batchJob.id} for user ${config.userId}`);

      // Step 1: Fetch new emails from Gmail
      const newEmails = await this.fetchNewEmailsFromGmail(config);
      stats.emailsProcessed = newEmails.length;

      if (newEmails.length === 0) {
        console.log(`[BATCH SORTER] No new emails to process for user ${config.userId}`);
        await this.completeBatchSortJob(batchJob.id, stats);
        return stats;
      }

      console.log(`[BATCH SORTER] Found ${newEmails.length} new emails for user ${config.userId}`);

      // Step 2: Route emails using hybrid FastText + LLM system
      const routingResult = await this.routeEmailsBatch(config.userId, newEmails, batchJob.id);
      stats.routingStats = routingResult.stats;
      stats.tokensUsed = routingResult.totalTokensUsed;
      stats.errors.push(...routingResult.errors);

      console.log(`[BATCH SORTER] Routing completed: ${routingResult.stats.hardMappingRouted} hard mapped (${routingResult.stats.exactMatches} exact, ${routingResult.stats.domainMatches} domain), ${routingResult.stats.llmRouted} LLM, ${routingResult.stats.fallbackRouted} fallback`);

      // Step 3: Apply Gmail labels
      const labelUpdates = await this.applyGmailLabels(config.userId, routingResult);
      stats.labelUpdatesApplied = labelUpdates.length;
      stats.emailsSorted = labelUpdates.filter(update => update.labelName !== 'Review').length;
      stats.emailsToReview = labelUpdates.filter(update => update.labelName === 'Review').length;

      console.log(`[BATCH SORTER] Applied ${stats.labelUpdatesApplied} label updates: ${stats.emailsSorted} sorted, ${stats.emailsToReview} to review`);

      // Step 4: Save routing results to database
      await this.saveRoutingResults(batchJob.id, config.userId, routingResult);

      // Step 5: Log routing analytics (FastText training data no longer needed)

      // Step 6: Update folder email counts
      await this.updateFolderEmailCounts(config.userId, routingResult);

      // Complete batch job
      stats.processingTimeMs = Date.now() - startTime;
      await this.completeBatchSortJob(batchJob.id, stats);

      console.log(`[BATCH SORTER] Completed sorting for user ${config.userId}: ${stats.emailsProcessed} processed, ${stats.emailsSorted} sorted, ${stats.emailsToReview} to review, ${stats.tokensUsed} tokens, ${stats.processingTimeMs}ms`);

      return stats;

    } catch (error) {
      const errorMessage = `Batch sorting failed for user ${config.userId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[BATCH SORTER] ${errorMessage}`, error);
      
      stats.errors.push(errorMessage);
      stats.processingTimeMs = Date.now() - startTime;

      // Ensure we finalize any created batch job record to avoid leaving it "running"
      try {
        if (stats.jobId) {
          await this.completeBatchSortJob(stats.jobId, stats);
          console.log(`[BATCH SORTER] Marked batch job ${stats.jobId} as failed after error`);
        }
      } catch (finalizeError) {
        console.warn(`[BATCH SORTER] Warning: failed to finalize batch job after error`, finalizeError);
      }
      
      return stats;
    }
  }

  /**
   * Fetch new emails from Gmail that need sorting
   */
  private async fetchNewEmailsFromGmail(config: BatchSortConfig): Promise<EmailToRoute[]> {
    console.log(`[BATCH SORTER] Fetching new emails from Gmail for user ${config.userId}`);

    try {
      const gmailResult = await createGmailServiceForUser({
        userId: config.userId,
        purpose: 'batch-sort:fetch-emails',
        requester: 'batchSortingWorker.fetchNewEmailsFromGmail',
      });

      if (!gmailResult) {
        throw new Error(`No valid OAuth token found for user ${config.userId}`);
      }

      const gmailService = gmailResult.gmail;

      // Get user's settings for history tracking
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId: config.userId }
      });

      // Fetch new emails using Gmail history API or recent messages
      const maxEmails = config.maxEmailsPerBatch || 100;
      const daysBack = config.daysBack || 1;
      
      console.log(`[BATCH SORTER] Fetching up to ${maxEmails} emails from last ${daysBack} days`);

      // Build Gmail query (canonical Stage 1): inbox only, exclude sent/spam/trash
      let query = 'in:inbox -in:spam -in:trash -in:sent';

      // Get messages from last N days
      const cutoffDate = new Date();
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() - daysBack);
      const afterDate = cutoffDate.toISOString().slice(0, 10).replace(/-/g, '/');
      query += ` after:${afterDate}`;

      // Fetch and parse emails using the built inbox-focused query
      const rawEmails = await gmailService.searchEmails(query, maxEmails);
      
      // CRITICAL SAFETY: Use comprehensive label classification to protect custom labels
      console.log(`[BATCH SORTER] 🔒 Starting comprehensive label analysis for ${rawEmails.length} emails`);
      
      const emailsToRoute: EmailToRoute[] = [];
      const protectedEmails = [];
      const safetyStats = {
        totalAnalyzed: 0,
        safeToProcess: 0,
        protectedForCustomLabels: 0,
        protectedForAnalysisFailure: 0
      };

      for (const email of rawEmails) {
        const messageId = email.gmailMessageId || email.messageId || `unknown-${Date.now()}`;
        safetyStats.totalAnalyzed++;
        
        try {
          // ROCK-SOLID SAFETY CHECK: Use GmailLabelClassifier emergency check
          const safetyCheck = GmailLabelClassifier.isSafeToProcess(
            messageId,
            email.labelIds,
            'sorting'
          );
          
          if (safetyCheck.isSafe) {
            // Email is completely safe to process
            safetyStats.safeToProcess++;
            emailsToRoute.push({
              gmailMessageId: messageId,
              gmailThreadId: email.gmailThreadId,
              from: email.from || 'unknown',
              subject: email.subject || 'No subject',
              snippet: email.snippet || email.body?.substring(0, 200) || 'No content',
              body: email.body,
              to: email.to || [],
              cc: email.cc || [],
              labels: email.labelIds || [],
              gmailCategories: email.gmailCategories || []
            });
            
            console.log(`[BATCH SORTER] ✅ SAFE: ${messageId} - ${safetyCheck.reason}`);
          } else {
            // Email has custom labels - PROTECTED from modification
            safetyStats.protectedForCustomLabels++;
            protectedEmails.push({
              messageId,
              from: email.from,
              subject: email.subject,
              reason: safetyCheck.reason
            });
            
            console.log(`[BATCH SORTER] 🛡️  PROTECTED: ${messageId} - ${safetyCheck.reason}`);
          }
          
        } catch (error) {
          // FAIL-SAFE: If safety analysis fails, protect the email
          safetyStats.protectedForAnalysisFailure++;
          protectedEmails.push({
            messageId,
            from: email.from,
            subject: email.subject,
            reason: `Safety analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
          
          console.error(`[BATCH SORTER] ⚠️  ANALYSIS FAILED (email protected): ${messageId}`, error);
        }
      }

      // Comprehensive safety reporting
      console.log(`[BATCH SORTER] 🔒 SAFETY ANALYSIS COMPLETE:`);
      console.log(`[BATCH SORTER]   📧 Total emails analyzed: ${safetyStats.totalAnalyzed}`);
      console.log(`[BATCH SORTER]   ✅ Safe to process: ${safetyStats.safeToProcess}`);
      console.log(`[BATCH SORTER]   🛡️  Protected (custom labels): ${safetyStats.protectedForCustomLabels}`);
      console.log(`[BATCH SORTER]   ⚠️  Protected (analysis failed): ${safetyStats.protectedForAnalysisFailure}`);
      console.log(`[BATCH SORTER]   📊 Safety rate: ${Math.round((safetyStats.safeToProcess / safetyStats.totalAnalyzed) * 100)}%`);
      
      // Log sample of protected emails for transparency
      if (protectedEmails.length > 0) {
        console.log(`[BATCH SORTER] 🔒 SAMPLE PROTECTED EMAILS (user organization preserved):`);
        protectedEmails.slice(0, 3).forEach(email => {
          console.log(`[BATCH SORTER]   - ${email.messageId}: ${email.from} (${email.reason})`);
        });
        if (protectedEmails.length > 3) {
          console.log(`[BATCH SORTER]   ... and ${protectedEmails.length - 3} more protected`);
        }
      }
      
      console.log(`[BATCH SORTER] ✅ PROCEEDING with ${emailsToRoute.length} verified-safe emails for sorting`);

      return emailsToRoute;

    } catch (error) {
      console.error(`[BATCH SORTER] Error fetching emails from Gmail:`, error);
      throw error;
    }
  }

  /**
   * Route emails using the hybrid EmailRouterService
   */
  private async routeEmailsBatch(
    userId: string, 
    emails: EmailToRoute[], 
    batchJobId: string
  ): Promise<BatchRouterResult> {
    console.log(`[BATCH SORTER] Routing ${emails.length} emails for user ${userId}`);

    try {
      const routingResult = await this.emailRouterService.routeEmails({
        userId,
        emails,
        batchJobId
      });

      console.log(`[BATCH SORTER] Routing completed: ${routingResult.totalProcessed} processed, ${routingResult.totalTokensUsed} tokens used`);

      return routingResult;

    } catch (error) {
      console.error(`[BATCH SORTER] Error routing emails:`, error);
      throw error;
    }
  }

  /**
   * Apply Gmail labels based on routing decisions
   */
  private async applyGmailLabels(
    userId: string, 
    routingResult: BatchRouterResult
  ): Promise<EmailLabelUpdate[]> {
    console.log(`[BATCH SORTER] Applying Gmail labels for ${routingResult.results.length} emails`);

    const labelUpdates: EmailLabelUpdate[] = [];

    try {
      const gmailResult = await createGmailServiceForUser({
        userId,
        purpose: 'batch-sort:apply-labels',
        requester: 'batchSortingWorker.applyGmailLabels',
      });

      if (!gmailResult) {
        throw new Error(`No valid OAuth token found for user ${userId}`);
      }

      const gmailService = gmailResult.gmail;

      // Get user's labels to map label IDs and names to Gmail label IDs
      const userLabels = await prisma.label.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          gmailLabelId: true
        }
      });

      const labelMapById = new Map(userLabels.map(label => [label.id, { name: label.name, gmailLabelId: label.gmailLabelId }]));
      const defaultFolderNames = new Set(['Inbox','Important','Review']);

      // Apply labels in batches for efficiency
      const batchSize = 20;
      
      for (let i = 0; i < routingResult.results.length; i += batchSize) {
        const batch = routingResult.results.slice(i, i + batchSize);

        for (const result of batch) {
          try {
            const labelInfo = labelMapById.get(result.decision.labelId);
            
            if (labelInfo && labelInfo.gmailLabelId) {
              // Optional: remove conflicting default categories when applying custom label
              const removeIds: string[] = [];
              if (!defaultFolderNames.has(labelInfo.name)) {
                // Remove INBOX categoricals if needed - kept simple, real mapping could fetch system label IDs once
                // Leaving removeIds empty by default to be conservative
              }
              await gmailService.modifyLabelsOnEmail(result.emailId, [labelInfo.gmailLabelId], removeIds);

              labelUpdates.push({
                gmailMessageId: result.emailId,
                gmailLabelId: labelInfo.gmailLabelId,
                labelName: labelInfo.name,
                confidence: result.decision.confidence
              });

              console.log(`[BATCH SORTER] Applied label ${labelInfo.name} to email ${result.emailId}`);
            } else {
              console.warn(`[BATCH SORTER] No Gmail label ID found for label ${result.decision.labelName}`);
            }

          } catch (error) {
            console.error(`[BATCH SORTER] Error applying label to email ${result.emailId}:`, error);
          }
        }

        // Rate limiting between batches
        if (i + batchSize < routingResult.results.length) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }
      }

      console.log(`[BATCH SORTER] Applied ${labelUpdates.length} Gmail labels successfully`);

      return labelUpdates;

    } catch (error) {
      console.error(`[BATCH SORTER] Error applying Gmail labels:`, error);
      throw error;
    }
  }

  /**
   * Save routing results to database for analytics
   */
  private async saveRoutingResults(
    batchJobId: string,
    userId: string,
    routingResult: BatchRouterResult
  ): Promise<void> {
    console.log(`[BATCH SORTER] Saving routing results to database: ${routingResult.results.length} records`);

    try {
      const emailSorts = routingResult.results.map(result => ({
        userId: userId,
        batchSortJobId: batchJobId,
        labelId: result.decision.labelId,
        gmailMessageId: result.emailId,
        confidence: result.decision.confidence,
        reasoning: result.decision.reasoning
      }));

      // Batch insert email sorts
      await prisma.emailSort.createMany({
        data: emailSorts,
        skipDuplicates: true
      });

      console.log(`[BATCH SORTER] Saved ${emailSorts.length} email sort records to database`);

    } catch (error) {
      console.error(`[BATCH SORTER] Error saving routing results:`, error);
      throw error;
    }
  }

  /**
   * Log routing analytics for system improvement
   */
  private async logRoutingAnalytics(
    userId: string,
    routingResult: BatchRouterResult
  ): Promise<void> {
    console.log(`[BATCH SORTER] Logging routing analytics for user ${userId}`);

    try {
      // Count routing methods
      const methodCounts = {
        hardMapping: routingResult.results.filter(r => r.decision.routingMethod === 'hard_mapping').length,
        llm: routingResult.results.filter(r => r.decision.routingMethod === 'llm').length,
        fallback: routingResult.results.filter(r => r.decision.routingMethod === 'fallback').length
      };

      // Count mapping types
      const mappingCounts = {
        exact: routingResult.results.filter(r => r.decision.mappingMatch === 'exact').length,
        domain: routingResult.results.filter(r => r.decision.mappingMatch === 'domain').length
      };

      console.log(`[BATCH SORTER] Analytics: ${methodCounts.hardMapping} hard mapped (${mappingCounts.exact} exact, ${mappingCounts.domain} domain), ${methodCounts.llm} LLM, ${methodCounts.fallback} fallback`);

      // Future: Could store these analytics in a dedicated table for system monitoring

    } catch (error) {
      console.error(`[BATCH SORTER] Error logging analytics:`, error);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Update folder email counts for analytics
   */
  private async updateFolderEmailCounts(
    userId: string,
    routingResult: BatchRouterResult
  ): Promise<void> {
    console.log(`[BATCH SORTER] Updating folder email counts for user ${userId}`);

    try {
      // Recompute exact unique counts per label touched this run to avoid drift
      const touchedLabelIds = Array.from(new Set(routingResult.results.map(r => r.decision.labelId)));

      for (const labelId of touchedLabelIds) {
        try {
          const uniqueGroups = await prisma.emailSort.groupBy({
            by: ['gmailMessageId'],
            where: { userId, labelId }
          });

          const uniqueCount = uniqueGroups.length;
          await updateFolderEmailCount(labelId, uniqueCount);
        } catch (error) {
          console.warn(`[BATCH SORTER] Error recalculating unique count for label ${labelId}:`, error);
        }
      }

      console.log(`[BATCH SORTER] Recomputed email counts for ${touchedLabelIds.length} folders`);

    } catch (error) {
      console.error(`[BATCH SORTER] Error updating folder email counts:`, error);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Create batch sort job record
   */
  private async createBatchSortJob(userId: string) {
    return await prisma.batchSortJob.create({
      data: {
        userId: userId,
        status: 'running',
        startedAt: new Date()
      }
    });
  }

  /**
   * Complete batch sort job with final statistics
   */
  private async completeBatchSortJob(batchJobId: string, stats: BatchSortStats): Promise<void> {
    try {
      await prisma.batchSortJob.update({
        where: { id: batchJobId },
        data: {
          status: stats.errors.length > 0 ? 'failed' : 'completed',
          emailsProcessed: stats.emailsProcessed,
          emailsSorted: stats.emailsSorted,
          emailsToReview: stats.emailsToReview,
          completedAt: new Date(),
          errorMessage: stats.errors.length > 0 ? stats.errors.join('; ') : null,
          llmTokensUsed: stats.tokensUsed
        }
      });

      console.log(`[BATCH SORTER] Completed batch job ${batchJobId}`);

    } catch (error) {
      console.error(`[BATCH SORTER] Error completing batch job:`, error);
    }
  }

  /**
   * Get batch job history for a user
   */
  async getBatchJobHistory(userId: string, limit: number = 10) {
    try {
      return await prisma.batchSortJob.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          emailsProcessed: true,
          emailsSorted: true,
          emailsToReview: true,
          startedAt: true,
          completedAt: true,
          llmTokensUsed: true,
          errorMessage: true
        }
      });
    } catch (error) {
      console.error(`[BATCH SORTER] Error getting batch job history:`, error);
      return [];
    }
  }

  /**
   * Check if user is eligible for batch sorting
   */
  async isUserEligible(userId: string): Promise<{ eligible: boolean; reason?: string }> {
    try {
      // Check if Always-On Sorting feature is enabled
      if (!FeatureFlags.isAlwaysOnSortingEnabled(userId)) {
        return { eligible: false, reason: 'Always-on sorting feature is disabled for this user' };
      }

      // Check if user has completed onboarding
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          labelingOnboardingGenerated: true,
          labelingOnboardingQualityGenerated: true
        }
      });

      if (!user) {
        return { eligible: false, reason: 'User not found' };
      }

      if (!user.labelingOnboardingGenerated) {
        return { eligible: false, reason: 'User has not completed labeling onboarding' };
      }

      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { autoSortingEnabled: true }
      });

      if (!userSettings?.autoSortingEnabled) {
        return { eligible: false, reason: 'User disabled automatic sorting' };
      }

      // Check user has at least one folder (LLM-generated or otherwise), excluding Gmail system labels
      const userFolderCount = await prisma.label.count({
        where: { userId, isSystemLabel: false }
      });
      if (userFolderCount === 0) {
        return { eligible: false, reason: 'No folders found for user' };
      }

      // Check if user has OAuth credentials
      const credentials = await getUserGmailCredentials({
        userId,
        purpose: 'batch-sort:eligibility-check',
        requester: 'batchSortingWorker.isUserEligible',
      });

      if (!credentials?.accessToken) {
        return { eligible: false, reason: 'User does not have valid Gmail OAuth credentials' };
      }

      // Check if there's already a running batch job
      const runningJob = await prisma.batchSortJob.findFirst({
        where: {
          userId: userId,
          status: 'running'
        }
      });

      if (runningJob) {
        return { eligible: false, reason: 'User already has a running batch sort job' };
      }

      return { eligible: true };

    } catch (error) {
      console.error(`[BATCH SORTER] Error checking user eligibility:`, error);
      return { eligible: false, reason: 'Error checking user eligibility' };
    }
  }

  /**
   * Process all eligible users (called by cron job)
   */
  async processAllUsers(): Promise<{ processed: number; errors: string[] }> {
    console.log(`[BATCH SORTER] Processing all eligible users`);

    const result = {
      processed: 0,
      errors: [] as string[]
    };

    try {
      // Get all users who have completed labeling onboarding
      const eligibleUsers = await prisma.user.findMany({
        where: {
          labelingOnboardingGenerated: true,
          // Only process users who haven't had a job in the last 90 minutes
          // to avoid overlapping 2-hour cycles
          batchSortJobs: {
            none: {
              startedAt: {
                gte: new Date(Date.now() - 90 * 60 * 1000) // 90 minutes ago
              }
            }
          }
        },
        select: {
          id: true,
          email: true
        }
      });

      console.log(`[BATCH SORTER] Found ${eligibleUsers.length} eligible users`);

      // Process users in parallel with concurrency limit
      const concurrency = 3; // Process up to 3 users simultaneously
      
      for (let i = 0; i < eligibleUsers.length; i += concurrency) {
        const batch = eligibleUsers.slice(i, i + concurrency);
        
        const batchPromises = batch.map(async (user) => {
          try {
            console.log(`[BATCH SORTER] Processing user ${user.email} (${user.id})`);
            
            const config = FeatureFlags.getAlwaysOnSortingConfig();
            const stats = await this.sortEmailsForUser({
              userId: user.id,
              maxEmailsPerBatch: config.maxBatchSize,
              daysBack: 1
            });

            if (stats.errors.length === 0) {
              console.log(`[BATCH SORTER] Successfully processed user ${user.email}: ${stats.emailsProcessed} emails`);
            } else {
              console.warn(`[BATCH SORTER] Processed user ${user.email} with errors:`, stats.errors);
              result.errors.push(`${user.email}: ${stats.errors.join(', ')}`);
            }

            result.processed++;

          } catch (error) {
            const errorMsg = `Error processing user ${user.email}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            console.error(`[BATCH SORTER] ${errorMsg}`, error);
            result.errors.push(errorMsg);
          }
        });

        // Wait for current batch to complete
        await Promise.all(batchPromises);

        // Rate limiting between batches
        if (i + concurrency < eligibleUsers.length) {
          console.log(`[BATCH SORTER] Completed batch ${Math.floor(i/concurrency) + 1}, waiting before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
        }
      }

      console.log(`[BATCH SORTER] Completed processing all users: ${result.processed} processed, ${result.errors.length} errors`);

      return result;

    } catch (error) {
      const errorMsg = `Error in bulk user processing: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[BATCH SORTER] ${errorMsg}`, error);
      result.errors.push(errorMsg);
      return result;
    }
  }
}
