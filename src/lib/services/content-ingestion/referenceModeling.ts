import path from 'node:path';
import {
  sanitizeMcpInlineText,
  sanitizeMcpJson,
  sanitizeMcpText,
} from '@/lib/services/mcp/security/sanitization';
import type { ContentExtractionResult, ContentReference } from './types';

const MAX_MODEL_CONTENT_REFS = 12;

function inferDisplayNameFromUri(uri?: string | null): string | null {
  if (!uri || !uri.trim()) {
    return null;
  }

  try {
    const parsed = new URL(uri);
    const base = path.posix.basename(parsed.pathname);
    return base && base !== '/' ? decodeURIComponent(base) : parsed.hostname || null;
  } catch {
    const normalized = uri.split(/[?#]/, 1)[0] ?? uri;
    const segments = normalized.split('/').filter(Boolean);
    const last = segments.at(-1);
    return last ? decodeURIComponent(last) : null;
  }
}

export function sanitizeContentReferenceForModel(
  reference: ContentReference,
): Record<string, unknown> {
  return {
    sourceKind: sanitizeMcpInlineText(reference.sourceKind, 80),
    locator: sanitizeMcpText(reference.locator, 1_200),
    displayName: reference.displayName
      ? sanitizeMcpInlineText(reference.displayName, 180)
      : null,
    mimeHint: reference.mimeHint ? sanitizeMcpInlineText(reference.mimeHint, 120) : null,
    trustClass: reference.trustClass,
    requiresApproval: reference.requiresApproval,
    capability: reference.capability,
    contentRefId: sanitizeMcpInlineText(reference.contentRefId, 96),
    provenance: {
      sourceLabel: sanitizeMcpInlineText(reference.provenance.sourceLabel, 160),
      sourceKind: reference.provenance.sourceKind
        ? sanitizeMcpInlineText(reference.provenance.sourceKind, 80)
        : null,
      channel: reference.provenance.channel
        ? sanitizeMcpInlineText(reference.provenance.channel, 40)
        : null,
      conversationId: null,
      runId: null,
      messageId: null,
      attachmentId: null,
      originUri: reference.provenance.originUri
        ? sanitizeMcpText(reference.provenance.originUri, 600)
        : null,
    },
  };
}

export function sanitizeContentExtractionResultForModel(
  result: ContentExtractionResult,
): Record<string, unknown> {
  return {
    status: result.status,
    mediaFamily: result.mediaFamily,
    extractedText: sanitizeMcpText(result.extractedText, 12_000),
    images: result.images.slice(0, 4).map((image) => sanitizeMcpText(image, 600)),
    structuredData: result.structuredData
      ? (sanitizeMcpJson(result.structuredData, 3) as Record<string, unknown>)
      : null,
    degradationNotes: result.degradationNotes.map((note) => ({
      code: note.code,
      message: sanitizeMcpInlineText(note.message, 260),
    })),
    attribution: {
      filename: result.attribution.filename
        ? sanitizeMcpInlineText(result.attribution.filename, 180)
        : null,
      mimeType: sanitizeMcpInlineText(result.attribution.mimeType, 120),
      sniffedMimeType: result.attribution.sniffedMimeType
        ? sanitizeMcpInlineText(result.attribution.sniffedMimeType, 120)
        : null,
      sha256: sanitizeMcpInlineText(result.attribution.sha256, 96),
      provenance: {
        sourceLabel: sanitizeMcpInlineText(result.attribution.provenance.sourceLabel, 160),
        sourceKind: result.attribution.provenance.sourceKind
          ? sanitizeMcpInlineText(result.attribution.provenance.sourceKind, 80)
          : null,
        channel: result.attribution.provenance.channel
          ? sanitizeMcpInlineText(result.attribution.provenance.channel, 40)
          : null,
        conversationId: null,
        runId: null,
        messageId: null,
        attachmentId: null,
        originUri: result.attribution.provenance.originUri
          ? sanitizeMcpText(result.attribution.provenance.originUri, 600)
          : null,
      },
    },
    tokenCost: result.tokenCost,
    extractionDurationMs: result.extractionDurationMs,
    cacheKey: sanitizeMcpInlineText(result.cacheKey, 160),
    cacheStatus: result.cacheStatus,
    handlerVersion: sanitizeMcpInlineText(result.handlerVersion, 60),
    budget: result.budget,
    metadata: result.metadata,
  };
}

export function summarizeContentRefsForModel(
  contentRefs: readonly ContentReference[] | undefined,
): {
  contentRefs: Record<string, unknown>[];
  contentRefCount: number;
  omittedContentRefCount: number;
  contentRefSummaryLines: string[];
} {
  const allContentRefs = contentRefs ?? [];
  const selected = allContentRefs.slice(0, MAX_MODEL_CONTENT_REFS);

  return {
    contentRefs: selected.map((reference) => sanitizeContentReferenceForModel(reference)),
    contentRefCount: allContentRefs.length,
    omittedContentRefCount: Math.max(0, allContentRefs.length - selected.length),
    contentRefSummaryLines: selected.map((reference) => {
      const name = reference.displayName ?? inferDisplayNameFromUri(reference.provenance.originUri);
      const capability = reference.capability.replace(/_/g, ' ');
      const mimeHint = reference.mimeHint ? ` (${reference.mimeHint})` : '';
      return name
        ? sanitizeMcpInlineText(`${name}${mimeHint} [${capability}]`, 220)
        : sanitizeMcpInlineText(
            `${reference.contentRefId}${mimeHint} [${capability}]`,
            220,
          );
    }),
  };
}
