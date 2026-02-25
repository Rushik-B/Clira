// Load environment variables from .env files FIRST, before any other imports
// This ensures environment variables are available when modules like prisma are loaded
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env and .env.local files
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local') });

import { Worker, Job, JobProgress } from 'bullmq';
import redisConnection from './lib/services/utils/redis';
import { 
  OnboardingJobData, 
  ReplyGenerationJobData, 
  MasterPromptJobData, 
  BatchSortJobData,
  ModelRetrainJobData,
  CreateGmailLabelsJobData,
  // New folder generation job types
  FolderGenerationJobData,
  EmailMappingJobData,
  EmailLearningJobData,
  EmailCategorizationJobData,
  FastOnboardingMappingJobData,
  FastOnboardingProposalJobData,
  SupermemoryBootstrapJobData,
  ReminderNotificationJobData
} from './lib/services/utils/queues';
import { MasterPromptGeneratorService } from './lib/ml/masterPromptGenerator';
import { ReplyGeneratorService } from './lib/services/core/replyGenerator';
import { GmailService } from './lib/email/gmail';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { BatchSortingWorker } from './lib/services/batch/batchSortingWorker';
import { FolderGenerationWorkerService } from './lib/services/onboarding-services/folderGenerationWorkerService';
import { FastOnboardingService } from './lib/services/onboarding-services/fastOnboardingService';
// LabelOnboardingService removed - functionality covered by DefaultFoldersService
import { EmailCategorizationService } from './lib/services/onboarding-services/emailCategorizationService';
import {
  runSupermemoryBootstrap,
  isSupermemoryConfigured,
  writeSupermemoryWorkerHeartbeat,
  enqueueSupermemoryBootstrap,
} from './lib/services/supermemory';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { encryptEmailContent, decryptEmailContent } from '@/lib/security/emailCrypto';
// AI queue label removed: no longer creating/applying a dedicated Gmail label
import { normalizeGmailLabelColor } from '@/lib/gmail/labelColors';
import { triggerReminderNotification, markReminderMissed } from '@/lib/services/reminderNotificationService';
import {
  isTelegramEnabled,
  startTelegramMonitor,
  stopTelegramMonitor,
  processTelegramMessage,
  type TelegramInboundMessage,
  writeTelegramWorkerHeartbeat,
} from '@/lib/services/telegram';

console.log('🚀 Background Worker process started...');
console.log('🔧 Environment variables loaded:');
console.log(`  - FEATURE_FLAG_ALWAYS_ON_SORTING: ${process.env.FEATURE_FLAG_ALWAYS_ON_SORTING}`);
console.log(`  - FEATURE_FLAG_FOLDER_MANAGEMENT: ${process.env.FEATURE_FLAG_FOLDER_MANAGEMENT}`);
console.log(`  - FEATURE_FLAG_PER_EMAIL_LLM: ${process.env.FEATURE_FLAG_PER_EMAIL_LLM}`);
console.log('🧠 Supermemory worker enabled in main process:');
console.log(`  - SUPERMEMORY_API_KEY configured: ${isSupermemoryConfigured()}`);
console.log(`  - NODE_ENV: ${process.env.NODE_ENV}`);

// Track active workers for graceful shutdown
const workers: Worker[] = [];
let heartbeatInterval: NodeJS.Timeout | null = null;
let telegramMonitorStarted = false;
const DEFAULT_TELEGRAM_PROCESS_CONCURRENCY = 7;
const TELEGRAM_SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;
const TELEGRAM_SHUTDOWN_DRAIN_POLL_MS = 50;
const telegramMessageQueue: TelegramInboundMessage[] = [];
const telegramInFlightTasks = new Set<Promise<void>>();
let telegramInFlightCount = 0;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const telegramProcessConcurrency = Math.min(
  parsePositiveIntEnv('TELEGRAM_PROCESS_CONCURRENCY', DEFAULT_TELEGRAM_PROCESS_CONCURRENCY),
  16,
);

function trackTelegramTask(task: Promise<void>): void {
  telegramInFlightTasks.add(task);
  task.finally(() => {
    telegramInFlightTasks.delete(task);
  });
}

function dispatchQueuedTelegramMessages(): void {
  while (
    telegramInFlightCount < telegramProcessConcurrency &&
    telegramMessageQueue.length > 0
  ) {
    const message = telegramMessageQueue.shift();
    if (!message) continue;
    telegramInFlightCount += 1;

    const task = (async () => {
      try {
        await processTelegramMessage(message);
      } catch (error) {
        logger.error('Error processing Telegram message', {
          message,
          error,
        });
      } finally {
        telegramInFlightCount = Math.max(0, telegramInFlightCount - 1);
        dispatchQueuedTelegramMessages();
      }
    })();

    trackTelegramTask(task);
  }
}

function enqueueTelegramMessageForProcessing(message: TelegramInboundMessage): void {
  telegramMessageQueue.push(message);
  dispatchQueuedTelegramMessages();
}

async function drainTelegramProcessingQueue(params?: { timeoutMs?: number }): Promise<void> {
  const timeoutMs = params?.timeoutMs ?? TELEGRAM_SHUTDOWN_DRAIN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (
    (telegramMessageQueue.length > 0 || telegramInFlightCount > 0 || telegramInFlightTasks.size > 0) &&
    Date.now() < deadline
  ) {
    if (telegramInFlightTasks.size > 0) {
      await Promise.race([
        Promise.allSettled(Array.from(telegramInFlightTasks)),
        new Promise((resolve) => setTimeout(resolve, TELEGRAM_SHUTDOWN_DRAIN_POLL_MS)),
      ]);
    } else {
      await new Promise((resolve) => setTimeout(resolve, TELEGRAM_SHUTDOWN_DRAIN_POLL_MS));
    }
  }

  if (telegramMessageQueue.length > 0 || telegramInFlightCount > 0) {
    logger.warn('[Telegram] Drain timeout during shutdown; dropping pending work', {
      queued: telegramMessageQueue.length,
      inFlight: telegramInFlightCount,
      timeoutMs,
    });
    telegramMessageQueue.length = 0;
  }
}

