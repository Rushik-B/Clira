import { Queue } from 'bullmq';
import redisConnection from './redis';

// Job data types for better type safety
export interface OnboardingJobData {
  userId: string;
}

export interface ReplyGenerationJobData {
  emailId: string;
  userId: string;
}

export interface MasterPromptJobData {
  userId: string;
}

export interface BatchSortJobData {
  userId: string;
  maxEmailsPerBatch?: number;
  includeSpam?: boolean;
  includeTrash?: boolean;
  daysBack?: number;
}

export interface ModelRetrainJobData {
  userId: string;
  forceRetrain?: boolean;
}

export interface CreateGmailLabelsJobData {
  userId: string;
  folders: Array<{
    id: string;
    name: string;
    color?: string;
    emails: Array<{
      id: string;
      originalData?: {
        gmailMessageId?: string;
      };
    }>;
  }>;
}

// New folder generation job types
export interface FolderGenerationJobData {
  userId: string;
  maxEmails?: number;
  minFrequency?: number;
  daysBack?: number;
}

export interface FastOnboardingProposalJobData {
  userId: string;
  options?: {
    maxEmails?: number;
    daysBack?: number;
  };
}

export interface EmailMappingJobData {
  userId: string;
  availableFolders: any[];
  emailAddresses: any[];
  emailPatternContext?: any;
}

export interface FastOnboardingMappingJobData {
  userId: string;
  folders: Array<{
    id: string;
    name: string;
    metaPrompt?: string;
    color?: string;
    description?: string;
  }>;
}

export interface EmailLearningJobData {
  userId: string;
  corrections: Array<{
    emailId: string;
    emailFrom: string;
    fromFolder: string;
    toFolder: string;
    shouldLearn: boolean;
    reason?: string;
  }>;
}

export interface EmailCategorizationJobData {
  userId: string;
  options: {
    maxEmails?: number;
    minFrequency?: number;
    daysBack?: number;
  };
}

export interface ReminderNotificationJobData {
  reminderId: string;
  userId: string;
  userEmail: string;
  title: string;
  context?: string;
}

export interface InboxIndexJobData {
  userId: string;
  mailboxId: string;
  messageId: string;
}

export interface InboxBackfillJobData {
  userId: string;
  mailboxId: string;
}

export interface InboxEmbedRetryJobData {
  userId: string;
  mailboxId: string;
  messageId: string;
  documentId?: string;
}

// Supermemory bootstrap job types
export interface SupermemoryBootstrapJobData {
  userId: string;
  /** Maximum sent emails to fetch (default: 250) */
  maxSentEmails?: number;
  /** Token budget for Supermemory ingestion (default: 100000) */
  budgetTokens?: number;
  /** When true, generate summaries but don't upload to Supermemory */
  dryRun?: boolean;
}

export interface McpSyncConnectionJobData {
  connectionId: string;
  userId: string;
  reason: 'created' | 'updated' | 'manual' | 'scheduled';
}

export interface McpHealthcheckConnectionJobData {
  connectionId: string;
  userId: string;
  reason: 'manual' | 'scheduled' | 'post-sync';
}

// A queue for various email-related jobs
export const emailQueue = new Queue('email-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// A queue for the entire new user onboarding process
export const onboardingQueue = new Queue<OnboardingJobData>('user-onboarding', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3, // Retry a failed job up to 3 times
    backoff: {
      type: 'exponential',
      delay: 5000, // Wait 5 seconds before the first retry, then exponentially increase
    },
    removeOnComplete: 10, // Keep only the last 10 completed jobs
    removeOnFail: 5, // Keep only the last 5 failed jobs
  },
});

// A queue for generating individual email replies
export const replyGenerationQueue = new Queue<ReplyGenerationJobData>('reply-generation', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 20,
    removeOnFail: 10,
  },
});

// A queue for generating master prompts
export const masterPromptQueue = new Queue<MasterPromptJobData>('master-prompt-generation', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 5,
    removeOnFail: 5,
  },
});

// A queue for batch email sorting (2-hour intervals)
export const batchSortQueue = new Queue<BatchSortJobData>('batch-sort', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000, // Start with 10 second delay
    },
    removeOnComplete: 50, // Keep more completed jobs for analytics
    removeOnFail: 20,
  },
});

