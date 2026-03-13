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

export type InboxSearchAction =
  | 'find'
  | 'summarize_range'
  | 'count'
  | 'aggregate';

export type InboxSearchRelativeWindow =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'all_time';

export type InboxSearchGroupBy = 'sender' | 'day' | 'thread' | 'mailbox';

export type InboxSearchSortBy = 'relevance' | 'newest' | 'oldest';

export type InboxSearchFilters = {
  sender?: string;
  recipient?: string;
  keywords?: string[];
  subjectContains?: string;
  bodyContains?: string;
  startDate?: string;
  endDate?: string;
  relativeWindow?: InboxSearchRelativeWindow;
  hasAttachment?: boolean;
  threadId?: string;
  messageId?: string;
  includeDeleted?: boolean;
};

export type InboxSearchOptions = {
  limit?: number;
  sortBy?: InboxSearchSortBy;
  includeQuotes?: boolean;
  includeSnippets?: boolean;
  semantic?: boolean;
  groupBy?: InboxSearchGroupBy;
  timezone?: string;
};

export type InboxSearchToolArgs = {
  action: InboxSearchAction;
  mode?: InboxSearchQueryMode;
  mailboxId?: string;
  mailboxEmail?: string;
  queryText?: string;
  filters?: InboxSearchFilters;
  options?: InboxSearchOptions;
};

export type ListInboxEmailsSortBy = 'newest' | 'oldest';

export type ListInboxEmailsFilters = {
  sender?: string;
  recipient?: string;
  subjectContains?: string;
  startDate?: string;
  endDate?: string;
  relativeWindow?: InboxSearchRelativeWindow;
  threadId?: string;
  messageId?: string;
  hasAttachment?: boolean;
  includeDeleted?: boolean;
};

export type ListInboxEmailsOptions = {
  limit?: number;
  sortBy?: ListInboxEmailsSortBy;
  includeBody?: boolean;
  timezone?: string;
};

export type ListInboxEmailsToolArgs = {
  mailboxId?: string;
  mailboxEmail?: string;
  filters?: ListInboxEmailsFilters;
  options?: ListInboxEmailsOptions;
};

export type ListInboxEmailItem = {
  messageId: string;
  threadId: string;
  mailboxId: string;
  mailboxEmail: string;
  sentAt: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string | null;
  hasAttachment: boolean;
  bodyText?: string;
};

export type ListInboxEmailsResult = {
  items: ListInboxEmailItem[];
  matchedCount: number;
  returnedCount: number;
  truncated: boolean;
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

export type InboxThreadSliceMessage = {
  messageId: string;
  date: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  isAnchor: boolean;
  truncatedBody: boolean;
};

export type InboxThreadSliceResult = {
  threadId: string;
  mailboxId: string;
  mailboxEmail: string;
  anchorMessageId: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  messagesReturned: number;
  bodyCharsUsed: number;
  messages: InboxThreadSliceMessage[];
};

export type InboxSearchCoverage = {
  action: InboxSearchAction;
  queriesTried: string[];
  threadsScanned: number;
  messagesScanned: number;
  timeWindow: string;
  pagesFetched: number;
  truncated: boolean;
  filterOnly: boolean;
  appliedFilters: string[];
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

export type InboxSearchAggregate = {
  key: string;
  count: number;
};

export type InboxSearchSearchRequest = {
  userId: string;
  action: InboxSearchAction;
  mode: InboxSearchQueryMode;
  profile: InboxSearchRetrievalProfile;
  queryText?: string;
  filters?: InboxSearchFilters;
  options?: InboxSearchOptions;
  mailboxes: InboxSearchScopedMailbox[];
  maxCandidates: number;
  snippetChars: number;
  deadlineAt?: number;
};

export type InboxSearchSearchResult = {
  action: InboxSearchAction;
  candidates: InboxSearchCandidate[];
  coverage: InboxSearchCoverage;
  count?: number;
  aggregates?: InboxSearchAggregate[];
  groupBy?: InboxSearchGroupBy;
};
