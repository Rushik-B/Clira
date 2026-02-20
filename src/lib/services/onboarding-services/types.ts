/**
 * Centralized Types for Onboarding Services
 * 
 * This file consolidates all type definitions used across onboarding services
 * to eliminate duplication and provide a single source of truth.
 */

import { EmailMappingType } from '@prisma/client';

// ===================== EMAIL EXTRACTION AND CATEGORIZATION TYPES =====================

export interface ExtractedEmailAddress {
  emailAddress: string;
  domain: string;
  senderName?: string;
  frequency: number;
  lastSeen: Date;
  sampleSubjects: string[];
  sampleSnippets: string[];
  sampleBodies: string[];
  sampleDates: Date[];
  sampleMessageIds?: string[];
  dominantGmailCategory?: string;
}

export interface EmailCategorizationResult {
  categorizedEmails: Array<{
    emailAddress: string;
    senderName?: string;
    frequency: number;
    suggestedFolder: string;
    confidence: number;
    reasoning: string;
    sampleSubjects: string[];
    sampleSnippets: string[];
    sampleBodies: string[];
    sampleDates: Date[];
    sampleMessageIds?: string[];
  }>;
  folderSuggestions: Array<{
    name: string;
    description: string;
    color: string;
    emailCount: number;
    topSenders: string[];
  }>;
  totalEmailsAnalyzed: number;
  categorizationTimeMs: number;
}

export interface EmailCategorizationOptions {
  daysBack?: number;
  maxEmails?: number;
  minFrequency?: number;
}

// ===================== FOLDER GENERATION TYPES =====================

export interface GeneratedFolders {
  suggestedFolders: Array<{
    name: string;
    description: string;
    metaPrompt: string;
    color: string;
    colorName?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';
    importance?: 'high' | 'medium' | 'low';
    icon: string;
    confidence: number;
    reasoning: string;
    exampleSenders: string[];
    keywordPatterns: string[];
    expectedWeeklyVolume?: number;
    overlapsWithExisting?: string[];
    stability?: 'stable' | 'emerging' | 'new';
    stabilityReason?: string;
    guidance?: string;
  }>;
  overallAnalysis: {
    totalEmailsAnalyzed: number;
    primaryEmailTypes: string[];
    recommendedApproach: string;
  };
  reasoning: string;
}

export interface ExistingLabelSummary {
  databaseLabels: Array<{ name: string; metaPrompt?: string }>;
  gmailLabels: Array<{ name: string; id: string; type?: string }>;
  combinedLabels: Array<{ name: string; source: 'database' | 'gmail' | 'both' }>;
  totalCount: number;
}

export interface FastOnboardingProposal {
  suggestions: Array<GeneratedFolders['suggestedFolders'][number] & { id: string }>;
  existingLabels: ExistingLabelSummary;
  filteringStats: {
    totalFetched: number;
    skippedForCustomLabels: number;
    processable: number;
  };
  totalAnalyzed: number;
  fallbackUsed: boolean;
}

export interface FastOnboardingJobPayload {
  proposal: FastOnboardingProposal;
  autoSortingEnabled: boolean;
  generatedAt: string;
}

export interface DefaultFolder {
  name: string;
  color: string;
  metaPrompt: string;
  description: string;
  icon: string;
  order: number;
}

export interface FolderCreationResult {
  labelsCreated: number;
  labelsAlreadyExisted: number;
  errors: string[];
}

// ===================== EMAIL MAPPING TYPES =====================

export interface EmailMapping {
  id: string;
  userId: string;
  mailboxId?: string;     // Optional for backcompat; will be required after migration
  mailboxEmail?: string;  // Enriched from mailbox relation
  labelId: string;
  labelName: string;
  labelColor?: string;
  emailAddress: string;
  domain?: string;
  isActive: boolean;
  mappingType: EmailMappingType;
  confidence?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEmailMappingInput {
  userId: string;
  mailboxId?: string;     // Optional for backcompat; will be required after migration
  labelId: string;
  emailAddress: string;
  domain?: string;
  mappingType?: EmailMappingType;
  confidence?: number;
}

export interface UpdateEmailMappingInput {
  labelId?: string;
  mailboxId?: string;
  isActive?: boolean;
  confidence?: number;
}

export interface EmailMappingSearchResult {
  mapping: EmailMapping | null;
  matchType: 'exact' | 'domain' | 'none';
}

export interface GeneratedMappings {
  mappingSuggestions: Array<{
    email: string;
    messageId?: string; // NEW: Preserve message ID for per-email precision
    suggestedFolderId: string;
    suggestedFolderName: string;
    confidence: number;
    reasoning: string;
    mappingType: 'EMAIL' | 'DOMAIN';
    priority: 'high' | 'medium' | 'low';
  }>;
  bulkMappingOpportunities: Array<{
    pattern: string;
    suggestedFolderId: string;
    suggestedFolderName: string;
    confidence: number;
    reasoning: string;
    affectedEmails: string[];
    mappingType: 'EMAIL' | 'DOMAIN';
  }>;
  unmappedEmails: Array<{
    email: string;
    reasoning: string;
    suggestedAction: string;
  }>;
  overallStats: {
    totalEmailsAnalyzed: number;
    highConfidenceMappings: number;
    mediumConfidenceMappings: number;
    lowConfidenceMappings: number;
    unmappedCount: number;
  };
}

// ===================== EMAIL LEARNING TYPES =====================

export interface EmailCorrection {
  emailId: string;
  emailFrom: string;
  fromFolder: string;
  toFolder: string;
  shouldLearn: boolean;
  reason?: string;
}

export interface EmailLearning {
  id: string;
  userId: string;
  emailFrom: string;
  originalFolder: string;
  correctedFolder: string;
  userReason?: string;
  aiSummary: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LearningContext {
  emailFrom: string;
  originalFolder: string;
  correctedFolder: string;
  reasoning: string;
}

export interface GeneratedLearnings {
  processedLearnings: number;
  learningSummaries: string[];
  errors: string[];
  processingTimeMs: number;
}

// ===================== INBOX REVIEW TYPES =====================

export interface EmailPreviewOptions {
  maxEmails?: number;
  includeConfidence?: boolean;
  groupByFolder?: boolean;
  sampleSize?: number;
}

export interface EmailPreview {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  suggestedFolder: string;
  confidence: number;
  gmailCategories?: string[];
  originalData?: any;
}

export interface ReviewFolder {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  emails: EmailPreview[];
  confidence: number;
}

export interface EmailPreviewResult {
  folders: ReviewFolder[];
  totalEmails: number;
  averageConfidence: number;
  generatedAt: Date;
}

export interface CorrectionResult {
  appliedCorrections: number;
  rulesCreated: number;
  promptsRefined: number;
  errors: string[];
}

// ===================== QUEUE AND JOB STATUS TYPES =====================

export interface JobStatus {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'cached';
  progress?: number;
  result?: any;
  error?: string;
}

export interface QueueJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  removeOnComplete?: number;
  removeOnFail?: number;
}
