/**
 * Supermemory Integration Module
 *
 * Provides integration with Supermemory for building a user's memory graph
 * from historical email data. This module handles:
 *
 * 1. Thread Episode Ingestion - Summarizing email threads into structured memories
 * 2. User Profile Bootstrap - Creating initial user profile from email patterns
 * 3. Memory Search - Retrieving relevant context for reply generation
 *
 * Key Components:
 * - SupermemoryBootstrapService: Main orchestrator for bootstrap process
 * - SupermemoryClient: Low-level API client
 * - ThreadSummarizer: Generates 2-field episode summaries
 * - ProfileGenerator: Creates user profile bootstrap documents
 *
 * Usage:
 * ```typescript
 * import { runSupermemoryBootstrap, isSupermemoryConfigured } from '@/lib/services/supermemory';
 *
 * // Check if configured
 * if (isSupermemoryConfigured()) {
 *   const result = await runSupermemoryBootstrap({
 *     userId: 'user-123',
 *     maxSentEmails: 250,
 *     budgetTokens: 100_000,
 *     dryRun: false,
 *   });
 * }
 * ```
 */

// Main service entry point
export {
  SupermemoryBootstrapService,
  runSupermemoryBootstrap,
} from './supermemoryBootstrapService';

// API Client
export {
  SupermemoryClient,
  SupermemoryApiError,
  getSupermemoryClient,
  isSupermemoryConfigured,
  createSupermemoryConfig,
} from './client';

// Thread summarization
export {
  summarizeThreadEpisode,
  validateEpisodeContent,
} from './threadSummarizer';

// Profile generation
export {
  generateUserProfileBootstrap,
  validateProfileContent,
  profileContentToDocumentString,
  extractSignoffNames,
  extractFromDisplayNames,
} from './profileGenerator';

// Email content pruning
export {
  pruneEmailBodyForSummary,
  formatMessageForSummarizer,
  getMessageDirectionMarker,
  estimateTokensFromChars,
} from './emailPruner';

// Rate limiting utilities
export { RateLimiter, createApiRateLimiter } from './rateLimiter';

// Worker heartbeat (diagnostics)
export {
  SUPERMEMORY_WORKER_HEARTBEAT_KEY,
  SUPERMEMORY_WORKER_HEARTBEAT_TTL_SECONDS,
  writeSupermemoryWorkerHeartbeat,
  readSupermemoryWorkerHeartbeat,
} from './workerHeartbeat';

// Queue helpers (for triggering bootstrap from onboarding)
export {
  enqueueSupermemoryBootstrap,
  hasActiveBootstrapJob,
  getBootstrapJobStatus,
  cancelBootstrapJob,
} from './queueHelpers';

// Types
export type {
  // API types
  SupermemoryAddDocumentResponse,
  SupermemoryDocumentStatus,
  SupermemorySearchResult,
  SupermemorySearchResponse,
  SupermemoryUserProfile,
  SupermemoryConfig,

  // Episode types
  ThreadEpisodeContent,
  ThreadEpisodeMetadata,

  // Profile types
  UserProfileBootstrapContent,
  UserProfileBootstrapMetadata,

  // Job types
  SupermemoryBootstrapJobData,
  SupermemoryBootstrapResult,

  // Processing types
  ThreadForProcessing,
  EmailForSummary,
  TokenBudgetTracker,
} from './types';

// Constants
export {
  EPISODE_CHAR_LIMITS,
  DEFAULT_BOOTSTRAP_CONFIG,
} from './types';