// A queue for model retraining (nightly)
export const modelRetrainQueue = new Queue<ModelRetrainJobData>('model-retrain', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 30000, // Longer delay for retrain failures
    },
    removeOnComplete: 10,
    removeOnFail: 10,
  },
});

// New queues for folder generation system
export const folderGenerationQueue = new Queue<FolderGenerationJobData>('folder-generation', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 20,
    removeOnFail: 10,
  },
});

export const fastOnboardingQueue = new Queue<FastOnboardingProposalJobData>('fast-onboarding-proposal', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 20,
    removeOnFail: 10,
  },
});

export const emailMappingQueue = new Queue<EmailMappingJobData>('email-mapping', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 50, // Keep more mapping jobs for analytics
    removeOnFail: 20,
  },
});

export const emailLearningQueue = new Queue<EmailLearningJobData>('email-learning', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100, // Keep learning jobs for pattern analysis
    removeOnFail: 20,
  },
});

export const emailCategorizationQueue = new Queue<EmailCategorizationJobData>('email-categorization', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000, // Longer delay for categorization failures (heavy job)
    },
    removeOnComplete: 10,
    removeOnFail: 5,
  },
});

export const reminderNotificationQueue = new Queue<ReminderNotificationJobData>('reminder-notification', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const inboxIndexQueue = new Queue<InboxIndexJobData>('inbox-index', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const inboxBackfillQueue = new Queue<InboxBackfillJobData>('inbox-backfill', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10_000,
    },
    removeOnComplete: 20,
    removeOnFail: 20,
  },
});

export const inboxEmbedRetryQueue = new Queue<InboxEmbedRetryJobData>('inbox-embed-retry', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 15_000,
    },
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

// Supermemory bootstrap queue - runs in separate worker process
// Per SUPERMEMORY.md: isolated from reply-generation to avoid CPU/memory contention
export const supermemoryBootstrapQueue = new Queue<SupermemoryBootstrapJobData>('supermemory-bootstrap', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 30000, // 30s delay for retries (heavy background job)
    },
    removeOnComplete: 20,
    removeOnFail: 10,
  },
});

export const mcpSyncConnectionQueue = new Queue<McpSyncConnectionJobData>('mcp-sync-connection', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000,
    },
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

export const mcpHealthcheckConnectionQueue = new Queue<McpHealthcheckConnectionJobData>('mcp-healthcheck-connection', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000,
    },
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

// Export all queues for easy access
export const allQueues = {
  onboarding: onboardingQueue,
  replyGeneration: replyGenerationQueue,
  masterPrompt: masterPromptQueue,
  batchSort: batchSortQueue,
  modelRetrain: modelRetrainQueue,
  email: emailQueue,
  // Folder generation queues
  folderGeneration: folderGenerationQueue,
  fastOnboarding: fastOnboardingQueue,
  emailMapping: emailMappingQueue,
  emailLearning: emailLearningQueue,
  emailCategorization: emailCategorizationQueue,
  reminderNotification: reminderNotificationQueue,
  inboxIndex: inboxIndexQueue,
  inboxBackfill: inboxBackfillQueue,
  inboxEmbedRetry: inboxEmbedRetryQueue,
  // Supermemory queue (separate worker)
  supermemoryBootstrap: supermemoryBootstrapQueue,
  mcpSyncConnection: mcpSyncConnectionQueue,
  mcpHealthcheckConnection: mcpHealthcheckConnectionQueue,
};

// Graceful shutdown function
export async function closeQueues() {
  console.log('🔄 Closing all queues...');
  await Promise.all([
    onboardingQueue.close(),
    replyGenerationQueue.close(),
    masterPromptQueue.close(),
    batchSortQueue.close(),
    modelRetrainQueue.close(),
    emailQueue.close(),
    // Folder generation queues
    folderGenerationQueue.close(),
    fastOnboardingQueue.close(),
    emailMappingQueue.close(),
    emailLearningQueue.close(),
    emailCategorizationQueue.close(),
    reminderNotificationQueue.close(),
    inboxIndexQueue.close(),
    inboxBackfillQueue.close(),
    inboxEmbedRetryQueue.close(),
    // Supermemory queue
    supermemoryBootstrapQueue.close(),
    mcpSyncConnectionQueue.close(),
    mcpHealthcheckConnectionQueue.close(),
  ]);
  console.log('✅ All queues closed');
}
