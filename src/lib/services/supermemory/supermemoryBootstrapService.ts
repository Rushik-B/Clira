/**
 * Supermemory Bootstrap Service
 *
 * Main service that orchestrates the historical email memory bootstrap process.
 * Per SUPERMEMORY.md Section 5 - Bootstrap Pipeline:
 *
 * 1. Fetch last 250 sent emails (in-memory)
 * 2. Dedupe by thread, pick latest sent per thread
 * 3. Enforce 100k token budget
 * 4. Fetch full thread messages and prune
 * 5. Summarize each thread into 2-field JSON episode
 * 6. Upload to Supermemory
 * 7. Generate and upload user profile bootstrap
 */

import { logger } from '@/lib/logger';
import { GmailService, EmailData } from '@/lib/email/gmail';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { prisma } from '@/lib/prisma';

import {
  SupermemoryBootstrapJobData,
  SupermemoryBootstrapResult,
  ThreadForProcessing,
  EmailForSummary,
  ThreadEpisodeContent,
  ThreadEpisodeMetadata,
  UserProfileBootstrapMetadata,
  TokenBudgetTracker,
  DEFAULT_BOOTSTRAP_CONFIG,
  EPISODE_CHAR_LIMITS,
} from './types';
import { SupermemoryClient, getSupermemoryClient, isSupermemoryConfigured } from './client';
import { summarizeThreadEpisode, validateEpisodeContent } from './threadSummarizer';
import {
  generateUserProfileBootstrap,
  validateProfileContent,
  profileContentToDocumentString,
} from './profileGenerator';
import { pruneEmailBodyForSummary, estimateTokensFromChars } from './emailPruner';
import { createApiRateLimiter } from './rateLimiter';

// ============================================================================
// Token Budget Tracker Implementation
// ============================================================================

function createTokenBudgetTracker(budgetTokens: number): TokenBudgetTracker {
  return {
    budgetTokens,
    usedTokens: 0,
    documentsIngested: 0,

    canAfford(tokens: number): boolean {
      return this.usedTokens + tokens <= this.budgetTokens;
    },

    recordUsage(tokens: number): void {
      this.usedTokens += tokens;
      this.documentsIngested += 1;
    },

    estimateTokensFromChars(chars: number): number {
      return estimateTokensFromChars(chars);
    },
  };
}

// ============================================================================
// Main Bootstrap Service
// ============================================================================

/**
 * Supermemory Bootstrap Service
 *
 * Orchestrates the full historical email memory bootstrap process.
 * Designed to run as a background job after core onboarding completes.
 */
export class SupermemoryBootstrapService {
  private client: SupermemoryClient | null = null;
  private gmailService: GmailService | null = null;
  private userId: string = '';
  private userEmail: string = '';

  // Test mode tracking
  private threadFetchStats = { success: 0, empty: 0, failed: 0 };

