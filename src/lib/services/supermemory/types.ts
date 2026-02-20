/**
 * Supermemory Integration Types
 *
 * Type definitions for the Supermemory memory graph bootstrap system.
 * Based on the plan in SUPERMEMORY.md - ingesting thread episodes and user profiles.
 */

// ============================================================================
// API Types
// ============================================================================

/**
 * Response from adding a document to Supermemory
 */
export interface SupermemoryAddDocumentResponse {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  customId?: string;
}

/**
 * Response from getting document status
 */
export interface SupermemoryDocumentStatus {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  content?: string;
  containerTags?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Response from searching memories (/v4/search)
 * 
 * Note: API returns "memory" and "similarity" fields, but we normalize to "content" and "score"
 * for consistency with internal usage.
 */
export interface SupermemorySearchResult {
  id: string;
  /** API field name is "memory", normalized to "content" */
  content?: string;
  memory?: string; // Actual API field name
  /** API field name is "similarity", normalized to "score" */
  score?: number;
  similarity?: number; // Actual API field name
  title?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface SupermemorySearchResponse {
  results: SupermemorySearchResult[];
}

/**
 * User profile response from Supermemory
 */
export interface SupermemoryUserProfile {
  profile: {
    static: Record<string, unknown>;
    dynamic: Record<string, unknown>;
  };
}

// ============================================================================
// Thread Episode Types (per SUPERMEMORY.md Section 4)
// ============================================================================

/**
 * Thread episode content schema - exactly 2 fields as per plan
 * Total char budget: sent_email_summary (≤1400) + received_thread_summary (≤1700) = 3100 chars
 */
export interface ThreadEpisodeContent {
  /** Summary of what the user replied/communicated (≤1400 chars) */
  sent_email_summary: string;
  /** Summary of thread context and what others asked/said (≤1700 chars) */
  received_thread_summary: string;
}

/**
 * Thread episode metadata stored in Supermemory
 */
export interface ThreadEpisodeMetadata {
  type: 'thread_episode_v1';
  source: 'gmail';
  userId: string;
  gmailThreadId: string;
  targetSentMessageId: string;
  participants: {
    fromAddresses: string[];
    toAddresses: string[];
    ccAddresses: string[];
  };
  subject: string;
  threadStartAt: string; // ISO string
  threadLastAt: string; // ISO string
  targetSentAt: string; // ISO string
  messageCount: number;
}

// ============================================================================
// User Profile Bootstrap Types (per SUPERMEMORY.md Section 4.3)
// ============================================================================

/**
 * User profile bootstrap content schema
 */
export interface UserProfileBootstrapContent {
  full_name: { value: string; confidence: number };
  preferred_name: { value: string; confidence: number };
  email_address: { value: string; confidence: number };
  common_signoff_name: { value: string; confidence: number };
  timezone_hint: { value: string; confidence: number };
  role_or_company_hint: { value: string; confidence: number };
  notes: string;
}

/**
 * User profile bootstrap metadata
 */
export interface UserProfileBootstrapMetadata {
  type: 'user_profile_bootstrap_v1';
  source: 'gmail';
  userId: string;
  generatorModel: string;
  schemaVersion: number;
  generatedAt: string; // ISO string
}

// ============================================================================
// Bootstrap Job Types
// ============================================================================

/**
 * Job data for the memory bootstrap queue
 */
export interface SupermemoryBootstrapJobData {
  userId: string;
  /** Maximum sent emails to fetch (default: 250) */
  maxSentEmails?: number;
  /** Token budget for Supermemory ingestion (default: 100000) */
  budgetTokens?: number;
  /** When true, generate summaries but don't upload to Supermemory */
  dryRun?: boolean;
  /** When true, include generated content in result (for testing) */
  includeGeneratedContent?: boolean;
}

/**
 * Result of a memory bootstrap job
 */
export interface SupermemoryBootstrapResult {
  userId: string;
  threadsProcessed: number;
  threadsSkippedBudget: number;
  threadsSkippedError: number;
  episodesIngested: number;
  profileIngested: boolean;
  estimatedTokensUsed: number;
  dryRun: boolean;
  durationMs: number;
  errors: Array<{ threadId: string; error: string }>;

  // Test mode fields (populated when includeGeneratedContent=true)
  generatedContent?: {
    episodes: Array<{
      threadId: string;
      subject: string;
      messageCount: number;
      threadStartAt: string;
      threadLastAt: string;
      targetSentAt: string;
      participants: {
        fromAddresses: string[];
        toAddresses: string[];
        ccAddresses: string[];
      };
      content: ThreadEpisodeContent;
      metadata: ThreadEpisodeMetadata;
      actualTokens: number;
    }>;
    profile: UserProfileBootstrapContent | null;
    threadFetchStats: {
      success: number;
      empty: number;
      failed: number;
    };
  };
}

// ============================================================================
// Internal Processing Types
// ============================================================================

/**
 * Represents a Gmail thread with its messages for processing
 */
export interface ThreadForProcessing {
  threadId: string;
  /** The latest sent email in this thread (target for summary) */
  targetSentEmail: EmailForSummary;
  /** All messages in the thread, sorted chronologically */
  messages: EmailForSummary[];
  subject: string;
  participants: {
    fromAddresses: string[];
    toAddresses: string[];
    ccAddresses: string[];
  };
  threadStartAt: Date;
  threadLastAt: Date;
}

/**
 * Minimal email data needed for summarization
 */
export interface EmailForSummary {
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  date: Date;
  isSent: boolean;
}

/**
 * Token budget tracker for bootstrap process
 */
export interface TokenBudgetTracker {
  budgetTokens: number;
  usedTokens: number;
  documentsIngested: number;

  /** Returns true if adding this many tokens would stay within budget */
  canAfford(tokens: number): boolean;
  /** Records token usage */
  recordUsage(tokens: number): void;
  /** Estimates tokens from character count (chars / 4) */
  estimateTokensFromChars(chars: number): number;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the Supermemory service
 */
export interface SupermemoryConfig {
  /** API key for Supermemory */
  apiKey: string;
  /** Base URL for Supermemory API */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
}

/**
 * Character limits for episode summaries (per SUPERMEMORY.md)
 */
export const EPISODE_CHAR_LIMITS = {
  SENT_EMAIL_SUMMARY: 1400,
  RECEIVED_THREAD_SUMMARY: 1700,
  TOTAL: 3100,
} as const;

/**
 * Default bootstrap configuration
 */
export const DEFAULT_BOOTSTRAP_CONFIG = {
  MAX_SENT_EMAILS: 1000,
  BUDGET_TOKENS: 150_000,
  PER_MESSAGE_BODY_CAP: 2200,
  BATCH_SIZE: 10,
  SUMMARIZER_MODEL: 'gemini-3-flash-preview',
  PROFILE_GENERATOR_MODEL: 'gemini-3-flash-preview', // or gemini-3-pro-preview for higher quality
} as const;

