export interface User {
  name: string;
  avatar: string;
  status: string;
}

export interface QueueItem {
  id: string;
  sender?: string;
  senderAvatar?: string;
  actionSummary: string;
  confidence: number;
  status: 'auto-approved' | 'needs-attention' | 'snoozed' | 'manual';
  draftPreview: string;
  fullDraft: string;
  reason?: string;
  timestamp?: string;
  type?: string;
  priority?: string;
  contextSummary?: string;
  generatedAt?: string;
  metadata?: {
    emailId?: string;
    from?: string;
    to?: string[];
    subject?: string;
    body?: string;
    receivedAt?: string;
    labels?: Array<{
      id: string;
      name: string;
      color: string;
      gmailLabelId?: string;
    }>;
    mailboxId?: string;
    mailboxEmail?: string;
    mailboxProvider?: string;
    mailboxDisplayName?: string;
    gmailDraftId?: string;
    ccRecipients?: string[];
    [key: string]: unknown;
  };
}

export interface HistoryItem {
  id: string;
  statusIcon: React.ReactNode;
  timestamp: string;
  summary: string;
  fullContext: string;
  promptState: string;
  feedback: string;
}

export interface Metrics {
  autonomyOverTime: number[];
  keyMetrics: {
    emailsHandled: number;
    averageConfidence: string;
    timeSaved: string;
    errorRate: string;
    editsNeeded: number;
  };
  autonomyBreakdown: {
    auto: number;
    manual: number;
    snoozed: number;
  };
}

export interface PromptVersion {
  id: string;
  version: number;
  date: string;
  editor: string;
  reason: string;
  active: boolean;
  settings: {
    tone: string;
    formality: string;
    signOff: string;
    emojiUsage: number;
  };
}

export interface WorkingHours {
  [key: string]: {
    start: string;
    end: string;
    active: boolean;
  };
}

export interface Integration {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  connected: boolean;
  scope: string;
  lastSync: string;
}

export interface EmailStats {
  emailCount: number;
  threadCount: number;
}

export type PageType = 'queue' | 'history' | 'metrics' | 'voice' | 'settings' | 'feedback' | 'folders' | 'label-queue';

// New types for Calendar Service
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  status: 'confirmed' | 'tentative' | 'cancelled';
  location?: string;
}

export interface CalendarAvailability {
  isFree: boolean;
  conflictingEvents: CalendarEvent[];
  suggestedTimes?: Array<{
    start: string;
    end: string;
  }>;
}

// New types for Context Engine
export interface EmailContextQuery {
  keywords?: string[];
  senderFilter?: string[];
  dateWindowHint?: string;
  hasAttachment?: boolean;
  maxResults?: number;
}

export interface IncomingEmailScannerOutput {
  needsCalendarCheck: boolean;
  calendarParameters?: {
    dateHint?: string;
    durationHint?: string;
    attendees?: string[];
  };
  emailContextQuery: EmailContextQuery;
  urgencyLevel: 'low' | 'medium' | 'high';
  primaryIntent: 'scheduling' | 'information_request' | 'problem_report' | 'status_update' | 'follow_up' | 'other';
  reasoning: string;
}

export interface FinalContextOutput {
  contextualDraft: string;
  suggestedActions: string[];
  confidenceScore: number;
  reasoning: string;
  keyFactsUsed: string[];
  emailSummary?: string;
}

export interface ContextualInformation {
  calendarData?: {
    availability: CalendarAvailability;
    relevantEvents: CalendarEvent[];
    summary: string;
  };
  emailContext: {
    relevantEmails: Array<{
      from: string;
      to: string[];
      subject: string;
      body: string;
      date: Date;
      isSent: boolean;
      snippet: string;
    }>;
    summary: string;
  };
  scannerOutput: IncomingEmailScannerOutput;
  finalContext: FinalContextOutput;
}

// New types for Email Mapping and Extraction
export interface EmailMapping {
  id: string;
  userId: string;
  labelId: string;
  labelName: string;
  labelColor?: string;
  emailAddress: string;
  domain?: string;
  isActive: boolean;
  mappingType: 'EMAIL' | 'DOMAIN';
  confidence?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractedEmailAddress {
  emailAddress: string;
  domain: string;
  senderName?: string;
  frequency: number;
  lastSeen: Date;
  sampleSubjects: string[];
  sampleSnippets: string[];
  suggestedLabel?: string;
  confidence?: number;
  dominantGmailCategory?: string;
}

export interface EmailExtractionResult {
  extractedAddresses: ExtractedEmailAddress[];
  totalEmailsAnalyzed: number;
  uniqueAddressesFound: number;
  extractionTimeMs: number;
  suggestedMappings: Array<{
    emailAddress: string;
    suggestedLabelName: string;
    confidence: number;
    reasoning: string;
  }>;
}

export interface EmailExtractionOptions {
  daysBack?: number;
  maxEmails?: number;
  includeSentEmails?: boolean;
  minFrequency?: number;
  excludeDomains?: string[];
}

export interface RouterDecision {
  labelId: string;
  labelName: string;
  confidence: number;
  reasoning: string;
  routingMethod: 'hard_mapping' | 'llm' | 'fallback';
  mappingMatch?: 'exact' | 'domain' | 'none';
}

export interface EmailMappingStats {
  totalMappings: number;
  activeMappings: number;
  emailMappings: number;
  domainMappings: number;
  mappingsByLabel: Array<{ labelName: string; count: number }>;
}

// Onboarding types for new email mapping flow
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  current: boolean;
}

export interface EmailMappingOnboardingData {
  folders: Array<{
    id: string;
    name: string;
    color: string;
    metaPrompt: string;
    description: string;
    icon: string;
  }>;
  extractedAddresses: ExtractedEmailAddress[];
  suggestedMappings: Array<{
    emailAddress: string;
    suggestedLabelName: string;
    confidence: number;
    reasoning: string;
  }>;
  userMappings: Array<{
    emailAddress: string;
    labelId: string;
  }>;
} 
