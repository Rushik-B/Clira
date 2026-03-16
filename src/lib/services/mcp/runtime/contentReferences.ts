import path from 'node:path';
import { logger } from '@/lib/logger';
import {
  createContentReferenceId,
  extractContentFromBuffer,
  renderContentExtractionForLegacyText,
  type ContentCapability,
  type ContentExtractionResult,
  type ContentReference,
  type ContentTrustClass,
} from '@/lib/services/content-ingestion';
import { getMcpConnectionWithSecrets } from '@/lib/services/mcp/connections/service';
import {
  sanitizeMcpInlineText,
  sanitizeMcpJson,
  sanitizeMcpText,
} from '@/lib/services/mcp/security/sanitization';
import type {
  McpConnectionRecord,
  McpTrustClass,
} from '@/lib/services/mcp/types';
import { createMcpTransportClient } from './client';

const MAX_MODEL_CONTENT_REFS = 12;
const MAX_RESOURCE_READ_PARTS = 4;
const MCP_RESOURCE_LINK_SOURCE_KIND = 'mcp_resource_link';

type McpResourceLocator = {
  connectionId: string;
  uri: string;
  mimeType: string | null;
  displayName: string | null;
};

function mapMcpTrustClass(value: McpTrustClass): ContentTrustClass {
  switch (value) {
    case 'first_party':
      return 'trusted_internal';
    case 'third_party':
      return 'third_party';
    default:
      return 'untrusted_external';
  }
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readMetaField(record: Record<string, unknown>, key: string): string | null {
  const meta = record._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }

  return pickFirstString((meta as Record<string, unknown>)[key]);
}

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

function resolveDisplayName(params: {
  record: Record<string, unknown>;
  fallbackUri?: string | null;
}): string | null {
  return pickFirstString(
    params.record.title,
    params.record.name,
    params.record.filename,
    params.record.fileName,
    readMetaField(params.record, 'title'),
    readMetaField(params.record, 'name'),
    readMetaField(params.record, 'filename'),
    readMetaField(params.record, 'fileName'),
    inferDisplayNameFromUri(params.fallbackUri),
  );
}

function serializeMcpResourceLocator(locator: McpResourceLocator): string {
  return JSON.stringify({
    connectionId: locator.connectionId,
    uri: locator.uri,
    mimeType: locator.mimeType,
    displayName: locator.displayName,
  });
}

function parseMcpResourceLocator(locator: string): McpResourceLocator | null {
  try {
    const parsed = JSON.parse(locator);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const connectionId = pickFirstString(record.connectionId);
    const uri = pickFirstString(record.uri);
    if (!connectionId || !uri) {
      return null;
    }

    return {
      connectionId,
      uri,
      mimeType: pickFirstString(record.mimeType),
      displayName: pickFirstString(record.displayName),
    };
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
    normalized.startsWith('audio/')
  ) {
    return 'document';
  }

  return 'binary';
}

function buildMcpResourceContentReference(params: {
  connection: McpConnectionRecord;
  uri: string;
  mimeType?: string | null;
  displayName?: string | null;
}): ContentReference {
  const locator = serializeMcpResourceLocator({
    connectionId: params.connection.id,
    uri: params.uri,
    mimeType: params.mimeType ?? null,
    displayName: params.displayName ?? null,
  });

  return {
    sourceKind: MCP_RESOURCE_LINK_SOURCE_KIND,
    locator,
    displayName: params.displayName ?? inferDisplayNameFromUri(params.uri),
    mimeHint: params.mimeType ?? null,
    trustClass: mapMcpTrustClass(params.connection.trustClass),
    requiresApproval: false,
    provenance: {
      sourceLabel: params.connection.displayName,
      sourceKind: MCP_RESOURCE_LINK_SOURCE_KIND,
      channel: 'mcp',
      conversationId: null,
      runId: null,
      messageId: null,
      attachmentId: null,
      originUri: params.uri,
    },
    capability: resolveContentCapability(params.mimeType),
    contentRefId: createContentReferenceId({
      sourceKind: MCP_RESOURCE_LINK_SOURCE_KIND,
      locator,
    }),
  };
}

