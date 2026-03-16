import { logger } from '@/lib/logger';
import { getContentHandler } from './handlers';
import {
  CONTENT_EXTRACTION_LIMITS,
  estimatePdfPageCount,
  formatByteSize,
  resolveContentMediaFamily,
} from './limits';
import { computeBufferSha256, resolveContentMimeType } from './mime';
import {
  commitExtractionMetrics,
  getExtractionBudgetSnapshot,
  readCachedExtractionResult,
  reserveExtractionBudget,
  storeCachedExtractionResult,
} from './state';
import type {
  AcquiredContent,
  ContentExtractionBudgetSnapshot,
  ContentExtractionResult,
  ContentMediaFamily,
  ContentProvenance,
  ExtractContentFromBufferParams,
} from './types';

const DEFAULT_MAX_EXTRACTIONS_PER_TURN = 5;

function buildScopeKeys(params: ExtractContentFromBufferParams): {
  cacheScopeKey: string | null;
  budgetScopeKey: string | null;
  conversationId: string | null;
  runId: string | null;
} {
  const conversationId =
    params.scope?.conversationId ?? params.traceContext?.conversationId ?? null;
  const runId = params.scope?.runId ?? params.traceContext?.runId ?? null;

  return {
    cacheScopeKey: conversationId ?? runId ?? null,
    budgetScopeKey: runId ?? conversationId ?? null,
    conversationId,
    runId,
  };
}

function createBudgetSnapshot(params: {
  scopeKey: string | null;
  maxExtractionsPerTurn: number;
}): ContentExtractionBudgetSnapshot {
  return getExtractionBudgetSnapshot({
    scopeKey: params.scopeKey,
    maxExtractionsPerTurn: params.maxExtractionsPerTurn,
  });
}

function buildCacheKey(params: {
  sha256: string;
  mimeType: string;
  handlerVersion: string;
}): string {
  return `${params.sha256}:${params.mimeType}:${params.handlerVersion}`;
}

function buildAcquiredContent(params: {
  buffer: Buffer;
  filename?: string | null;
  mimeType: string;
  declaredMimeType?: string | null;
  sniffedMimeType?: string | null;
  provenance: ContentProvenance;
  trustClass: ExtractContentFromBufferParams['trustClass'];
  maxBytes: number | null;
}): AcquiredContent {
  return {
    bytes: params.buffer,
    filename: params.filename ?? null,
    declaredMimeType: params.declaredMimeType ?? null,
    mimeType: params.mimeType,
    sniffedMimeType: params.sniffedMimeType ?? null,
    sizeBytes: params.buffer.length,
    sha256: computeBufferSha256(params.buffer),
    provenance: params.provenance,
    trustClass: params.trustClass ?? 'user_provided',
    maxBytes: params.maxBytes,
  };
}

function buildDegradedResult(params: {
  mediaFamily: ContentMediaFamily;
  acquiredContent: AcquiredContent;
  cacheKey: string;
  handlerVersion: string;
  message: string;
  code:
    | 'unsupported_media_family'
    | 'size_limit_exceeded'
    | 'page_limit_exceeded'
    | 'duration_limit_exceeded'
    | 'extraction_budget_exceeded'
    | 'archive_format_unsupported'
    | 'container_entry_limit_exceeded'
    | 'container_recursion_limit_exceeded';
  maxExtractionsPerTurn: number;
  budgetScopeKey: string | null;
  pageCountEstimate?: number | null;
  audioDurationSeconds?: number | null;
}): ContentExtractionResult {
  return {
    status: 'degraded',
    mediaFamily: params.mediaFamily,
    extractedText: '',
    images: [],
    structuredData: null,
    degradationNotes: [
      {
        code: params.code,
        message: params.message,
      },
    ],
    attribution: {
      filename: params.acquiredContent.filename ?? null,
      mimeType: params.acquiredContent.mimeType,
      sniffedMimeType: params.acquiredContent.sniffedMimeType ?? null,
      sha256: params.acquiredContent.sha256,
      provenance: params.acquiredContent.provenance,
    },
    tokenCost: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    extractionDurationMs: 0,
    cacheKey: params.cacheKey,
    cacheStatus: 'miss',
    handlerVersion: params.handlerVersion,
    budget: createBudgetSnapshot({
      scopeKey: params.budgetScopeKey,
      maxExtractionsPerTurn: params.maxExtractionsPerTurn,
    }),
    metadata: {
      sizeBytes: params.acquiredContent.sizeBytes,
      declaredMimeType: params.acquiredContent.declaredMimeType ?? null,
      pageCountEstimate: params.pageCountEstimate ?? null,
      audioDurationSeconds: params.audioDurationSeconds ?? null,
    },
  };
}

