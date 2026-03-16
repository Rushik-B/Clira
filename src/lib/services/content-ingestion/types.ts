import type { AiTraceContext } from '@/lib/ai/tracing';

export type ContentCapability = 'document' | 'container' | 'list' | 'link' | 'binary';

export type ContentTrustClass =
  | 'trusted_internal'
  | 'user_provided'
  | 'third_party'
  | 'untrusted_external';

export type ContentMediaFamily =
  | 'pdf'
  | 'text'
  | 'html'
  | 'image'
  | 'audio'
  | 'office_doc'
  | 'spreadsheet'
  | 'archive'
  | 'unknown_binary';

export type ContentExtractionStatus = 'ok' | 'degraded';

export type ContentDegradationCode =
  | 'unsupported_media_family'
  | 'size_limit_exceeded'
  | 'page_limit_exceeded'
  | 'duration_limit_exceeded'
  | 'extraction_budget_exceeded';

export type ContentProvenance = {
  sourceLabel: string;
  sourceKind?: string | null;
  channel?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  messageId?: string | null;
  attachmentId?: string | null;
  originUri?: string | null;
};

export type ContentReference = {
  sourceKind: string;
  locator: string;
  displayName?: string | null;
  mimeHint?: string | null;
  trustClass: ContentTrustClass;
  requiresApproval: boolean;
  provenance: ContentProvenance;
  capability: ContentCapability;
  contentRefId: string;
};

export type AcquiredContent = {
  bytes?: Buffer;
  url?: string;
  filename?: string | null;
  declaredMimeType?: string | null;
  mimeType: string;
  sniffedMimeType?: string | null;
  sizeBytes: number;
  sha256: string;
  provenance: ContentProvenance;
  trustClass: ContentTrustClass;
  maxBytes: number | null;
};

export type ContentExtractionNote = {
  code: ContentDegradationCode;
  message: string;
};

export type ContentTokenCost = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ContentExtractionBudgetSnapshot = {
  scopeKey: string | null;
  maxExtractions: number | null;
  attemptsUsed: number;
  totalTokens: number;
  totalDurationMs: number;
};

export type ContentExtractionResult = {
  status: ContentExtractionStatus;
  mediaFamily: ContentMediaFamily;
  extractedText: string;
  images: string[];
  structuredData: Record<string, unknown> | null;
  degradationNotes: ContentExtractionNote[];
  attribution: {
    filename?: string | null;
    mimeType: string;
    sniffedMimeType?: string | null;
    sha256: string;
    provenance: ContentProvenance;
  };
  tokenCost: ContentTokenCost;
  extractionDurationMs: number;
  cacheKey: string;
  cacheStatus: 'hit' | 'miss';
  handlerVersion: string;
  budget: ContentExtractionBudgetSnapshot;
  metadata: {
    sizeBytes: number;
    declaredMimeType?: string | null;
    pageCountEstimate?: number | null;
    audioDurationSeconds?: number | null;
  };
};

export type ContentProcessingScope = {
  conversationId?: string | null;
  runId?: string | null;
};

export type ExtractContentFromBufferParams = {
  buffer: Buffer;
  mimeType?: string | null;
  filename?: string | null;
  trustClass?: ContentTrustClass;
  provenance?: Partial<ContentProvenance>;
  channelLabel?: string;
  userCaption?: string | null;
  audioDurationSeconds?: number | null;
  abortSignal?: AbortSignal;
  traceContext?: AiTraceContext;
  scope?: ContentProcessingScope;
  maxExtractionsPerTurn?: number;
};