  /**
   * Execute the full bootstrap process for a user
   */
  async execute(jobData: SupermemoryBootstrapJobData): Promise<SupermemoryBootstrapResult> {
    const startTime = Date.now();
    const {
      userId,
      maxSentEmails = DEFAULT_BOOTSTRAP_CONFIG.MAX_SENT_EMAILS,
      budgetTokens = DEFAULT_BOOTSTRAP_CONFIG.BUDGET_TOKENS,
      dryRun = false,
      includeGeneratedContent = false,
    } = jobData;

    this.userId = userId;
    this.threadFetchStats = { success: 0, empty: 0, failed: 0 };

    logger.info(
      `[SupermemoryBootstrap] 🚀 Starting bootstrap for user ${userId} (maxEmails=${maxSentEmails}, budget=${budgetTokens}, dryRun=${dryRun})`,
    );

    const result: SupermemoryBootstrapResult = {
      userId,
      threadsProcessed: 0,
      threadsSkippedBudget: 0,
      threadsSkippedError: 0,
      episodesIngested: 0,
      profileIngested: false,
      estimatedTokensUsed: 0,
      dryRun,
      durationMs: 0,
      errors: [],
    };

    try {
      // Validate Supermemory is configured
      if (!dryRun && !isSupermemoryConfigured()) {
        throw new Error('Supermemory API key not configured. Set SUPERMEMORY_API_KEY env var.');
      }

      if (!dryRun) {
        this.client = getSupermemoryClient();
        
        // Validate API key before proceeding
        logger.info('[SupermemoryBootstrap] Validating API key...');
        try {
          await this.client.validateApiKey();
          logger.info('[SupermemoryBootstrap] ✅ API key validated successfully');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error('[SupermemoryBootstrap] ❌ API key validation failed:', errorMessage);
          throw new Error(
            `Supermemory API key validation failed: ${errorMessage}. ` +
            'Please verify your SUPERMEMORY_API_KEY is correct and active.',
          );
        }
      }

      // Step 1: Initialize Gmail service and get user email
      await this.initializeGmailService(userId);

      // Step 2: Fetch sent emails
      logger.info(`[SupermemoryBootstrap] Step 1: Fetching ${maxSentEmails} sent emails...`);
      const sentEmails = await this.fetchSentEmails(maxSentEmails);
      logger.info(`[SupermemoryBootstrap] Fetched ${sentEmails.length} sent emails`);

      if (sentEmails.length === 0) {
        logger.warn(`[SupermemoryBootstrap] No sent emails found for user ${userId}`);
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Step 3: Dedupe by thread
      logger.info(`[SupermemoryBootstrap] Step 2: Deduping by thread...`);
      const threadGroups = this.groupByThread(sentEmails);
      logger.info(`[SupermemoryBootstrap] Found ${threadGroups.size} unique threads`);

      // Step 4: Prepare threads with full message data
      logger.info(`[SupermemoryBootstrap] Step 3: Fetching full thread data...`);
      const threadsForProcessing = await this.prepareThreadsForProcessing(threadGroups);
      logger.info(`[SupermemoryBootstrap] Prepared ${threadsForProcessing.length} threads for processing`);

      // Step 5: Process threads within budget
      // Strategy: Summarize first, then check budget with actual token usage
      const budgetTracker = createTokenBudgetTracker(budgetTokens);
      const episodeContents: Array<{
        thread: ThreadForProcessing;
        content: ThreadEpisodeContent;
        actualTokens: number;
      }> = [];

      logger.info(`[SupermemoryBootstrap] Step 4: Summarizing threads...`);

      for (const thread of threadsForProcessing) {
        try {
          // Summarize the thread first
          const episodeContent = await summarizeThreadEpisode(thread, this.userEmail);

          // Validate the content
          const validation = validateEpisodeContent(episodeContent);
          if (!validation.valid) {
            logger.warn(
              `[SupermemoryBootstrap] Invalid episode for thread ${thread.threadId}: ${validation.issues.join(', ')}`,
            );
            result.threadsSkippedError += 1;
            result.errors.push({ threadId: thread.threadId, error: validation.issues.join(', ') });
            continue;
          }

          // Calculate actual token usage based on the real summary length
          const actualTokens = budgetTracker.estimateTokensFromChars(
            episodeContent.sent_email_summary.length +
              episodeContent.received_thread_summary.length,
          );

          // Check if we can afford this episode
          if (!budgetTracker.canAfford(actualTokens)) {
            logger.info(
              `[SupermemoryBootstrap] Budget exhausted after ${result.threadsProcessed} threads. Skipping remaining.`,
            );
            result.threadsSkippedBudget = threadsForProcessing.length - result.threadsProcessed;
            break;
          }

          // Record for ingestion
          episodeContents.push({ thread, content: episodeContent, actualTokens });
          result.threadsProcessed += 1;

          // Record token usage
          budgetTracker.recordUsage(actualTokens);

          logger.debug(
            `[SupermemoryBootstrap] Thread ${thread.threadId}: ${actualTokens} tokens (${budgetTracker.usedTokens}/${budgetTokens} used)`,
          );
        } catch (error) {
          logger.error(
            `[SupermemoryBootstrap] Error summarizing thread ${thread.threadId}:`,
            error,
          );
          result.threadsSkippedError += 1;
          result.errors.push({
            threadId: thread.threadId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info(
        `[SupermemoryBootstrap] Summarized ${episodeContents.length} threads (${result.threadsSkippedError} errors, ${result.threadsSkippedBudget} budget skipped)`,
      );

      // Step 6: Upload episodes to Supermemory
      if (!dryRun && episodeContents.length > 0) {
        logger.info(`[SupermemoryBootstrap] Step 5: Uploading ${episodeContents.length} episodes...`);
        result.episodesIngested = await this.uploadEpisodes(episodeContents);
        logger.info(`[SupermemoryBootstrap] Uploaded ${result.episodesIngested} episodes`);
      } else if (dryRun && episodeContents.length > 0) {
        // In dry-run mode, count generated episodes (not uploaded)
        result.episodesIngested = episodeContents.length;
        logger.info(`[SupermemoryBootstrap] [DRY RUN] Generated ${episodeContents.length} episodes (not uploaded)`);
      }

      // Step 7: Fetch unreplied received emails for profile context
      logger.info(`[SupermemoryBootstrap] Step 6a: Fetching unreplied received emails for profile context...`);
      let unrepliedReceivedEmails: Array<{ from: string; subject: string; body: string; snippet: string; date: Date }> = [];
      try {
        const receivedEmailsData = await this.fetchUnrepliedReceivedEmails(300);
        unrepliedReceivedEmails = receivedEmailsData.map((email) => ({
          from: email.from,
          subject: email.subject,
          body: email.body,
          snippet: email.snippet,
          date: email.date,
        }));
        logger.info(`[SupermemoryBootstrap] Fetched ${unrepliedReceivedEmails.length} unreplied received emails for profile context`);
      } catch (error) {
        logger.warn(`[SupermemoryBootstrap] Failed to fetch unreplied received emails, continuing without them:`, error);
        // Continue even if this fails - profile can still be generated from sent emails
      }

      // Step 8: Generate and upload user profile
      logger.info(`[SupermemoryBootstrap] Step 6b: Generating user profile...`);
      const profileContent = await generateUserProfileBootstrap({
        userEmail: this.userEmail,
        sentEmailBodies: sentEmails.map((e) => e.body),
        fromHeaders: sentEmails.map((e) => e.from),
        episodeSamples: episodeContents.map((e) => e.content),
        unrepliedReceivedEmails,
      });

      const profileValidation = validateProfileContent(profileContent);
      if (profileValidation.valid) {
        if (!dryRun) {
          await this.uploadUserProfile(profileContent);
          result.profileIngested = true;
          logger.info(`[SupermemoryBootstrap] ✅ User profile uploaded`);
        } else {
          logger.info(`[SupermemoryBootstrap] [DRY RUN] Would upload user profile`);
        }
      } else {
        logger.warn(
          `[SupermemoryBootstrap] Invalid profile: ${profileValidation.issues.join(', ')}`,
        );
      }

      result.estimatedTokensUsed = budgetTracker.usedTokens;
      result.durationMs = Date.now() - startTime;

      // Include generated content for testing/inspection if requested
      if (includeGeneratedContent) {
        result.generatedContent = {
          episodes: episodeContents.map(({ thread, content, actualTokens }) => ({
            threadId: thread.threadId,
            subject: thread.subject,
            messageCount: thread.messages.length,
            threadStartAt: thread.threadStartAt.toISOString(),
            threadLastAt: thread.threadLastAt.toISOString(),
            targetSentAt: thread.targetSentEmail.date.toISOString(),
            participants: thread.participants,
            content,
            metadata: {
              type: 'thread_episode_v1',
              source: 'gmail',
              userId: this.userId,
              gmailThreadId: thread.threadId,
              targetSentMessageId: thread.targetSentEmail.messageId,
              participants: thread.participants,
              subject: thread.subject,
              threadStartAt: thread.threadStartAt.toISOString(),
              threadLastAt: thread.threadLastAt.toISOString(),
              targetSentAt: thread.targetSentEmail.date.toISOString(),
              messageCount: thread.messages.length,
            },
            actualTokens,
          })),
          profile: profileValidation.valid ? profileContent : null,
          threadFetchStats: { ...this.threadFetchStats },
        };
      }

      logger.info(
        `[SupermemoryBootstrap] ✅ Bootstrap complete for user ${userId} in ${result.durationMs}ms`,
      );
      logger.info(
        `[SupermemoryBootstrap] Summary: ${result.episodesIngested} episodes, ${result.estimatedTokensUsed} tokens, ${result.threadsSkippedError} errors`,
      );

      return result;
    } catch (error) {
      result.durationMs = Date.now() - startTime;
      logger.error(`[SupermemoryBootstrap] ❌ Bootstrap failed for user ${userId}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // Gmail Integration
  // ============================================================================

  private async initializeGmailService(userId: string): Promise<void> {
    const gmailResult = await createGmailServiceForUser({
      userId,
      purpose: 'supermemory:bootstrap',
      requester: 'SupermemoryBootstrapService',
    });

    if (!gmailResult) {
      throw new Error(`No OAuth token found for user ${userId}`);
    }

    this.gmailService = gmailResult.gmail;

    // Get user email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      throw new Error(`User ${userId} not found or has no email`);
    }

    this.userEmail = user.email;
    logger.debug(`[SupermemoryBootstrap] Initialized Gmail for ${this.userEmail}`);
  }

  private async fetchSentEmails(maxResults: number): Promise<EmailData[]> {
    if (!this.gmailService) {
      throw new Error('Gmail service not initialized');
    }

    return this.gmailService.fetchAndParseEmails(maxResults);
  }

  /**
   * Fetch unreplied received emails for user profile context
   * Per profileGenerator.ts requirements:
   * - Excludes PROMOTIONAL category
   * - Includes SOCIAL and UPDATES categories
   * - Only emails that have NOT been replied to
   */
  private async fetchUnrepliedReceivedEmails(maxResults: number): Promise<EmailData[]> {
    if (!this.gmailService) {
      throw new Error('Gmail service not initialized');
    }

    return this.gmailService.fetchUnrepliedReceivedEmails(maxResults);
  }

  // ============================================================================
  // Thread Processing
  // ============================================================================

  /**
   * Group sent emails by Gmail thread ID
   * Returns Map<threadId, EmailData[]> sorted by date within each thread
   */
  private groupByThread(sentEmails: EmailData[]): Map<string, EmailData[]> {
    const groups = new Map<string, EmailData[]>();

    for (const email of sentEmails) {
      const threadId = email.gmailThreadId || email.messageId;
      const existing = groups.get(threadId) || [];
      existing.push(email);
      groups.set(threadId, existing);
    }

    // Sort each group by date (newest first) and identify the target
    for (const [threadId, emails] of groups) {
      emails.sort((a, b) => b.date.getTime() - a.date.getTime());
      groups.set(threadId, emails);
    }

    // Sort threads by most recent sent email first
    const sortedEntries = [...groups.entries()].sort((a, b) => {
      const aLatest = a[1][0]!.date.getTime();
      const bLatest = b[1][0]!.date.getTime();
      return bLatest - aLatest;
    });

    return new Map(sortedEntries);
  }

  /**
   * Prepare threads for processing by fetching full thread data
   */
  private async prepareThreadsForProcessing(
    threadGroups: Map<string, EmailData[]>,
  ): Promise<ThreadForProcessing[]> {
    const threads: ThreadForProcessing[] = [];
    const batchSize = DEFAULT_BOOTSTRAP_CONFIG.BATCH_SIZE;
    const threadIds = [...threadGroups.keys()];
    const rateLimiter = createApiRateLimiter(100); // 100ms between batches

    for (let i = 0; i < threadIds.length; i += batchSize) {
      const batch = threadIds.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (threadId) => {
          try {
            const result = await this.prepareThread(threadId, threadGroups.get(threadId)!);
            if (result) {
              this.threadFetchStats.success += 1;
            } else {
              this.threadFetchStats.empty += 1;
            }
            return result;
          } catch (error) {
            this.threadFetchStats.failed += 1;
            logger.warn(
              `[SupermemoryBootstrap] Failed to prepare thread ${threadId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
            return null;
          }
        }),
      );

      threads.push(...batchResults.filter((t): t is ThreadForProcessing => t !== null));

      // Rate limiting between batches
      if (i + batchSize < threadIds.length) {
        await rateLimiter.wait();
      }
    }

    logger.info(
      `[SupermemoryBootstrap] Thread fetch results: ${this.threadFetchStats.success} success, ${this.threadFetchStats.empty} empty, ${this.threadFetchStats.failed} failed`,
    );

    return threads;
  }

  /**
   * Prepare a single thread for processing
   * Uses Gmail Threads API to fetch complete thread data per SUPERMEMORY.md spec
   */
  private async prepareThread(
    threadId: string,
    sentEmailsInThread: EmailData[],
  ): Promise<ThreadForProcessing | null> {
    if (!this.gmailService) {
      throw new Error('Gmail service not initialized');
    }

    // The target sent email is the latest one (already sorted)
    const targetSentEmail = sentEmailsInThread[0]!;

    // Fetch the full thread using the proper Gmail Threads API
    const fetchResult = await this.fetchThreadMessages(threadId);

    // Handle different fetch outcomes
    if (fetchResult.status === 'error') {
      // API error occurred - throw to be caught by prepareThreadsForProcessing
      throw new Error(fetchResult.error);
    }

    if (fetchResult.status === 'not_found') {
      // Thread not found (404) - fall back to sent emails only
      logger.debug(
        `[SupermemoryBootstrap] Thread ${threadId} not found, using sent emails only`,
      );
      return this.buildThreadFromSentEmails(threadId, sentEmailsInThread);
    }

    if (fetchResult.status === 'empty') {
      // Thread exists but has no messages - fall back to sent emails only
      logger.debug(
        `[SupermemoryBootstrap] Thread ${threadId} is empty, using sent emails only`,
      );
      return this.buildThreadFromSentEmails(threadId, sentEmailsInThread);
    }

    // Successfully fetched thread messages
    const threadMessages = fetchResult.messages;

    // Sort messages chronologically
    threadMessages.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Collect participants
    const fromAddresses = new Set<string>();
    const toAddresses = new Set<string>();
    const ccAddresses = new Set<string>();

    for (const msg of threadMessages) {
      this.extractEmailAddress(msg.from).forEach((a) => fromAddresses.add(a));
      msg.to.forEach((a) => this.extractEmailAddress(a).forEach((e) => toAddresses.add(e)));
      msg.cc.forEach((a) => this.extractEmailAddress(a).forEach((e) => ccAddresses.add(e)));
    }

    // Find the target sent email in the full thread
    const targetInThread =
      threadMessages.find((m) => m.messageId === targetSentEmail.messageId) ||
      this.convertToEmailForSummary(targetSentEmail);

    return {
      threadId,
      targetSentEmail: targetInThread,
      messages: threadMessages,
      subject: targetSentEmail.subject,
      participants: {
        fromAddresses: [...fromAddresses],
        toAddresses: [...toAddresses],
        ccAddresses: [...ccAddresses],
      },
      threadStartAt: threadMessages[0]!.date,
      threadLastAt: threadMessages[threadMessages.length - 1]!.date,
    };
  }

  /**
   * Fetch all messages in a thread using Gmail Threads API
   * Per SUPERMEMORY.md specification
   *
   * @returns Result object with status and messages/error
   */
  private async fetchThreadMessages(threadId: string): Promise<
    | { status: 'success'; messages: EmailForSummary[] }
    | { status: 'empty'; messages: EmailForSummary[] }
    | { status: 'not_found'; error: string }
    | { status: 'error'; error: string }
  > {
    if (!this.gmailService) {
      return { status: 'error', error: 'Gmail service not initialized' };
    }

    try {
      // Use the new fetchFullThread method that implements the spec
      const emails = await this.gmailService.fetchFullThread(threadId);

      if (emails === null) {
        // 404 - thread not found
        return { status: 'not_found', error: 'Thread not found (404)' };
      }

      if (emails.length === 0) {
        // Thread exists but has no messages
        return { status: 'empty', messages: [] };
      }

      // Successfully fetched thread with messages
      const messages = emails.map((email) => this.convertToEmailForSummary(email));
      return { status: 'success', messages };
    } catch (error) {
      // Non-404 errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[SupermemoryBootstrap] Error fetching thread ${threadId}:`, error);
      return { status: 'error', error: errorMessage };
    }
  }

  /**
   * Build a thread from only sent emails (fallback)
   */
  private buildThreadFromSentEmails(
    threadId: string,
    sentEmails: EmailData[],
  ): ThreadForProcessing {
    const messages = sentEmails.map((e) => this.convertToEmailForSummary(e));
    messages.sort((a, b) => a.date.getTime() - b.date.getTime());

    const fromAddresses = new Set<string>();
    const toAddresses = new Set<string>();
    const ccAddresses = new Set<string>();

    for (const msg of messages) {
      this.extractEmailAddress(msg.from).forEach((a) => fromAddresses.add(a));
      msg.to.forEach((a) => this.extractEmailAddress(a).forEach((e) => toAddresses.add(e)));
      msg.cc.forEach((a) => this.extractEmailAddress(a).forEach((e) => ccAddresses.add(e)));
    }

    return {
      threadId,
      targetSentEmail: messages[messages.length - 1]!,
      messages,
      subject: sentEmails[0]!.subject,
      participants: {
        fromAddresses: [...fromAddresses],
        toAddresses: [...toAddresses],
        ccAddresses: [...ccAddresses],
      },
      threadStartAt: messages[0]!.date,
      threadLastAt: messages[messages.length - 1]!.date,
    };
  }

  /**
   * Convert EmailData to EmailForSummary with pruned body
   */
  private convertToEmailForSummary(email: EmailData): EmailForSummary {
    return {
      messageId: email.messageId,
      threadId: email.gmailThreadId || email.messageId,
      from: email.from,
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      body: pruneEmailBodyForSummary(email.body),
      date: email.date,
      isSent: email.isSent,
    };
  }

  /**
   * Extract email address from a string like "Name <email@domain.com>"
   */
  private extractEmailAddress(addressString: string): string[] {
    if (!addressString) return [];

    const match = addressString.match(/<([^>]+)>/);
    if (match && match[1]) {
      return [match[1].toLowerCase()];
    }

    if (addressString.includes('@')) {
      return [addressString.toLowerCase()];
    }

    return [];
  }

  // ============================================================================
  // Supermemory Upload
  // ============================================================================

  /**
   * Upload thread episodes to Supermemory
   */
  private async uploadEpisodes(
    episodes: Array<{
      thread: ThreadForProcessing;
      content: ThreadEpisodeContent;
      actualTokens: number;
    }>,
  ): Promise<number> {
    if (!this.client) {
      logger.warn('[SupermemoryBootstrap] Client not initialized, skipping upload');
      return 0;
    }

    let successCount = 0;
    let authErrorCount = 0;
    const MAX_AUTH_ERRORS = 3; // Stop after 3 consecutive auth errors

    for (const { thread, content } of episodes) {
      try {
        const customId = this.buildEpisodeCustomId(thread.threadId);

        // Check if document already exists (idempotency)
        const exists = await this.client.documentExists(customId);
        if (exists) {
          logger.debug(`[SupermemoryBootstrap] Episode ${customId} already exists, skipping`);
          successCount += 1;
          authErrorCount = 0; // Reset auth error count on success
          continue;
        }

        // Flatten metadata to comply with Supermemory requirements:
        // Metadata values must be strings, numbers, or booleans only (no nested objects/arrays)
        const metadata: Record<string, string | number | boolean> = {
          type: 'thread_episode_v1',
          source: 'gmail',
          userId: this.userId,
          gmailThreadId: thread.threadId,
          targetSentMessageId: thread.targetSentEmail.messageId,
          // Flatten participants arrays to comma-separated strings
          participants_from: thread.participants.fromAddresses.join(','),
          participants_to: thread.participants.toAddresses.join(','),
          participants_cc: thread.participants.ccAddresses.join(','),
          subject: thread.subject,
          threadStartAt: thread.threadStartAt.toISOString(),
          threadLastAt: thread.threadLastAt.toISOString(),
          targetSentAt: thread.targetSentEmail.date.toISOString(),
          messageCount: thread.messages.length,
        };

        await this.client.addDocument({
          content: JSON.stringify(content),
          customId,
          metadata,
          containerTags: [this.userId],
          userId: this.userId,
        });

        successCount += 1;
        authErrorCount = 0; // Reset auth error count on success
        logger.debug(`[SupermemoryBootstrap] Uploaded episode ${customId}`);
      } catch (error) {
        // Check if this is an authentication error
        const isAuthError =
          error instanceof Error &&
          (error.message.includes('401') || error.message.includes('Unauthorized'));

        if (isAuthError) {
          authErrorCount += 1;
          logger.error(
            `[SupermemoryBootstrap] Authentication error (${authErrorCount}/${MAX_AUTH_ERRORS}) for thread ${thread.threadId}:`,
            error,
          );

          // Stop processing if we hit too many auth errors
          if (authErrorCount >= MAX_AUTH_ERRORS) {
            logger.error(
              `[SupermemoryBootstrap] Stopping upload after ${MAX_AUTH_ERRORS} consecutive authentication errors. ` +
                'Please verify your SUPERMEMORY_API_KEY is valid and active.',
            );
            throw new Error(
              `Supermemory API authentication failed after ${MAX_AUTH_ERRORS} attempts. ` +
                'Please verify your SUPERMEMORY_API_KEY is correct and active.',
            );
          }
        } else {
          // Non-auth errors: log and continue
          logger.error(
            `[SupermemoryBootstrap] Failed to upload episode for thread ${thread.threadId}:`,
            error,
          );
        }
      }
    }

    return successCount;
  }

  /**
   * Upload user profile to Supermemory
   */
  private async uploadUserProfile(profile: any): Promise<void> {
    if (!this.client) {
      logger.warn('[SupermemoryBootstrap] Client not initialized, skipping profile upload');
      return;
    }

    const customId = this.buildProfileCustomId();

    // Check if profile already exists (idempotency) - delete and recreate for updates
    const exists = await this.client.documentExists(customId);
    if (exists) {
      logger.debug(`[SupermemoryBootstrap] Profile ${customId} already exists, deleting for update`);
      await this.client.deleteDocument(customId);
    }

    const metadata: UserProfileBootstrapMetadata = {
      type: 'user_profile_bootstrap_v1',
      source: 'gmail',
      userId: this.userId,
      generatorModel: DEFAULT_BOOTSTRAP_CONFIG.PROFILE_GENERATOR_MODEL,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
    };

    await this.client.addDocument({
      content: profileContentToDocumentString(profile),
      customId,
      metadata: metadata as unknown as Record<string, unknown>,
      containerTags: [this.userId],
      userId: this.userId,
    });
  }

  // ============================================================================
  // ID Helpers
  // ============================================================================

  private buildEpisodeCustomId(threadId: string): string {
    return `u-${this.userId}-t-${threadId}-episode-v1`;
  }

  private buildProfileCustomId(): string {
    return `u-${this.userId}-profile-bootstrap-v1`;
  }
}

// ============================================================================
// Convenience Export
// ============================================================================

/**
 * Run the Supermemory bootstrap for a user
 * This is the main entry point called by the worker
 */
export async function runSupermemoryBootstrap(
  jobData: SupermemoryBootstrapJobData,
): Promise<SupermemoryBootstrapResult> {
  const service = new SupermemoryBootstrapService();
  return service.execute(jobData);
}