function sanitizeContentReferenceForModel(reference: ContentReference): Record<string, unknown> {
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

function buildResourceLinkSummaryBlock(params: {
  uri: string;
  mimeType?: string | null;
  displayName?: string | null;
  size?: unknown;
}): Record<string, unknown> {
  return {
    type: 'resource_link',
    uri: sanitizeMcpText(params.uri, 600),
    mimeType: params.mimeType ? sanitizeMcpInlineText(params.mimeType, 120) : null,
    displayName: params.displayName ? sanitizeMcpInlineText(params.displayName, 180) : null,
    size: typeof params.size === 'number' && Number.isFinite(params.size) ? params.size : null,
  };
}

function buildExtractionTextBlock(params: {
  label: string;
  displayName?: string | null;
  mimeType?: string | null;
  extraction: ContentExtractionResult;
}): Record<string, unknown> {
  const title = [
    params.label,
    params.displayName ? `: ${params.displayName}` : null,
    params.mimeType ? ` (${params.mimeType})` : null,
  ]
    .filter(Boolean)
    .join('');

  return {
    type: 'text',
    text: sanitizeMcpText(
      [title, renderContentExtractionForLegacyText(params.extraction)]
        .filter(Boolean)
        .join('\n\n'),
      4_000,
    ),
  };
}

async function extractInlineBuffer(params: {
  buffer: Buffer;
  mimeType?: string | null;
  displayName?: string | null;
  connection: McpConnectionRecord;
  originUri?: string | null;
  conversationId?: string;
  runId: string;
}): Promise<ContentExtractionResult> {
  return extractContentFromBuffer({
    buffer: params.buffer,
    mimeType: params.mimeType ?? null,
    filename: params.displayName ?? null,
    trustClass: mapMcpTrustClass(params.connection.trustClass),
    channelLabel: 'mcp',
    provenance: {
      sourceLabel: params.connection.displayName,
      sourceKind: 'mcp_embedded_content',
      channel: 'mcp',
      originUri: params.originUri ?? null,
    },
    scope: {
      conversationId: params.conversationId ?? null,
      runId: params.runId,
    },
  });
}

function decodeBase64Buffer(value: string): Buffer | null {
  try {
    const buffer = Buffer.from(value, 'base64');
    if (buffer.length === 0 && value.trim().length > 0) {
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
}

export async function processMcpResponseContent(params: {
  connection: McpConnectionRecord;
  rawContent: unknown[];
  conversationId?: string;
  runId: string;
}): Promise<{
  content: unknown[];
  contentRefs: ContentReference[];
}> {
  const content: unknown[] = [];
  const contentRefs: ContentReference[] = [];

  for (const block of params.rawContent.slice(0, 8)) {
    if (!block || typeof block !== 'object') {
      content.push(sanitizeMcpJson(block));
      continue;
    }

    const record = block as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      content.push({
        type: 'text',
        text: sanitizeMcpText(record.text),
      });
      continue;
    }

    if (record.type === 'resource_link' && typeof record.uri === 'string') {
      const displayName = resolveDisplayName({
        record,
        fallbackUri: record.uri,
      });
      content.push(
        buildResourceLinkSummaryBlock({
          uri: record.uri,
          mimeType: pickFirstString(record.mimeType),
          displayName,
          size: record.size,
        }),
      );
      contentRefs.push(
        buildMcpResourceContentReference({
          connection: params.connection,
          uri: record.uri,
          mimeType: pickFirstString(record.mimeType),
          displayName,
        }),
      );
      continue;
    }

    if (
      (record.type === 'image' || record.type === 'audio') &&
      typeof record.data === 'string'
    ) {
      const displayName = resolveDisplayName({ record });
      const mimeType = pickFirstString(record.mimeType);
      content.push(
        sanitizeMcpJson(
          {
            type: record.type,
            displayName,
            mimeType,
          },
          2,
        ),
      );

      const buffer = decodeBase64Buffer(record.data);
      if (!buffer) {
        content.push({
          type: 'text',
          text: `${record.type} content could not be decoded.`,
        });
        continue;
      }

      const extraction = await extractInlineBuffer({
        buffer,
        mimeType,
        displayName,
        connection: params.connection,
        conversationId: params.conversationId,
        runId: params.runId,
      });
      content.push(
        buildExtractionTextBlock({
          label: `Embedded MCP ${record.type}`,
          displayName,
          mimeType,
          extraction,
        }),
      );
      continue;
    }

    if (
      record.type === 'resource' &&
      record.resource &&
      typeof record.resource === 'object' &&
      !Array.isArray(record.resource)
    ) {
      const resource = record.resource as Record<string, unknown>;
      const uri = pickFirstString(resource.uri);
      const displayName = resolveDisplayName({
        record: resource,
        fallbackUri: uri,
      });
      const mimeType = pickFirstString(resource.mimeType);
      content.push(
        sanitizeMcpJson(
          {
            type: 'resource',
            uri,
            displayName,
            mimeType,
          },
          2,
        ),
      );

      if (typeof resource.text === 'string') {
        const extraction = await extractInlineBuffer({
          buffer: Buffer.from(resource.text, 'utf8'),
          mimeType: mimeType ?? 'text/plain',
          displayName,
          connection: params.connection,
          originUri: uri,
          conversationId: params.conversationId,
          runId: params.runId,
        });
        content.push(
          buildExtractionTextBlock({
            label: 'Embedded MCP resource',
            displayName,
            mimeType: mimeType ?? 'text/plain',
            extraction,
          }),
        );
        continue;
      }

      if (typeof resource.blob === 'string') {
        const buffer = decodeBase64Buffer(resource.blob);
        if (!buffer) {
          content.push({
            type: 'text',
            text: 'Embedded MCP resource could not be decoded.',
          });
          continue;
        }

        const extraction = await extractInlineBuffer({
          buffer,
          mimeType,
          displayName,
          connection: params.connection,
          originUri: uri,
          conversationId: params.conversationId,
          runId: params.runId,
        });
        content.push(
          buildExtractionTextBlock({
            label: 'Embedded MCP resource',
            displayName,
            mimeType,
            extraction,
          }),
        );
        continue;
      }
    }

    content.push(sanitizeMcpJson(record, 3));
  }

  return { content, contentRefs };
}

function validateContentReference(reference: ContentReference): {
  ok: true;
  locator: McpResourceLocator;
} | {
  ok: false;
  error: string;
  message: string;
} {
  const expectedContentRefId = createContentReferenceId({
    sourceKind: reference.sourceKind,
    locator: reference.locator,
  });
  if (reference.contentRefId !== expectedContentRefId) {
    return {
      ok: false,
      error: 'invalid_content_reference',
      message: 'That content reference is malformed. Please re-run the MCP tool and try again.',
    };
  }

  if (reference.sourceKind !== MCP_RESOURCE_LINK_SOURCE_KIND) {
    return {
      ok: false,
      error: 'unsupported_content_reference',
      message: 'That content reference type is not supported yet.',
    };
  }

  const locator = parseMcpResourceLocator(reference.locator);
  if (!locator) {
    return {
      ok: false,
      error: 'invalid_content_reference',
      message: 'That content reference could not be resolved.',
    };
  }

  return {
    ok: true,
    locator,
  };
}

function sanitizeExtractionResultForModel(
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

export async function readMcpContentReference(params: {
  userId: string;
  reference: ContentReference;
  conversationId?: string;
  runId: string;
  deadlineMs: number;
}): Promise<Record<string, unknown>> {
  const validation = validateContentReference(params.reference);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      message: validation.message,
    };
  }

  const connectionWithSecrets = await getMcpConnectionWithSecrets({
    userId: params.userId,
    connectionId: validation.locator.connectionId,
  });
  if (!connectionWithSecrets) {
    return {
      ok: false,
      error: 'connection_not_found',
      message: 'The MCP connection for that content reference is no longer available.',
    };
  }

  const client = await createMcpTransportClient({
    connection: connectionWithSecrets.connection,
    secrets: connectionWithSecrets.secrets,
    timeoutMs: params.deadlineMs,
  });

  try {
    const response = await client.readResource(validation.locator.uri, {
      timeoutMs: params.deadlineMs,
    });
    const results: Record<string, unknown>[] = [];

    for (const item of response.contents.slice(0, MAX_RESOURCE_READ_PARTS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const resource = item as Record<string, unknown>;
      const uri = pickFirstString(resource.uri) ?? validation.locator.uri;
      const displayName =
        validation.locator.displayName ?? inferDisplayNameFromUri(uri);
      const mimeType =
        pickFirstString(resource.mimeType) ??
        validation.locator.mimeType ??
        params.reference.mimeHint ??
        null;

      let buffer: Buffer | null = null;
      if (typeof resource.text === 'string') {
        buffer = Buffer.from(resource.text, 'utf8');
      } else if (typeof resource.blob === 'string') {
        buffer = decodeBase64Buffer(resource.blob);
      }

      if (!buffer) {
        continue;
      }

      const extraction = await extractContentFromBuffer({
        buffer,
        mimeType: mimeType ?? undefined,
        filename: displayName ?? undefined,
        trustClass: mapMcpTrustClass(connectionWithSecrets.connection.trustClass),
        channelLabel: 'mcp',
        provenance: {
          sourceLabel: connectionWithSecrets.connection.displayName,
          sourceKind: params.reference.sourceKind,
          channel: 'mcp',
          originUri: uri,
        },
        scope: {
          conversationId: params.conversationId ?? null,
          runId: params.runId,
        },
      });

      results.push(sanitizeExtractionResultForModel(extraction));
    }

    if (results.length === 0) {
      return {
        ok: false,
        error: 'resource_empty',
        message: 'That content reference did not yield any readable resource contents.',
        contentRef: sanitizeContentReferenceForModel(params.reference),
      };
    }

    return {
      ok: true,
      contentRef: sanitizeContentReferenceForModel(params.reference),
      resultCount: results.length,
      results,
      truncated: response.contents.length > MAX_RESOURCE_READ_PARTS,
      omittedResultCount: Math.max(0, response.contents.length - MAX_RESOURCE_READ_PARTS),
    };
  } catch (error) {
    logger.warn('[mcp] failed to read content reference', {
      connectionId: validation.locator.connectionId,
      uri: validation.locator.uri,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error: 'resource_read_failed',
      message: sanitizeMcpInlineText(
        error instanceof Error
          ? error.message
          : 'The MCP server could not resolve that content reference.',
        260,
      ),
      contentRef: sanitizeContentReferenceForModel(params.reference),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export function summarizeMcpContentRefsForModel(
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