// --- Onboarding Worker ---
// IMPORTANT: Queue name must match the producer in queues.ts ('user-onboarding')
const onboardingWorker = new Worker<OnboardingJobData>('user-onboarding', async (job: any) => {
  const { userId } = job.data;
  console.log(`[ONBOARD START] Processing onboarding for user: ${userId} (Job ID: ${job.id})`);

  try {
    // Use Redis-based locking to prevent race conditions
    const lockKey = `onboarding-lock:${userId}`;
    const lockValue = `job-${job.id}`;
    // LLM calls can exceed 5 minutes in production; start with a generous TTL
    const lockTTL = 1200; // 20 minutes
    
    // Try to acquire lock
    const lockAcquired = await redisConnection.set(lockKey, lockValue, 'EX', lockTTL, 'NX');
    
    if (!lockAcquired) {
      console.log(`[ONBOARD] Another onboarding job is already running for user ${userId}, skipping`);
      return { skipped: true, reason: 'Another job already running' };
    }

    // Handle used across try/finally
    let refreshHandle: ReturnType<typeof setInterval> | undefined;
    try {
      // Periodically refresh the lock TTL while the job is active to avoid expiry mid-run
      const refreshIntervalMs = 60_000; // refresh once a minute
      refreshHandle = setInterval(async () => {
        try {
          // Only extend if our job still owns the lock
          const current = await redisConnection.get(lockKey);
          if (current === lockValue) {
            await redisConnection.expire(lockKey, lockTTL);
          }
        } catch (e) {
          console.warn(`[ONBOARD] Lock keepalive failed for user ${userId}:`, e);
        }
      }, refreshIntervalMs);

      // Get user with all generation flags
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          masterPromptGenerated: true,
          labelingOnboardingGenerated: true
        }
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      console.log(`[ONBOARD] User ${userId} status: master=${user.masterPromptGenerated}, labeling=${user.labelingOnboardingGenerated}`);

      const generator = new MasterPromptGeneratorService();

      // SECURE STEP 1: Fetch emails in-memory (no database storage)
      console.log(`[ONBOARD] 🔒 Fetching emails securely in-memory for user ${userId}...`);
      const emailData = await fetchAndProcessEmailsSecurely(userId);
      console.log(`[ONBOARD] ✅ Processed ${emailData.sentEmails.length} sent emails and ${emailData.inboxEmails.length} inbox emails in-memory (not stored in database)`);
      job.updateProgress(25);

      // Step 2: Generate Master Prompt using in-memory emails
      if (!user.masterPromptGenerated) {
        console.log(`[ONBOARD] 🧠 Generating Master Prompt using in-memory emails for user ${userId}...`);
        try {
          await generator.generateAndSaveMasterPrompt(userId, emailData.sentEmails);
          console.log(`[ONBOARD] ✅ Master Prompt generated successfully for user ${userId}`);
        } catch (error) {
          console.error(`[ONBOARD] ❌ Master Prompt generation failed for user ${userId}:`, error);
          throw error; // Let BullMQ retry
        }
      } else {
        console.log(`[ONBOARD] ✅ Master Prompt already generated for user ${userId}`);
      }
      job.updateProgress(50);


      // Simplified flow: Only generate the 3 core prompts, then stop
      // The frontend will handle redirecting to /onboarding-test-flow
      job.updateProgress(100);
      
      console.log(`[ONBOARD COMPLETE] 🎉 Core prompts generated for user: ${userId}`);

      // Enqueue Supermemory bootstrap once core onboarding finishes.
      // This provides a reliable trigger even if the frontend doesn't hit the onboarding completion route.
      try {
        const supermemoryJobId = await enqueueSupermemoryBootstrap(userId, {
          delayMs: 90_000,
        });

        if (supermemoryJobId) {
          console.log(
            `🧠 [ONBOARD] Enqueued Supermemory bootstrap job ${supermemoryJobId} for user ${userId} (starts in 90s)`,
          );
        } else {
          console.log(
            `⚠️ [ONBOARD] Supermemory bootstrap not enqueued for user ${userId} (missing SUPERMEMORY_API_KEY)`,
          );
        }
      } catch (error) {
        console.warn(`⚠️ [ONBOARD] Failed to enqueue Supermemory bootstrap for user ${userId}:`, error);
      }
      
    } finally {
      // Stop refreshing the lock
      try { if (refreshHandle) clearInterval(refreshHandle); } catch {}
      
      // Release the lock
      const currentLockValue = await redisConnection.get(lockKey);
      if (currentLockValue === lockValue) {
        await redisConnection.del(lockKey);
        console.log(`[ONBOARD] Released lock for user ${userId}`);
      }
    }
    
  } catch (error) {
    console.error(`[ONBOARD FAILED] Onboarding failed for user ${userId}:`, error);
    // This makes BullMQ retry the job according to our backoff strategy
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 2 // Process up to 2 onboarding jobs simultaneously
});

