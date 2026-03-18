import crypto from 'node:crypto';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { extractContentFromBuffer } from './service';
import { createContentReferenceId } from './references';
import {
  readContentReferenceBuffer,
  storeContentReferenceBuffer,
} from './state';
import type {
  ContentCapability,
  ContentAssetResolution,
  ContentExtractionResult,
  ContentReference,
  ContentTrustClass,
} from './types';

export const STORED_CONTENT_SOURCE_KIND = 'stored_content';

type StoredContentReferenceDelegate = {
  upsert: (args: {
    where: { contentRefId: string };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  }) => Promise<unknown>;
  findUnique: (args: {
    where: { contentRefId: string };
    select: {
      ownerUserId: true;
      data: true;
      displayName: true;
      mimeHint: true;
      createdAt: true;
    };
  }) => Promise<{
    ownerUserId: string;
    data: Buffer;
    displayName: string | null;
    mimeHint: string | null;
    createdAt: Date;
  } | null>;
};

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

function getStoredContentReferenceDelegate(): StoredContentReferenceDelegate | null {
  const delegate = (
    prisma as unknown as {
      storedContentReference?: StoredContentReferenceDelegate;
    }
  ).storedContentReference;
  return delegate ?? null;
}

export async function createStoredContentReference(params: {
  userId: string;
  buffer: Buffer;
  displayName?: string | null;
  mimeHint?: string | null;
  trustClass: ContentTrustClass;
  requiresApproval?: boolean;
  provenance: ContentReference['provenance'];
  capability?: ContentCapability;
}): Promise<ContentReference> {
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

  const delegate = getStoredContentReferenceDelegate();
  if (delegate) {
    try {
      await delegate.upsert({
        where: { contentRefId },
        update: {
          ownerUserId: params.userId,
          sourceKind: STORED_CONTENT_SOURCE_KIND,
          locator,
          displayName: params.displayName ?? null,
          mimeHint: params.mimeHint ?? null,
          trustClass: params.trustClass,
          requiresApproval: params.requiresApproval ?? false,
          capability: params.capability ?? resolveContentCapability(params.mimeHint),
          provenance: params.provenance,
          data: params.buffer,
          sizeBytes: params.buffer.length,
        },
        create: {
          contentRefId,
          ownerUserId: params.userId,
          sourceKind: STORED_CONTENT_SOURCE_KIND,
          locator,
          displayName: params.displayName ?? null,
          mimeHint: params.mimeHint ?? null,
          trustClass: params.trustClass,
          requiresApproval: params.requiresApproval ?? false,
          capability: params.capability ?? resolveContentCapability(params.mimeHint),
          provenance: params.provenance,
          data: params.buffer,
          sizeBytes: params.buffer.length,
        },
      });
    } catch (error) {
      logger.warn('[contentIngestion] stored content reference persistence degraded', {
        ownerUserId: params.userId,
        contentRefId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

async function readStoredContentAsset(params: {
  referenceId: string;
}): Promise<{
  ownerUserId: string;
  buffer: Buffer;
  filename: string | null;
  mimeType: string | null;
  storedAt: number | null;
} | null> {
  const cached = readContentReferenceBuffer(params.referenceId);
  if (cached) {
    return {
      ownerUserId: cached.ownerUserId,
      buffer: cached.buffer,
      filename: cached.filename,
      mimeType: cached.mimeType,
      storedAt: cached.storedAt,
    };
  }

  const delegate = getStoredContentReferenceDelegate();
  if (!delegate) {
    return null;
  }

  try {
    const record = await delegate.findUnique({
      where: { contentRefId: params.referenceId },
      select: {
        ownerUserId: true,
        data: true,
        displayName: true,
        mimeHint: true,
        createdAt: true,
      },
    });

    if (!record) {
      return null;
    }

    storeContentReferenceBuffer({
      referenceId: params.referenceId,
      ownerUserId: record.ownerUserId,
      buffer: record.data,
      filename: record.displayName,
      mimeType: record.mimeHint,
    });

    return {
      ownerUserId: record.ownerUserId,
      buffer: record.data,
      filename: record.displayName,
      mimeType: record.mimeHint,
      storedAt: record.createdAt.getTime(),
    };
  } catch (error) {
    logger.warn('[contentIngestion] stored content reference load degraded', {
      referenceId: params.referenceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function resolveStoredContentReferenceAsset(params: {
  userId: string;
  reference: ContentReference;
}): Promise<ContentAssetResolution> {
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

  const stored = await readStoredContentAsset({
    referenceId: params.reference.contentRefId,
  });
  if (!stored || stored.ownerUserId !== params.userId) {
    return {
      ok: false,
      error: 'content_reference_not_found',
      message: 'That uploaded content is no longer available. Please upload it again.',
      reference: params.reference,
    };
  }

  return {
    ok: true,
    reference: params.reference,
    ownerUserId: stored.ownerUserId,
    bytes: stored.buffer,
    filename: stored.filename,
    mimeType: stored.mimeType,
    storedAt: stored.storedAt,
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
  const asset = await resolveStoredContentReferenceAsset({
    userId: params.userId,
    reference: params.reference,
  });
  if (!asset.ok) {
    return asset;
  }

  const extraction = await extractContentFromBuffer({
    buffer: asset.bytes,
    mimeType: params.reference.mimeHint ?? asset.mimeType ?? undefined,
    filename: params.reference.displayName ?? asset.filename ?? undefined,
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
    reference: asset.reference,
  };
}
