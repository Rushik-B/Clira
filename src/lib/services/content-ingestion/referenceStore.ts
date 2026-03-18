import crypto from 'node:crypto';
import { extractContentFromBuffer } from './service';
import { createContentReferenceId } from './references';
import {
  readContentReferenceBuffer,
  storeContentReferenceBuffer,
} from './state';
import type {
  ContentCapability,
  ContentExtractionResult,
  ContentReference,
  ContentTrustClass,
} from './types';

export const STORED_CONTENT_SOURCE_KIND = 'stored_content';

type StoredContentLocator = {
  storageId: string;
};

function serializeStoredContentLocator(locator: StoredContentLocator): string {
  return JSON.stringify(locator);
}

function parseStoredContentLocator(locator: string): StoredContentLocator | null {
  try {
    const parsed: unknown = JSON.parse(locator);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const storageId = typeof record.storageId === 'string' ? record.storageId.trim() : '';

    if (!storageId) {
      return null;
    }

    return { storageId };
  } catch {
    return null;
  }
}

function resolveContentCapability(mimeType?: string | null): ContentCapability {
  const normalized = mimeType?.toLowerCase() ?? null;
  if (!normalized) {
    return 'binary';
  }

  if (
    normalized.startsWith('text/') ||
    normalized === 'application/pdf' ||
    normalized === 'application/json' ||
    normalized === 'application/xml' ||
    normalized.startsWith('image/') ||
    normalized.startsWith('audio/') ||
    normalized.includes('spreadsheet') ||
    normalized.includes('wordprocessingml') ||
    normalized.includes('presentationml') ||
    normalized.includes('opendocument')
  ) {
    return 'document';
  }

  if (
    normalized === 'application/zip' ||
    normalized === 'application/x-tar' ||
    normalized.includes('rar') ||
    normalized.includes('7z')
  ) {
    return 'container';
  }

  return 'binary';
}

export function createStoredContentReference(params: {
  userId: string;
  buffer: Buffer;
  displayName?: string | null;
  mimeHint?: string | null;
  trustClass: ContentTrustClass;
  requiresApproval?: boolean;
  provenance: ContentReference['provenance'];
  capability?: ContentCapability;
}): ContentReference {
  const locator = serializeStoredContentLocator({
    storageId: crypto.randomUUID(),
  });
  const contentRefId = createContentReferenceId({
    sourceKind: STORED_CONTENT_SOURCE_KIND,
    locator,
  });

  storeContentReferenceBuffer({
    referenceId: contentRefId,
    ownerUserId: params.userId,
    buffer: params.buffer,
    filename: params.displayName ?? null,
    mimeType: params.mimeHint ?? null,
  });

  return {
    sourceKind: STORED_CONTENT_SOURCE_KIND,
    locator,
    displayName: params.displayName ?? null,
    mimeHint: params.mimeHint ?? null,
    trustClass: params.trustClass,
    requiresApproval: params.requiresApproval ?? false,
    provenance: params.provenance,
    capability: params.capability ?? resolveContentCapability(params.mimeHint),
    contentRefId,
  };
}

export async function resolveStoredContentReference(params: {
  userId: string;
  reference: ContentReference;
  conversationId?: string;
  runId: string;
}): Promise<
  | {
      ok: true;
      extraction: ContentExtractionResult;
      reference: ContentReference;
    }
  | {
      ok: false;
      error: string;
      message: string;
      reference?: ContentReference;
    }
> {
  const expectedContentRefId = createContentReferenceId({
    sourceKind: params.reference.sourceKind,
    locator: params.reference.locator,
  });

  if (params.reference.contentRefId !== expectedContentRefId) {
    return {
      ok: false,
      error: 'invalid_content_reference',
      message: 'That content reference is malformed. Please re-run the source action and try again.',
    };
  }

  if (params.reference.sourceKind !== STORED_CONTENT_SOURCE_KIND) {
    return {
      ok: false,
      error: 'unsupported_content_reference',
      message: 'That content reference type is not supported by the stored-content reader.',
      reference: params.reference,
    };
  }

  if (!parseStoredContentLocator(params.reference.locator)) {
    return {
      ok: false,
      error: 'invalid_content_reference',
      message: 'That content reference could not be resolved.',
      reference: params.reference,
    };
  }

  const stored = readContentReferenceBuffer(params.reference.contentRefId);
  if (!stored || stored.ownerUserId !== params.userId) {
    return {
      ok: false,
      error: 'content_reference_not_found',
      message: 'That uploaded content is no longer available. Please upload it again.',
      reference: params.reference,
    };
  }

  const extraction = await extractContentFromBuffer({
    buffer: stored.buffer,
    mimeType: params.reference.mimeHint ?? stored.mimeType ?? undefined,
    filename: params.reference.displayName ?? stored.filename ?? undefined,
    trustClass: params.reference.trustClass,
    channelLabel: params.reference.provenance.channel ?? 'content reference',
    provenance: {
      ...params.reference.provenance,
      conversationId:
        params.reference.provenance.conversationId ?? params.conversationId ?? null,
      runId: params.reference.provenance.runId ?? params.runId,
    },
    scope: {
      conversationId: params.conversationId ?? null,
      runId: params.runId,
    },
  });

  return {
    ok: true,
    extraction,
    reference: params.reference,
  };
}