// --- Worker for Master Prompt Generation ---
const masterPromptWorker = new Worker<MasterPromptJobData>('master-prompt-generation', async (job: any) => {
  const { userId } = job.data;
  console.log(`[MASTER START] Generating Master Prompt for user: ${userId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);
    
    const generator = new MasterPromptGeneratorService();
    const result = await generator.generateAndSaveMasterPrompt(userId);
    
    job.updateProgress(100);
    console.log(`[MASTER COMPLETE] Master Prompt v${result.version} generated for user ${userId} with ${result.confidence}% confidence`);
    
    return result;
  } catch (error) {
    console.error(`[MASTER FAILED] Master Prompt generation failed for user ${userId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 3 // Process up to 3 master prompt jobs simultaneously
});


// --- Worker for Generating Email Replies ---
const replyWorker = new Worker<ReplyGenerationJobData>('reply-generation', async (job: any) => {
  const { emailId, userId } = job.data;
  console.log(`[REPLY START] Generating reply for email: ${emailId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);
    
    // Get the email
    const emailRecord = await prisma.email.findUnique({
      where: { id: emailId },
      include: { thread: true }
    });

    if (!emailRecord) {
      throw new Error(`Email ${emailId} not found`);
    }

    const email = await decryptEmailContent({ email: emailRecord, userId });

    // Verify the email belongs to the user
    if (email.thread.userId !== userId) {
      throw new Error(`Email ${emailId} does not belong to user ${userId}`);
    }

    job.updateProgress(30);

    // Generate the reply
    const replyGenerator = new ReplyGeneratorService();
    const replyResult = await replyGenerator.generateReply({
      userId: userId,
      mailboxId: email.mailboxId ?? undefined,
      gmailMessageId: email.messageId, // Gmail message ID for label application
      currentLabelIds: [], // Labels not stored in DB; will be fetched by planner if needed
      incomingEmail: {
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        date: email.createdAt,
        threadId: email.threadId // Add thread ID for conversation context
      }
    });

    job.updateProgress(80);

    // Store the generated reply - with validation
    if (!replyResult.reply || replyResult.reply.trim().length === 0) {
      console.error(`❌ Generated reply is empty for email ${emailId}!`);
      console.error(`❌ Reply result:`, replyResult);
      throw new Error(`Generated reply is empty for email ${emailId}`);
    }
    // Additional guard: block error-style/apology drafts and non-positive confidence
    const trimmed = replyResult.reply.trim();
    const isApology = /unable to generate a reply|please try again later|system is still setting up/i.test(trimmed);
    if (replyResult.confidence <= 0 || isApology) {
      throw new Error(
        `ReplyGenerationFailed: ${replyResult.confidence <= 0 ? 'non-positive confidence' : 'error-style draft text'}`
      );
    }

    let gmailDraftId: string | null = null;

    if (process.env.FEATURE_FLAG_GMAIL_DRAFTS === 'false') {
      console.warn(`🚫 Gmail drafts feature flag disabled; aborting draft persistence for email ${emailId}`);
    } else {
      try {
        const gmailResult = await createGmailServiceForUser({
          userId,
          mailboxId: emailRecord.mailboxId ?? undefined, // Multi-inbox: use email's mailbox
          purpose: 'worker:reply-generate-draft',
          requester: 'worker.replyGeneration',
        });

        if (!gmailResult) {
          throw new Error(`No OAuth token found for user ${userId}, cannot create Gmail draft`);
        }

        // No dedicated AI label tagging on source message

          const draftResult = await gmailResult.gmail.createDraftReply({
          to: email.from,
          cc: replyResult.ccRecipients || [],
          subject: email.subject.startsWith('Re: ') ? email.subject : `Re: ${email.subject}`,
          body: trimmed,
          inReplyTo: email.rfc2822MessageId || undefined,
          references: email.references || undefined,
          threadId: email.gmailThreadId || undefined,
            // No dedicated AI label on drafts
            labelIds: undefined,
        });

        gmailDraftId = draftResult.draftId;
        console.log(`✅ Gmail draft created in worker: ${gmailDraftId} for email ${emailId}`);
      } catch (draftError) {
        console.warn(`⚠️ Gmail draft creation failed in worker for email ${emailId}:`, draftError);
      }
    }

    if (!gmailDraftId) {
      throw new Error(`Failed to create Gmail draft for email ${emailId}`);
    }

    await prisma.generatedDraft.upsert({
      where: { emailId },
      update: {
        gmailDraftId,
        confidenceScore: replyResult.confidence,
        createdBy: 'AI',
        updatedAt: new Date(),
      },
      create: {
        emailId,
        gmailDraftId,
        confidenceScore: replyResult.confidence,
        createdBy: 'AI',
      },
    });

    // Persist the concise email summary for UI (reuse Email.snippet)
    if (replyResult.contextualInfo?.emailSummary) {
      try {
        const snippetUpdate = await encryptEmailContent({
          userId,
          data: { snippet: replyResult.contextualInfo.emailSummary },
        });
        await prisma.email.update({
          where: { id: emailId },
          data: snippetUpdate,
        });
      } catch (e) {
        console.warn(`⚠️ Failed to store email summary to snippet for email ${emailId}:`, e);
      }
    }

    job.updateProgress(100);
    console.log(`[REPLY COMPLETE] Reply generated for email ${emailId} with ${replyResult.confidence}% confidence`);
    
    return {
      emailId,
      confidence: replyResult.confidence,
      replyPreview: replyResult.reply.substring(0, 150) + (replyResult.reply.length > 150 ? '...' : '')
    };
  } catch (error) {
    console.error(`[REPLY FAILED] Reply generation failed for email ${emailId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 5 // Process up to 5 reply jobs simultaneously
});

// --- Worker for Reminder Notifications ---
const reminderNotificationWorker = new Worker<ReminderNotificationJobData>(
  'reminder-notification',
  async (job: Job<ReminderNotificationJobData>) => {
    const { reminderId, userId } = job.data;
    console.log(`[REMINDER NOTIFY START] reminder=${reminderId} user=${userId} (Job ID: ${job.id})`);

    try {
      await triggerReminderNotification(job.data);
      console.log(`[REMINDER NOTIFY COMPLETE] reminder=${reminderId} (Job ID: ${job.id})`);
    } catch (error) {
      console.error(`[REMINDER NOTIFY FAILED] reminder=${reminderId} (Job ID: ${job.id})`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

reminderNotificationWorker.on('failed', async (job, error) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  const attemptsMade = job.attemptsMade ?? 0;
  if (attemptsMade < attempts) {
    console.warn(
      `[REMINDER NOTIFY RETRY] reminder=${job.data.reminderId} attempt=${attemptsMade}/${attempts}`,
    );
    return;
  }

  const reason = error instanceof Error ? error.message : 'delivery-failed';
  await markReminderMissed({
    reminderId: job.data.reminderId,
    userId: job.data.userId,
    reason,
  });
});

// --- Worker for Creating Gmail Labels & Fast Onboarding Mapping ---
const folderWorkerService = new FolderGenerationWorkerService();

type EmailJobData = CreateGmailLabelsJobData | FastOnboardingMappingJobData;

interface FolderEmailPayload {
  id: string;
  name: string;
  color?: string;
  emails: Array<{
    id?: string;
    subject?: string;
    from?: string;
    originalData?: {
      gmailMessageId?: string;
      emailAddress?: string;
    };
  }>;
}

const normalizeLabelName = (name?: string) => (name || '').trim().replace(/\s+/g, ' ').toLowerCase();

const persistGmailLabelId = async (labelId: string, gmailLabelId: string, color?: string) => {
  try {
    await prisma.label.update({
      where: { id: labelId },
      data: {
        gmailLabelId,
        ...(color ? { color } : {}),
      },
    });
  } catch (error) {
    console.error(`[GMAIL LABELS] Failed to persist Gmail label ID for label ${labelId}:`, error);
  }
};

async function applyLabelsWithGmailService(
  job: Job<EmailJobData>,
  userId: string,
  gmailService: GmailService,
  folders: FolderEmailPayload[],
  purpose: string
) {
  console.log(`[GMAIL LABELS START] Applying labels for user ${userId} via ${purpose} (Job ID: ${job.id})`);
  job.updateProgress(5);

  const extractEmailAddress = (addressString?: string): string | null => {
    if (!addressString) return null;
    const match = addressString.match(/<([^>]+)>/);
    const candidate = (match ? match[1] : addressString).trim();
    return candidate.includes('@') ? candidate.toLowerCase() : null;
  };

  let senderToMessageIds = new Map<string, string[]>();
  try {
    const inboxEmails = await gmailService.fetchInboxEmailsSecurely(500);
    for (const inboxEmail of inboxEmails) {
      const fromEmail = extractEmailAddress(inboxEmail.from);
      if (!fromEmail || !inboxEmail.messageId) continue;
      const list = senderToMessageIds.get(fromEmail) || [];
      list.push(inboxEmail.messageId);
      senderToMessageIds.set(fromEmail, list);
    }
    console.log(`[GMAIL LABELS] Prepared sender-to-messageId map for ${senderToMessageIds.size} senders`);
  } catch (prefetchErr) {
    console.warn(`[GMAIL LABELS] Warning: failed to prefetch inbox emails.`, prefetchErr);
    senderToMessageIds = new Map();
  }

  const labelMap = new Map<string, string>();
  for (const folder of folders) {
    const requestedName = (folder?.name ?? '').toString();
    console.log(`[GMAIL LABELS] Ensuring label exists for ${requestedName}`);
    const { backgroundColor, textColor } = normalizeGmailLabelColor(folder.color);

    try {
      const labelId = await gmailService.createLabel(
        requestedName,
        'labelShow',
        'show',
        backgroundColor,
        textColor
      );
      labelMap.set(folder.id, labelId);
      await persistGmailLabelId(folder.id, labelId, backgroundColor);
      continue;
    } catch (err: any) {
      console.log(`[GMAIL LABELS] Label "${requestedName}" may already exist. Resolving...`);
      try {
        const labels = await gmailService.getLabels();
        const targetNorm = normalizeLabelName(requestedName);
        let existing = labels.find(l => normalizeLabelName(l.name) === targetNorm);
        if (!existing) {
          existing = labels.find(l => normalizeLabelName(l.name.split('/').pop()) === targetNorm);
        }
        if (existing?.id) {
          labelMap.set(folder.id, existing.id);
          await persistGmailLabelId(folder.id, existing.id, existing.backgroundColor);
          continue;
        }
        const fallbackName = `Clira/${requestedName.trim()}`;
        const fallbackId = await gmailService.createLabel(
          fallbackName,
          'labelShow',
          'show',
          backgroundColor,
          textColor
        );
        labelMap.set(folder.id, fallbackId);
        await persistGmailLabelId(folder.id, fallbackId, backgroundColor);
      } catch (lookupErr: any) {
        console.error(`[GMAIL LABELS] Failed to resolve label for "${requestedName}":`, lookupErr?.message || lookupErr);
      }
    }
  }

  job.updateProgress(40);

  let emailsProcessed = 0;
  let emailsLabeled = 0;
  const labeledMessageIds = new Set<string>();
  const APPLY_CONCURRENCY = 8;
  const failedToApply: Array<{ id: string; labelId: string }> = [];

  for (const folder of folders) {
    const labelId = labelMap.get(folder.id);
    if (!labelId) {
      console.log(`[GMAIL LABELS] No label ID found for folder ${folder.name}, skipping`);
      continue;
    }
    if (!folder.emails || folder.emails.length === 0) {
      console.log(`[GMAIL LABELS] No emails queued for folder ${folder.name}, skipping`);
      continue;
    }

    console.log(`[GMAIL LABELS] Processing ${folder.emails.length} emails for folder ${folder.name}`);
    const idsToLabel: string[] = [];

    for (const email of folder.emails) {
      emailsProcessed++;
      const candidateId: unknown = email?.originalData?.gmailMessageId;
      const validGmailId = typeof candidateId === 'string' && /^[A-Za-z0-9_\-]{8,}$/.test(candidateId) ? candidateId : null;
      if (validGmailId) {
        idsToLabel.push(validGmailId);
        continue;
      }

      const senderEmail = email?.originalData?.emailAddress
        ? email.originalData.emailAddress.toLowerCase()
        : extractEmailAddress(email?.from);
      if (!senderEmail) continue;

      const subject = email?.subject;
      let resolvedId: string | null = null;
      try {
        if (subject && subject.trim().length > 0) {
          const escapeQuotes = (s: string) => s.replace(/"/g, '\\"');
          const q = `from:${senderEmail} subject:\"${escapeQuotes(subject.trim())}\" in:inbox`;
          const found = await gmailService.searchEmails(q, 1);
          if (found && found.length > 0 && typeof found[0].messageId === 'string') {
            resolvedId = found[0].messageId;
          }
        }
      } catch (searchErr) {
        console.warn(`[GMAIL LABELS] Subject search failed for sender ${senderEmail}`, searchErr);
      }

      if (resolvedId) {
        idsToLabel.push(resolvedId);
      } else {
        const inboxIds = senderToMessageIds.get(senderEmail) || [];
        if (inboxIds.length > 0) {
          idsToLabel.push(inboxIds[0]);
        }
      }
    }

    const uniqueIds = Array.from(new Set(idsToLabel)).filter(id => !labeledMessageIds.has(id));
    for (let i = 0; i < uniqueIds.length; i += APPLY_CONCURRENCY) {
      const batch = uniqueIds.slice(i, i + APPLY_CONCURRENCY);
      await Promise.all(batch.map(async (gmailMessageId) => {
        try {
          if (labeledMessageIds.has(gmailMessageId)) return;
          await gmailService.addLabelToEmail(gmailMessageId, labelId);
          labeledMessageIds.add(gmailMessageId);
          emailsLabeled++;
        } catch (err: any) {
          if (err?.status !== 403) {
            console.error(`Failed to apply label to email ${gmailMessageId}:`, err);
            failedToApply.push({ id: gmailMessageId, labelId });
          }
        }
      }));
      if (i + APPLY_CONCURRENCY < uniqueIds.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  if (failedToApply.length > 0) {
    console.log(`[GMAIL LABELS] Retry pass for ${failedToApply.length} failed messages`);
    const toRetry = Array.from(new Set(failedToApply.map(f => `${f.id}::${f.labelId}`)))
      .map(key => ({ id: key.split('::')[0]!, labelId: key.split('::')[1]! }));

    for (let i = 0; i < toRetry.length; i += 5) {
      const batch = toRetry.slice(i, i + 5);
      await Promise.all(batch.map(async ({ id, labelId }) => {
        try {
          if (labeledMessageIds.has(id)) return;
          await gmailService.addLabelToEmail(id, labelId);
          labeledMessageIds.add(id);
          emailsLabeled++;
        } catch {}
      }));
      if (i + 5 < toRetry.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  job.updateProgress(100);
  console.log(`[GMAIL LABELS COMPLETE] Created ${labelMap.size} labels and applied them to ${emailsLabeled}/${emailsProcessed} emails for user ${userId}`);
  return { labelsCreated: labelMap.size, emailsProcessed, emailsLabeled };
}

async function processCreateGmailLabelsJob(job: Job<CreateGmailLabelsJobData>) {
  const { userId, folders } = job.data;
  if (!folders || folders.length === 0) {
    console.log(`[EMAIL-JOBS WORKER] No folders provided for user ${userId}, skipping`);
    return;
  }

  const gmailResult = await createGmailServiceForUser({
    userId,
    purpose: 'worker:create-gmail-labels',
    requester: 'worker.createGmailLabels',
  });

  if (!gmailResult) {
    throw new Error(`No OAuth token found for user ${userId}`);
  }

  await applyLabelsWithGmailService(job, userId, gmailResult.gmail, folders, 'create-gmail-labels');
}

async function processFastOnboardingMappingJob(job: Job<FastOnboardingMappingJobData>) {
  const { userId, folders } = job.data;
  if (!folders || folders.length === 0) {
    console.log(`[FAST ONBOARDING MAPPING] No folders provided for user ${userId}, skipping`);
    return;
  }

  job.updateProgress(5);

  const gmailResult = await createGmailServiceForUser({
    userId,
    purpose: 'worker:fast-onboarding-mapping',
    requester: 'worker.fastOnboardingMapping',
  });

  if (!gmailResult) {
    throw new Error(`No OAuth token found for user ${userId}`);
  }

  const gmailService = gmailResult.gmail;
  const mapping = await folderWorkerService.generateFastMappingAssignments(
    userId,
    gmailService,
    folders.map(folder => ({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      metaPrompt: folder.metaPrompt,
      color: folder.color,
    }))
  );

  job.updateProgress(35);

  const emailIndex = new Map(
    mapping.mappingEmails.map(email => [email.messageId, email])
  );

  const folderPayload: FolderEmailPayload[] = folders.map(folder => ({
    id: folder.id,
    name: folder.name,
    color: folder.color,
    emails: [],
  }));

  const folderById = new Map(folderPayload.map(item => [item.id, item]));

  for (const suggestion of mapping.mappingResult.mappingSuggestions) {
    if (!suggestion.messageId) continue;
    const bucket = folderById.get(suggestion.suggestedFolderId);
    if (!bucket) continue;
    const email = emailIndex.get(suggestion.messageId);
    bucket.emails.push({
      id: suggestion.messageId,
      subject: email?.subject,
      from: email?.from,
      originalData: {
        gmailMessageId: suggestion.messageId,
        emailAddress: email?.from,
      },
    });
  }

  await applyLabelsWithGmailService(job, userId, gmailService, folderPayload, 'fast-onboarding-mapping');
}

const emailJobsWorker = new Worker<CreateGmailLabelsJobData | FastOnboardingMappingJobData>('email-jobs', async (job: Job<any>) => {
  console.log(`[EMAIL-JOBS WORKER] Received job: ${job.name} (ID: ${job.id})`);
  try {
    if (job.name === 'fast-onboarding-mapping') {
      await processFastOnboardingMappingJob(job as Job<FastOnboardingMappingJobData>);
      return;
    }
    if (job.name === 'create-gmail-labels') {
      await processCreateGmailLabelsJob(job as Job<CreateGmailLabelsJobData>);
      return;
    }
    console.log(`[EMAIL-JOBS WORKER] Skipping job ${job.name} - unsupported type`);
  } catch (error) {
    console.error(`[EMAIL-JOBS WORKER] Job ${job.name} failed:`, error);
    throw error;
  }
}, {
  connection: redisConnection,
  concurrency: 2,
});

// SECURE Helper function to fetch and process emails in-memory (no database storage)
async function fetchAndProcessEmailsSecurely(userId: string): Promise<{
  sentEmails: any[];
  inboxEmails: any[];
}> {
  console.log(`[SECURE EMAIL FETCH] Starting secure dual in-memory email processing for user ${userId}`);
  
  const gmailResult = await createGmailServiceForUser({
    userId,
    purpose: 'worker:fetch-process-emails',
    requester: 'worker.fetchAndProcessEmailsSecurely',
  });

  if (!gmailResult) {
    throw new Error(`No valid OAuth token found for user ${userId}`);
  }

  const gmailService = gmailResult.gmail;

  // Fetch both sent and inbox emails in parallel for efficiency
  console.log(`[SECURE EMAIL FETCH] Fetching 180 sent emails and 500 inbox emails in parallel for user ${userId}...`);
  
  const [sentEmails, inboxEmails] = await Promise.all([
    gmailService.fetchAndParseEmails(180),        // existing sent emails for communication style
    gmailService.fetchInboxEmailsSecurely(500)   // new inbox emails for labeling analysis
  ]);

  console.log(`[SECURE EMAIL FETCH COMPLETE] Processed ${sentEmails.length} sent emails and ${inboxEmails.length} inbox emails in-memory for user ${userId} (NOT stored in database)`);
  
  return {
    sentEmails,
    inboxEmails
  };
}

// --- Worker for Batch Email Sorting ---
const batchSortWorker = new Worker<BatchSortJobData>('batch-sort', async (job: any) => {
  const { userId, maxEmailsPerBatch, includeSpam, includeTrash, daysBack } = job.data;
  console.log(`[BATCH SORT START] Processing batch email sorting for user: ${userId} (Job ID: ${job.id})`);

  try {
    // Clean up any stale running jobs for this user before starting
    try {
      await prisma.batchSortJob.updateMany({
        where: {
          userId: userId,
          status: 'running',
          startedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) }
        },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: 'Previous job was stale, cleaned up by worker'
        }
      });
    } catch (cleanupError) {
      console.warn(`[BATCH SORT] Warning: failed to cleanup stale jobs for user ${userId}:`, cleanupError);
    }

    job.updateProgress(10);
    
    const batchSorter = new BatchSortingWorker();
    
    // Sort emails for the user
    const stats = await batchSorter.sortEmailsForUser({
      userId,
      maxEmailsPerBatch: maxEmailsPerBatch || 100,
      includeSpam: includeSpam || false,
      includeTrash: includeTrash || false,
      daysBack: daysBack || 1
    });
    
    job.updateProgress(100);
    console.log(`[BATCH SORT COMPLETE] Processed ${stats.emailsProcessed} emails for user ${userId}: ${stats.emailsSorted} sorted, ${stats.emailsToReview} to review, ${stats.tokensUsed} tokens`);
    
    return stats;
  } catch (error) {
    console.error(`[BATCH SORT FAILED] Batch sorting failed for user ${userId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 2 // Process up to 2 batch sorting jobs simultaneously
});

// --- Worker for Model Retraining ---
const modelRetrainWorker = new Worker<ModelRetrainJobData>('model-retrain', async (job: any) => {
  const { userId, forceRetrain } = job.data;
  console.log(`[MODEL RETRAIN START] LLM-based system doesn't require retraining for user: ${userId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);
    
    // LLM-based system doesn't require model retraining like FastText did
    console.log(`[MODEL RETRAIN] Skipping user ${userId}: LLM-based system uses dynamic routing`);
    
    job.updateProgress(100);
    
    return {
      success: true,
      reason: 'LLM-based system does not require model retraining',
      trainingExamples: 0,
      accuracy: 100,
      systemType: 'LLM-based routing'
    };
  } catch (error) {
    console.error(`[MODEL RETRAIN FAILED] Model retraining job failed for user ${userId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 1 // Process model retraining jobs sequentially
});

// --- NEW FOLDER GENERATION WORKERS ---

const fastOnboardingService = new FastOnboardingService();

// --- Worker for Fast Onboarding Proposal Generation ---
const fastOnboardingWorker = new Worker<FastOnboardingProposalJobData>('fast-onboarding-proposal', async (job: any) => {
  const { userId, options } = job.data;
  console.log(`📬 [FAST ONBOARDING START] Generating proposal for user ${userId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);

    const folderService = new FolderGenerationWorkerService();
    const proposal = await folderService.generateFastOnboardingProposal(userId, options);

    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { autoSortingEnabled: true },
    });

    const payload = {
      proposal,
      autoSortingEnabled: userSettings?.autoSortingEnabled ?? true,
      generatedAt: new Date().toISOString(),
    };

    await fastOnboardingService.storeProposalResult(userId, payload);

    job.updateProgress(100);
    console.log(`✅ [FAST ONBOARDING COMPLETE] Generated ${proposal.suggestions.length} suggestions for user ${userId}`);

    return payload;
  } catch (error) {
    console.error(`❌ [FAST ONBOARDING FAILED] Proposal generation failed for user ${userId}:`, error);
    throw error;
  }
}, {
  connection: redisConnection,
  concurrency: 2,
});

// --- Worker for Folder Generation ---
const folderGenerationWorker = new Worker<FolderGenerationJobData>('folder-generation', async (job: any) => {
  const { userId, maxEmails, minFrequency, daysBack } = job.data;
  console.log(`[FOLDER GENERATION START] Generating folders for user: ${userId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);
    
    const folderService = new FolderGenerationWorkerService();
    
    // Generate and save folder categorization
    const result = await folderService.generateAndSaveFolderCategorization(userId, {
      maxEmails,
      minFrequency,
      daysBack
    });
    
    job.updateProgress(100);
    console.log(`[FOLDER GENERATION COMPLETE] Folders generated for user ${userId} - v${result.version} with ${result.confidence}% confidence`);
    
    return result;
  } catch (error) {
    console.error(`[FOLDER GENERATION FAILED] Folder generation failed for user ${userId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 2 // Process up to 2 folder generation jobs simultaneously
});

// --- Worker for Email Mapping ---
const emailMappingWorker = new Worker<EmailMappingJobData>('email-mapping', async (job: any) => {
  const { userId, availableFolders, emailAddresses, emailPatternContext } = job.data;
  console.log(`[EMAIL MAPPING START] Generating email mappings for user: ${userId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);
    
    const folderService = new FolderGenerationWorkerService();
    
    // Generate email mappings
    const mappings = await folderService.generateEmailMappings(
      userId,
      availableFolders,
      emailAddresses,
      emailPatternContext
    );
    
    job.updateProgress(100);
    console.log(`[EMAIL MAPPING COMPLETE] Generated ${mappings.mappingSuggestions.length} mapping suggestions for user ${userId}`);
    
    return mappings;
  } catch (error) {
    console.error(`[EMAIL MAPPING FAILED] Email mapping failed for user ${userId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 3 // Process up to 3 email mapping jobs simultaneously
});

// --- Worker for Email Learning ---
const emailLearningWorker = new Worker<EmailLearningJobData>('email-learning', async (job: any) => {
  const { userId, corrections } = job.data;
  console.log(`[EMAIL LEARNING START] Processing ${corrections.length} corrections for user: ${userId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);
    
    const folderService = new FolderGenerationWorkerService();
    
    // Process user corrections and generate learnings
    const learnings = await folderService.processUserCorrections(userId, corrections);
    
    job.updateProgress(100);
    console.log(`[EMAIL LEARNING COMPLETE] Processed ${learnings.processedLearnings} learnings for user ${userId} in ${learnings.processingTimeMs}ms`);
    
    return learnings;
  } catch (error) {
    console.error(`[EMAIL LEARNING FAILED] Email learning failed for user ${userId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 4 // Process up to 4 email learning jobs simultaneously (lightweight job)
});

// --- Worker for Complete Email Categorization ---
const emailCategorizationWorker = new Worker<EmailCategorizationJobData>('email-categorization', async (job: any) => {
  const { userId, options } = job.data;
  console.log(`[EMAIL CATEGORIZATION START] Categorizing emails for user: ${userId} (Job ID: ${job.id})`);

  try {
    job.updateProgress(10);
    
    const folderService = new FolderGenerationWorkerService();
    
    // Perform complete email categorization (returns full results with email examples)
    const categorization = await folderService.categorizeReceivedEmails(userId, options);
    
    job.updateProgress(70);
    
    // Store full results with email examples in memory cache for immediate API access
    const categorizationService = new EmailCategorizationService();
    await categorizationService.storeCategorizationResult(userId, categorization, options);
    
    job.updateProgress(100);
    console.log(`[EMAIL CATEGORIZATION COMPLETE] Categorized ${categorization.totalEmailsAnalyzed} emails for user ${userId} in ${categorization.categorizationTimeMs}ms`);
    
    // Return full results with email examples for immediate API use (not saved to DB)
    return categorization;
  } catch (error) {
    console.error(`[EMAIL CATEGORIZATION FAILED] Email categorization failed for user ${userId}:`, error);
    throw error;
  }
}, { 
  connection: redisConnection,
  concurrency: 1 // Process email categorization jobs sequentially (heavy LLM job)
});

// ============================================================================
// Supermemory Bootstrap Worker
// ============================================================================

const supermemoryBootstrapWorker = new Worker<SupermemoryBootstrapJobData>(
  'supermemory-bootstrap',
  async (job: Job<SupermemoryBootstrapJobData>) => {
    const { userId, maxSentEmails, budgetTokens, dryRun } = job.data;

    logger.info(
      `[MEMORY BOOTSTRAP START] Building memory graph for user: ${userId} (Job ID: ${job.id})`,
    );

    try {
      // Check if Supermemory is configured
      if (!dryRun && !isSupermemoryConfigured()) {
        logger.warn(
          `[MEMORY BOOTSTRAP] Supermemory not configured, skipping bootstrap for user ${userId}`,
        );
        return {
          skipped: true,
          reason: 'SUPERMEMORY_API_KEY not configured',
        };
      }

      job.updateProgress(5);

      // Run the bootstrap process
      const result = await runSupermemoryBootstrap({
        userId,
        maxSentEmails: maxSentEmails ?? 250,
        budgetTokens: budgetTokens ?? 100_000,
        dryRun: dryRun ?? false,
      });

      job.updateProgress(100);

      logger.info(
        `[MEMORY BOOTSTRAP COMPLETE] ✅ User ${userId}: ${result.episodesIngested} episodes, ${result.estimatedTokensUsed} tokens, ${result.durationMs}ms`,
      );

      return result;
    } catch (error) {
      logger.error(`[MEMORY BOOTSTRAP FAILED] Bootstrap failed for user ${userId}:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    // Start with concurrency 1 per SUPERMEMORY.md - increase only after measuring
    concurrency: 1,
    // Lock duration for long-running bootstrap jobs (20 minutes)
    lockDuration: 20 * 60 * 1000,
  },
);

supermemoryBootstrapWorker.on('progress', (job: Job, progress: JobProgress) => {
  const progressValue = typeof progress === 'string'
    ? progress
    : typeof progress === 'number'
      ? `${progress}%`
      : typeof progress === 'boolean'
        ? String(progress)
        : JSON.stringify(progress);
  logger.debug(`📊 [MEMORY BOOTSTRAP] Job ${job.id} progress: ${progressValue}`);
});

// Store worker references for cleanup
workers.push(
  onboardingWorker, 
  masterPromptWorker, 
  replyWorker,
  reminderNotificationWorker,
  batchSortWorker, 
  modelRetrainWorker, 
  emailJobsWorker,
  fastOnboardingWorker,
  // Add new folder generation workers
  folderGenerationWorker,
  emailMappingWorker,
  emailLearningWorker,
  emailCategorizationWorker,
  supermemoryBootstrapWorker
);

// Graceful shutdown handling
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  
  try {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (telegramMonitorStarted) {
      console.log('📨 Stopping Telegram monitor...');
      await stopTelegramMonitor();
      telegramMonitorStarted = false;
    }

    await drainTelegramProcessingQueue();

    // Close all workers
    console.log('📦 Closing all workers...');
    await Promise.all(workers.map(worker => worker.close()));
    
    // Close Redis connection
    console.log('🔌 Closing Redis connection...');
    await redisConnection.quit();
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Setup signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (error: Error) => {
  console.error('🚨 Unhandled promise rejection:', error);
  gracefulShutdown('unhandledRejection');
});

// Worker event logging
// IMPORTANT: Order must match workers.push() array order exactly
workers.forEach((worker, index) => {
  const workerNames = [
    'onboarding',            // 0: onboardingWorker
    'masterPrompt',          // 1: masterPromptWorker
    'reply',                 // 2: replyWorker
    'reminderNotification',  // 3: reminderNotificationWorker
    'batchSort',             // 4: batchSortWorker
    'modelRetrain',          // 5: modelRetrainWorker
    'emailJobs',             // 6: emailJobsWorker
    'fastOnboarding',        // 7: fastOnboardingWorker
    'folderGeneration',      // 8: folderGenerationWorker
    'emailMapping',          // 9: emailMappingWorker
    'emailLearning',         // 10: emailLearningWorker
    'emailCategorization',   // 11: emailCategorizationWorker
    'supermemoryBootstrap',  // 12: supermemoryBootstrapWorker
  ];
  const name = workerNames[index] ?? `unknown-${index}`;
  
  worker.on('completed', (job: any) => {
    console.log(`✅ [${name.toUpperCase()}] Job ${job.id} completed`);
  });
  
  worker.on('failed', (job: any, err: Error) => {
    console.error(`❌ [${name.toUpperCase()}] Job ${job?.id} failed:`, err.message);
  });
  
  worker.on('stalled', (jobId: string) => {
    console.warn(`⚠️ [${name.toUpperCase()}] Job ${jobId} stalled`);
  });
});

// Heartbeat for diagnosing whether the Supermemory bootstrap worker is running.
// This is intentionally simple: write a timestamp to Redis on an interval.
void writeSupermemoryWorkerHeartbeat();
heartbeatInterval = setInterval(() => {
  void writeSupermemoryWorkerHeartbeat();
  if (telegramMonitorStarted) {
    void writeTelegramWorkerHeartbeat();
  }
}, 30_000);

if (isTelegramEnabled()) {
  startTelegramMonitor({
    onMessage: async (message) => {
      enqueueTelegramMessageForProcessing(message);
    },
  })
    .then(() => {
      telegramMonitorStarted = true;
      void writeTelegramWorkerHeartbeat();
      console.log('📨 Telegram long-polling monitor started in worker process');
    })
    .catch((error) => {
      console.error('❌ Failed to start Telegram monitor:', error);
    });
} else {
  console.log('📨 Telegram monitor disabled (missing token or TELEGRAM_ENABLED=false)');
}

console.log('🧠 Supermemory bootstrap worker is ready and listening for supermemory-bootstrap jobs...');
console.log('🎯 Background workers are ready and listening for jobs...');
console.log('📊 Worker configuration:');
console.log('  - Onboarding: concurrency 2');
console.log('  - Master Prompt: concurrency 3'); 
console.log('  - Reply Generation: concurrency 5');
console.log('  - Fast Onboarding: concurrency 2');
console.log('  - Folder Generation: concurrency 2');
console.log('  - Email Mapping: concurrency 3');
console.log('  - Email Learning: concurrency 4');
console.log('  - Email Categorization: concurrency 1');
console.log('  - Supermemory Bootstrap: concurrency 1');
console.log(`  - Telegram message processing: concurrency ${telegramProcessConcurrency}`);