function maybeBuildPolicyDegradedResult(params: {
  mediaFamily: ContentMediaFamily;
  acquiredContent: AcquiredContent;
  cacheKey: string;
  handlerVersion: string;
  maxExtractionsPerTurn: number;
  budgetScopeKey: string | null;
  pageCountEstimate: number | null;
  audioDurationSeconds?: number | null;
  supportsExtraction: boolean;
}): ContentExtractionResult | null {
  if (!params.supportsExtraction) {
    return buildDegradedResult({
      mediaFamily: params.mediaFamily,
      acquiredContent: params.acquiredContent,
      cacheKey: params.cacheKey,
      handlerVersion: params.handlerVersion,
      code: 'unsupported_media_family',
      message: `Content ingestion does not yet support ${params.mediaFamily.replace(/_/g, ' ')} files.`,
      maxExtractionsPerTurn: params.maxExtractionsPerTurn,
      budgetScopeKey: params.budgetScopeKey,
      pageCountEstimate: params.pageCountEstimate,
      audioDurationSeconds: params.audioDurationSeconds ?? null,
    });
  }

  if (
    typeof params.acquiredContent.maxBytes === 'number' &&
    params.acquiredContent.sizeBytes > params.acquiredContent.maxBytes
  ) {
    return buildDegradedResult({
      mediaFamily: params.mediaFamily,
      acquiredContent: params.acquiredContent,
      cacheKey: params.cacheKey,
      handlerVersion: params.handlerVersion,
      code: 'size_limit_exceeded',
      message: `Extraction skipped because this ${params.mediaFamily} exceeds the ${formatByteSize(params.acquiredContent.maxBytes)} limit (received ${formatByteSize(params.acquiredContent.sizeBytes)}).`,
      maxExtractionsPerTurn: params.maxExtractionsPerTurn,
      budgetScopeKey: params.budgetScopeKey,
      pageCountEstimate: params.pageCountEstimate,
      audioDurationSeconds: params.audioDurationSeconds ?? null,
    });
  }

  const pageLimit = CONTENT_EXTRACTION_LIMITS[params.mediaFamily].maxPages;
  if (
    typeof pageLimit === 'number' &&
    typeof params.pageCountEstimate === 'number' &&
    params.pageCountEstimate > pageLimit
  ) {
    return buildDegradedResult({
      mediaFamily: params.mediaFamily,
      acquiredContent: params.acquiredContent,
      cacheKey: params.cacheKey,
      handlerVersion: params.handlerVersion,
      code: 'page_limit_exceeded',
      message: `Extraction skipped because this PDF appears to contain ${params.pageCountEstimate} pages, above the ${pageLimit}-page limit.`,
      maxExtractionsPerTurn: params.maxExtractionsPerTurn,
      budgetScopeKey: params.budgetScopeKey,
      pageCountEstimate: params.pageCountEstimate,
      audioDurationSeconds: params.audioDurationSeconds ?? null,
    });
  }

  const durationLimit = CONTENT_EXTRACTION_LIMITS[params.mediaFamily].maxDurationSeconds;
  if (
    typeof durationLimit === 'number' &&
    typeof params.audioDurationSeconds === 'number' &&
    params.audioDurationSeconds > durationLimit
  ) {
    return buildDegradedResult({
      mediaFamily: params.mediaFamily,
      acquiredContent: params.acquiredContent,
      cacheKey: params.cacheKey,
      handlerVersion: params.handlerVersion,
      code: 'duration_limit_exceeded',
      message: `Extraction skipped because this audio clip is ${Math.round(params.audioDurationSeconds)} seconds long, above the ${durationLimit}-second limit.`,
      maxExtractionsPerTurn: params.maxExtractionsPerTurn,
      budgetScopeKey: params.budgetScopeKey,
      pageCountEstimate: params.pageCountEstimate,
      audioDurationSeconds: params.audioDurationSeconds ?? null,
    });
  }

  return null;
}

