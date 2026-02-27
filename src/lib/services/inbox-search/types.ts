export type InboxSearchIndexInput = {
  userId: string;
  mailboxId: string;
  threadId: string;
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  snippet?: string | null;
  body: string;
  sentAt: Date;
  hasAttachment: boolean;
};

export type InboxSearchChunkRecord = {
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
};

export type InboxSearchIndexResult =
  | {
      status: 'indexed';
      documentId: string;
      chunkCount: number;
      contentHash: string;
    }
  | {
      status: 'skipped_unchanged' | 'skipped_filtered';
      documentId: string | null;
      chunkCount: 0;
      contentHash: string;
    };

export type InboxSearchQueryMode = 'quick' | 'deep';

export type InboxSearchRetrievalProfile = 'default' | 'messaging';

export type InboxSearchQueryConstraints = {
  sender?: string;
  recipient?: string;
  keywords?: string[];
  subject?: string;
  timeWindow?: 'recent' | 'last_month' | 'last_year' | 'all_time';
  startDate?: string;
  endDate?: string;
  hasAttachment?: boolean;
};

export type InboxSearchScopedMailbox = {
  id: string;
  emailAddress: string;
  status: string;
  isPrimary: boolean;
};

export type InboxSearchFreshness = 'fresh' | 'lagging' | 'stale' | 'unknown';

export type InboxSearchCandidate = {
  documentId: string;
  threadId: string;
  messageId: string;
  mailboxId: string;
  mailboxEmail: string;
  date: string;
  from: string;
  subject: string;
  snippet: string;
  matchedTerms: string[];
  whyRelevant: string;
  lexicalRank: number;
  lexicalScore: number | null;
  semanticScore: number | null;
  semanticRank: number | null;
  rrfScore: number;
  recencyBoost: number;
  exactSenderBoost: number;
  exactSubjectBoost: number;
  totalScore: number;
  semanticUnavailable: boolean;
};

export type InboxSearchCoverage = {
  queriesTried: string[];
  threadsScanned: number;
  messagesScanned: number;
  timeWindow: string;
  pagesFetched: number;
  truncated: boolean;
  budgetNotes: string[];
  engineVersion: 'inbox-search-v2-lexical' | 'inbox-search-v2-hybrid';
  indexFreshness: InboxSearchFreshness;
  retrievalLatencyMs: number;
  lexicalCandidates: number;
  semanticCandidates: number;
  fusionMethod: 'lexical-only' | 'rrf_k60';
  indexLag: number | null;
  semanticUnavailable: boolean;
};

export type InboxSearchSearchRequest = {
  userId: string;
  intent: string;
  mode: InboxSearchQueryMode;
  profile: InboxSearchRetrievalProfile;
  constraints?: InboxSearchQueryConstraints;
  mailboxes: InboxSearchScopedMailbox[];
  maxCandidates: number;
  snippetChars: number;
  deadlineAt?: number;
};

export type InboxSearchSearchResult = {
  candidates: InboxSearchCandidate[];
  coverage: InboxSearchCoverage;
};
