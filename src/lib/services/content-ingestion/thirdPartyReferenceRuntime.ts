import { logger } from '@/lib/logger';
import { sanitizeContentExtractionResultForModel, sanitizeContentReferenceForModel } from './referenceModeling';
import { createContentReferenceId } from './references';
import { extractContentFromBuffer } from './service';
import type { ContentReference } from './types';

const THIRD_PARTY_SOURCE_KIND = 'third_party';
const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';

type FirecrawlScrapeResponse = {
  success?: boolean;
  error?: unknown;
  message?: unknown;
  data?: Record<string, unknown> | null;
};

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function inferDisplayNameFromUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).at(-1);
    return lastSegment ? decodeURIComponent(lastSegment) : parsed.hostname || null;
  } catch {
    return null;
  }
}

function buildInvalidReferenceResult(reference: ContentReference, message: string) {
  return {
    ok: false,
    error: 'invalid_content_reference',
    message,
    contentRef: sanitizeContentReferenceForModel(reference),
  };
}

function validateThirdPartyReference(reference: ContentReference): {
  ok: true;
  url: string;
} | {
  ok: false;
  result: Record<string, unknown>;
} {
  const expectedContentRefId = createContentReferenceId({
    sourceKind: reference.sourceKind,
    locator: reference.locator,
  });
  if (reference.contentRefId !== expectedContentRefId) {
    return {
      ok: false,
      result: {
        ok: false,
        error: 'invalid_content_reference',
        message: 'That content reference is malformed. Please re-run the tool and try again.',
      },
    };
  }

  if (reference.sourceKind !== THIRD_PARTY_SOURCE_KIND) {
    return {
      ok: false,
      result: {
        ok: false,
        error: 'unsupported_content_reference',
        message: 'That content reference type is not supported yet.',
        contentRef: sanitizeContentReferenceForModel(reference),
      },
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(reference.locator);
  } catch {
    return {
      ok: false,
      result: buildInvalidReferenceResult(
        reference,
        'That content reference could not be resolved.',
      ),
    };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      result: buildInvalidReferenceResult(
        reference,
        'That content reference must point to an http or https URL.',
      ),
    };
  }

  return {
    ok: true,
    url: parsedUrl.toString(),
  };
}

function resolveFirecrawlConfig(): {
  apiKey: string | null;
  baseUrl: string;
} {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim() || null;
  const baseUrl =
    process.env.FIRECRAWL_BASE_URL?.trim().replace(/\/+$/, '') || DEFAULT_FIRECRAWL_BASE_URL;

  return { apiKey, baseUrl };
}

function extractFirecrawlMessage(payload: FirecrawlScrapeResponse | null): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return pickFirstString(payload.message, payload.error);
}

function resolveFirecrawlDocument(payload: FirecrawlScrapeResponse | null): {
  text: string;
  mimeType: string;
  displayName: string | null;
} | null {
  const data =
    payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : null;
  if (!data) {
    return null;
  }

  const metadata =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? data.metadata
      : null;

  const markdown = pickFirstString(data.markdown);
  if (markdown) {
    return {
      text: markdown,
      mimeType: 'text/markdown',
      displayName: pickFirstString(metadata?.title),
    };
  }

  const html = pickFirstString(data.html, data.rawHtml);
  if (html) {
    return {
      text: html,
      mimeType: 'text/html',
      displayName: pickFirstString(metadata?.title),
    };
  }

  const text = pickFirstString(data.text);
  if (text) {
    return {
      text,
      mimeType: 'text/plain',
      displayName: pickFirstString(metadata?.title),
    };
  }

  return null;
}

export async function readThirdPartyContentReference(params: {
  userId: string;
  reference: ContentReference;
  conversationId?: string;
  runId: string;
  deadlineMs: number;
}): Promise<Record<string, unknown>> {
  const validation = validateThirdPartyReference(params.reference);
  if (!validation.ok) {
    return validation.result;
  }

  const firecrawl = resolveFirecrawlConfig();
  if (!firecrawl.apiKey) {
    logger.warn('[contentIngestion] third-party content reader unavailable', {
      userId: params.userId,
      runId: params.runId,
      locator: validation.url,
      reason: 'missing_firecrawl_api_key',
    });

    return {
      ok: false,
      error: 'third_party_reader_unavailable',
      message:
        'Third-party webpage reading is not configured right now. Please try again later.',
      contentRef: sanitizeContentReferenceForModel(params.reference),
    };
  }

  const response = await fetch(`${firecrawl.baseUrl}/v2/scrape`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${firecrawl.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: validation.url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
    signal: AbortSignal.timeout(Math.max(1, params.deadlineMs)),
  }).catch((error) => {
    logger.warn('[contentIngestion] Firecrawl scrape failed', {
      userId: params.userId,
      runId: params.runId,
      locator: validation.url,
      error: error instanceof Error ? error.message : String(error),
    });

    return null;
  });

  if (!response) {
    return {
      ok: false,
      error: 'third_party_fetch_failed',
      message: 'The webpage could not be fetched right now.',
      contentRef: sanitizeContentReferenceForModel(params.reference),
    };
  }

  let payload: FirecrawlScrapeResponse | null = null;
  try {
    payload = (await response.json()) as FirecrawlScrapeResponse;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const message =
      extractFirecrawlMessage(payload) ??
      `Firecrawl returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;

    logger.warn('[contentIngestion] Firecrawl rejected third-party content reference', {
      userId: params.userId,
      runId: params.runId,
      locator: validation.url,
      status: response.status,
      message,
    });

    return {
      ok: false,
      error: 'third_party_fetch_failed',
      message,
      contentRef: sanitizeContentReferenceForModel(params.reference),
    };
  }

  const document = resolveFirecrawlDocument(payload);
  if (!document) {
    return {
      ok: false,
      error: 'resource_empty',
      message: 'That webpage did not yield any readable content.',
      contentRef: sanitizeContentReferenceForModel(params.reference),
    };
  }

  const extraction = await extractContentFromBuffer({
    buffer: Buffer.from(document.text, 'utf8'),
    mimeType: document.mimeType,
    filename:
      params.reference.displayName ??
      document.displayName ??
      inferDisplayNameFromUri(validation.url) ??
      'page.md',
    trustClass: params.reference.trustClass,
    channelLabel: 'third_party',
    provenance: {
      sourceLabel: params.reference.provenance.sourceLabel || 'third_party',
      sourceKind: params.reference.sourceKind,
      channel: params.reference.provenance.channel ?? 'third_party',
      conversationId: params.reference.provenance.conversationId ?? params.conversationId ?? null,
      runId: params.reference.provenance.runId ?? params.runId,
      messageId: params.reference.provenance.messageId ?? null,
      attachmentId: params.reference.provenance.attachmentId ?? null,
      originUri: params.reference.provenance.originUri ?? validation.url,
    },
    scope: {
      conversationId: params.conversationId ?? null,
      runId: params.runId,
    },
  });

  return {
    ok: true,
    contentRef: sanitizeContentReferenceForModel(params.reference),
    resultCount: 1,
    results: [sanitizeContentExtractionResultForModel(extraction)],
    truncated: false,
    omittedResultCount: 0,
  };
}