export function renderContentExtractionForLegacyText(
  result: ContentExtractionResult,
): string {
  if (result.status === 'ok') {
    return result.extractedText;
  }

  const degradation = result.degradationNotes
    .map((note) => `[Content extraction degraded] ${note.message}`)
    .join('\n');

  return [degradation, result.extractedText || null].filter(Boolean).join('\n\n');
}

export async function extractContentFromBuffer(
  params: ExtractContentFromBufferParams,
): Promise<ContentExtractionResult> {
  const scopes = buildScopeKeys(params);
  const maxExtractionsPerTurn = params.maxExtractionsPerTurn ?? DEFAULT_MAX_EXTRACTIONS_PER_TURN;
  const containerDepth = params.containerDepth ?? 0;
  const provenance: ContentProvenance = {
    sourceLabel: params.provenance?.sourceLabel ?? params.channelLabel ?? 'content_ingestion',
    sourceKind: params.provenance?.sourceKind ?? null,
    channel: params.provenance?.channel ?? params.traceContext?.channel ?? null,
    conversationId: params.provenance?.conversationId ?? scopes.conversationId,
    runId: params.provenance?.runId ?? scopes.runId,
    messageId: params.provenance?.messageId ?? null,
    attachmentId: params.provenance?.attachmentId ?? null,
    originUri: params.provenance?.originUri ?? null,
  };
  const resolvedMime = await resolveContentMimeType({
    buffer: params.buffer,
    declaredMimeType: params.mimeType,
    filename: params.filename,
    loggerContext: {
      conversationId: scopes.conversationId,
      runId: scopes.runId,
      sourceLabel: provenance.sourceLabel,
    },
  });
  const mediaFamily = resolveContentMediaFamily({
    mimeType: resolvedMime.mimeType,
    filename: params.filename,
  });
  const handler = getContentHandler(mediaFamily);
  const acquiredContent = buildAcquiredContent({
    buffer: params.buffer,
    filename: params.filename ?? null,
    mimeType: resolvedMime.mimeType,
    declaredMimeType: resolvedMime.declaredMimeType,
    sniffedMimeType: resolvedMime.sniffedMimeType,
    provenance,
    trustClass: params.trustClass,
    maxBytes: CONTENT_EXTRACTION_LIMITS[mediaFamily].maxBytes,
  });
  const cacheKey = buildCacheKey({
    sha256: acquiredContent.sha256,
    mimeType: acquiredContent.mimeType,
    handlerVersion: handler.version,
  });
  const cached = readCachedExtractionResult(scopes.cacheScopeKey, cacheKey);

  if (cached) {
    return {
      ...cached,
      cacheStatus: 'hit',
      budget: createBudgetSnapshot({
        scopeKey: scopes.budgetScopeKey,
        maxExtractionsPerTurn,
      }),
    };
  }

  const pageCountEstimate =
    mediaFamily === 'pdf' ? estimatePdfPageCount(params.buffer) : null;
  const policyDegradedResult = maybeBuildPolicyDegradedResult({
    mediaFamily,
    acquiredContent,
    cacheKey,
    handlerVersion: handler.version,
    maxExtractionsPerTurn,
    budgetScopeKey: scopes.budgetScopeKey,
    pageCountEstimate,
    audioDurationSeconds: params.audioDurationSeconds ?? null,
    supportsExtraction: handler.supportsExtraction,
  });

  if (policyDegradedResult) {
    storeCachedExtractionResult(scopes.cacheScopeKey, cacheKey, policyDegradedResult);
    return policyDegradedResult;
  }

  if (handler.consumesBudget) {
    const reservation = reserveExtractionBudget({
      scopeKey: scopes.budgetScopeKey,
      maxExtractionsPerTurn,
    });

    if (!reservation.ok) {
      return buildDegradedResult({
        mediaFamily,
        acquiredContent,
        cacheKey,
        handlerVersion: handler.version,
        code: 'extraction_budget_exceeded',
        message: `Extraction skipped because this turn already used the ${maxExtractionsPerTurn}-item extraction budget.`,
        maxExtractionsPerTurn,
        budgetScopeKey: scopes.budgetScopeKey,
        pageCountEstimate,
        audioDurationSeconds: params.audioDurationSeconds ?? null,
      });
    }
  }

  const startedAt = Date.now();
  const handlerOutput = await handler.extract?.({
    acquiredContent,
    abortSignal: params.abortSignal,
    traceContext: params.traceContext,
    channelLabel: params.channelLabel,
    userCaption: params.userCaption,
    containerDepth,
    extractNestedContent: async (nestedParams) =>
      extractContentFromBuffer({
        buffer: nestedParams.buffer,
        mimeType: nestedParams.mimeType ?? undefined,
        filename: nestedParams.filename ?? undefined,
        trustClass: acquiredContent.trustClass,
        provenance: {
          ...provenance,
          originUri: nestedParams.originUri ?? provenance.originUri,
        },
        channelLabel: params.channelLabel,
        abortSignal: params.abortSignal,
        traceContext: params.traceContext,
        scope: {
          conversationId: scopes.conversationId,
          runId: scopes.runId,
        },
        maxExtractionsPerTurn,
        containerDepth: containerDepth + 1,
      }),
  });

  if (!handlerOutput) {
    throw new Error(`Missing content handler implementation for ${mediaFamily}`);
  }

  const extractionDurationMs = Math.max(0, Date.now() - startedAt);
  commitExtractionMetrics({
    scopeKey: scopes.budgetScopeKey,
    totalTokens: handlerOutput.tokenCost.totalTokens,
    durationMs: extractionDurationMs,
  });

  const result: ContentExtractionResult = {
    status: handlerOutput.degradationNotes?.length ? 'degraded' : 'ok',
    mediaFamily,
    extractedText: handlerOutput.extractedText,
    images: handlerOutput.images,
    structuredData: handlerOutput.structuredData,
    degradationNotes: handlerOutput.degradationNotes ?? [],
    attribution: {
      filename: acquiredContent.filename ?? null,
      mimeType: acquiredContent.mimeType,
      sniffedMimeType: acquiredContent.sniffedMimeType ?? null,
      sha256: acquiredContent.sha256,
      provenance: acquiredContent.provenance,
    },
    tokenCost: handlerOutput.tokenCost,
    extractionDurationMs,
    cacheKey,
    cacheStatus: 'miss',
    handlerVersion: handler.version,
    budget: createBudgetSnapshot({
      scopeKey: scopes.budgetScopeKey,
      maxExtractionsPerTurn,
    }),
    metadata: {
      sizeBytes: acquiredContent.sizeBytes,
      declaredMimeType: acquiredContent.declaredMimeType ?? null,
      pageCountEstimate,
      audioDurationSeconds: params.audioDurationSeconds ?? null,
    },
  };

  storeCachedExtractionResult(scopes.cacheScopeKey, cacheKey, result);

  logger.info('[contentIngestion] extracted content', {
    mediaFamily,
    mimeType: acquiredContent.mimeType,
    filename: acquiredContent.filename ?? null,
    conversationId: scopes.conversationId,
    runId: scopes.runId,
    tokenCost: handlerOutput.tokenCost.totalTokens,
    extractionDurationMs,
    cacheKey,
  });

  return result;
}
