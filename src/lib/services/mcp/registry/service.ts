import type {
  McpActionClass as PrismaMcpActionClass,
  McpLatencyClass as PrismaMcpLatencyClass,
  Prisma,
} from '@prisma/client';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { prisma } from '@/lib/prisma';
import {
  getMcpConnectionWithSecrets,
  listMcpConnectionsForUser,
  markMcpConnectionDegraded,
  markMcpConnectionSyncSuccess,
} from '@/lib/services/mcp/connections/service';
import {
  invalidateConnectionCaches,
  getCachedRegistrySnapshot,
  setCachedRegistrySnapshot,
} from '@/lib/services/mcp/registry/cache';
import { createMcpTransportClient } from '@/lib/services/mcp/runtime/client';
import {
  buildMcpDisplayTitle,
  classifyMcpActionClass,
  classifyMcpLatencyClass,
} from '@/lib/services/mcp/manifests/classification';
import {
  normalizeMcpInputSchema,
  normalizeMcpOutputSchema,
  slugifyMcpSegment,
} from '@/lib/services/mcp/manifests/normalization';
import { getMcpSyncTimeoutMs } from '@/lib/services/mcp/config/featureFlags';
import {
  toPrismaJsonObject,
  toPrismaNullableJsonValue,
  toPrismaJsonValue,
} from '@/lib/services/mcp/utils/prismaJson';
import {
  McpServiceError,
  type McpActionClass,
  type McpConnectionRecord,
  type McpRegistrySnapshot,
  type McpToolManifestRecord,
} from '@/lib/services/mcp/types';

type ManifestRow = Prisma.McpToolManifestGetPayload<{
  select: {
    id: true;
    connectionId: true;
    toolName: true;
    toolSlug: true;
    modelToolName: true;
    displayTitle: true;
    description: true;
    inputSchema: true;
    outputSchema: true;
    annotations: true;
    actionClass: true;
    latencyClass: true;
    safeForAutoUse: true;
    syncDiagnostics: true;
    lastSyncedAt: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

const MANIFEST_SELECT = {
  id: true,
  connectionId: true,
  toolName: true,
  toolSlug: true,
  modelToolName: true,
  displayTitle: true,
  description: true,
  inputSchema: true,
  outputSchema: true,
  annotations: true,
  actionClass: true,
  latencyClass: true,
  safeForAutoUse: true,
  syncDiagnostics: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toPrismaActionClass(value: McpActionClass): PrismaMcpActionClass {
  switch (value) {
    case 'read':
      return 'READ';
    case 'write':
      return 'WRITE';
    case 'delete':
      return 'DELETE';
    default:
      return 'SIDE_EFFECTFUL';
  }
}

function fromPrismaActionClass(value: PrismaMcpActionClass): McpActionClass {
  switch (value) {
    case 'READ':
      return 'read';
    case 'WRITE':
      return 'write';
    case 'DELETE':
      return 'delete';
    default:
      return 'side_effectful';
  }
}

function fromPrismaLatencyClass(value: PrismaMcpLatencyClass): McpToolManifestRecord['latencyClass'] {
  switch (value) {
    case 'FAST':
      return 'fast';
    case 'SLOW':
      return 'slow';
    default:
      return 'standard';
  }
}

function toPrismaLatencyClass(value: McpToolManifestRecord['latencyClass']): PrismaMcpLatencyClass {
  switch (value) {
    case 'fast':
      return 'FAST';
    case 'slow':
      return 'SLOW';
    default:
      return 'STANDARD';
  }
}

function buildToolForClassification(row: ManifestRow): Tool {
  return {
    name: row.toolName,
    description: row.description ?? undefined,
    inputSchema: row.inputSchema as Tool['inputSchema'],
    outputSchema: row.outputSchema as Tool['outputSchema'],
    annotations:
      row.annotations && typeof row.annotations === 'object' && !Array.isArray(row.annotations)
        ? (row.annotations as Tool['annotations'])
        : undefined,
  };
}

function resolveStoredActionClass(row: ManifestRow): McpActionClass {
  const classified = classifyMcpActionClass(buildToolForClassification(row));
  const persisted = fromPrismaActionClass(row.actionClass);

  return classified === persisted ? persisted : classified;
}

function toManifestRecord(row: ManifestRow): McpToolManifestRecord {
  const actionClass = resolveStoredActionClass(row);

  return {
    id: row.id,
    connectionId: row.connectionId,
    toolName: row.toolName,
    toolSlug: row.toolSlug,
    modelToolName: row.modelToolName,
    displayTitle: row.displayTitle,
    description: row.description,
    inputSchema: row.inputSchema as Record<string, unknown>,
    outputSchema: row.outputSchema as Record<string, unknown> | null,
    annotations: row.annotations as Record<string, unknown> | null,
    actionClass,
    latencyClass: fromPrismaLatencyClass(row.latencyClass),
    safeForAutoUse: row.safeForAutoUse || actionClass === 'read',
    syncDiagnostics: row.syncDiagnostics,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type NormalizedManifest = {
  toolName: string;
  toolSlug: string;
  modelToolName: string;
  displayTitle: string;
  description: string | null;
  inputSchema: Prisma.InputJsonObject;
  outputSchema: Prisma.InputJsonObject | null;
  annotations: Prisma.InputJsonValue | null;
  actionClass: McpActionClass;
  latencyClass: McpToolManifestRecord['latencyClass'];
  safeForAutoUse: boolean;
  syncDiagnostics: Prisma.InputJsonObject | null;
};

type PackDescriptionManifest = {
  displayTitle: string;
  actionClass: McpActionClass;
};

export function buildMcpPackDescription(
  displayName: string,
  manifests: readonly PackDescriptionManifest[],
): string {
  if (manifests.length === 0) {
    return `${displayName}: no tools synced yet`;
  }

  const readTools = manifests.filter((manifest) => manifest.actionClass === 'read');
  const writeTools = manifests.filter((manifest) => manifest.actionClass !== 'read');
  const toolNames = manifests.slice(0, 8).map((manifest) => manifest.displayTitle);
  const parts = [`${displayName}:`];

  if (readTools.length > 0) {
    parts.push(`${readTools.length} read tools`);
  }

  if (writeTools.length > 0) {
    parts.push(`${writeTools.length} mutation tools`);
  }

  parts.push(`(${toolNames.join(', ')}${manifests.length > 8 ? ', ...' : ''})`);
  return parts.join(' ');
}

function normalizeToolManifests(connection: McpConnectionRecord, tools: Tool[]): {
  manifests: NormalizedManifest[];
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const seenToolNames = new Set<string>();
  const usedModelNames = new Set<string>();
  const manifests: NormalizedManifest[] = [];

  const sortedTools = [...tools].sort((left, right) => left.name.localeCompare(right.name));

  for (const tool of sortedTools) {
    const toolName = tool.name?.trim();
    if (!toolName) {
      diagnostics.push('Skipped tool with empty name.');
      continue;
    }

    if (seenToolNames.has(toolName)) {
      diagnostics.push(`Skipped duplicate tool name "${toolName}".`);
      continue;
    }
    seenToolNames.add(toolName);

    const actionClass = classifyMcpActionClass(tool);
    const latencyClass = classifyMcpLatencyClass(tool);
    const toolSlugBase = slugifyMcpSegment(toolName);
    const normalizedOutputSchema = normalizeMcpOutputSchema(tool.outputSchema);

    let toolSlug = toolSlugBase;
    let modelToolName = `mcp__${connection.serverKey}__${toolSlug}`;
    let suffix = 2;
    while (usedModelNames.has(modelToolName)) {
      toolSlug = `${toolSlugBase}_${suffix}`;
      modelToolName = `mcp__${connection.serverKey}__${toolSlug}`;
      suffix += 1;
    }
    usedModelNames.add(modelToolName);

    manifests.push({
      toolName,
      toolSlug,
      modelToolName,
      displayTitle: buildMcpDisplayTitle(tool),
      description: tool.description?.trim() || null,
      inputSchema: toPrismaJsonObject(normalizeMcpInputSchema(tool.inputSchema)),
      outputSchema: normalizedOutputSchema
        ? toPrismaJsonObject(normalizedOutputSchema)
        : null,
      annotations: tool.annotations ? toPrismaJsonValue(tool.annotations) : null,
      actionClass,
      latencyClass,
      safeForAutoUse: actionClass === 'read',
      syncDiagnostics:
        tool.annotations?.readOnlyHint === true
          ? toPrismaJsonObject({ source: 'annotation', readOnlyHint: true })
          : null,
    });
  }

  return { manifests, diagnostics };
}

export async function syncMcpConnectionRegistry(params: {
  connectionId: string;
  userId?: string;
}): Promise<{
  connection: McpConnectionRecord;
  manifests: McpToolManifestRecord[];
  diagnostics: string[];
}> {
  const bundle = await getMcpConnectionWithSecrets(params);
  if (!bundle) {
    throw new McpServiceError('MCP connection not found for sync.', {
      errorClass: 'not_found',
    });
  }

  if (bundle.connection.status === 'disabled' || bundle.connection.disabledAt) {
    throw new McpServiceError('Disabled MCP connections cannot be synced.', {
      errorClass: 'disabled_connection',
    });
  }

  const client = await createMcpTransportClient({
    connection: bundle.connection,
    secrets: bundle.secrets,
    timeoutMs: getMcpSyncTimeoutMs(),
  });

  try {
    const listedTools = await client.listTools();
    const normalized = normalizeToolManifests(bundle.connection, listedTools);
    const syncedAt = new Date();
    const packDescription = buildMcpPackDescription(
      bundle.connection.displayName,
      normalized.manifests,
    );

    await prisma.$transaction(
      async (tx) => {
        await tx.mcpToolManifest.deleteMany({
          where: {
            connectionId: bundle.connection.id,
            toolName: {
              notIn: normalized.manifests.map((manifest) => manifest.toolName),
            },
          },
        });

        for (const manifest of normalized.manifests) {
          await tx.mcpToolManifest.upsert({
            where: {
              McpToolManifest_connectionId_toolName_key: {
                connectionId: bundle.connection.id,
                toolName: manifest.toolName,
              },
            },
            create: {
              connectionId: bundle.connection.id,
              toolName: manifest.toolName,
              toolSlug: manifest.toolSlug,
              modelToolName: manifest.modelToolName,
              displayTitle: manifest.displayTitle,
              description: manifest.description,
              inputSchema: manifest.inputSchema,
              outputSchema: toPrismaNullableJsonValue(manifest.outputSchema),
              annotations: toPrismaNullableJsonValue(manifest.annotations),
              actionClass: toPrismaActionClass(manifest.actionClass),
              latencyClass: toPrismaLatencyClass(manifest.latencyClass),
              safeForAutoUse: manifest.safeForAutoUse,
              syncDiagnostics: toPrismaNullableJsonValue(manifest.syncDiagnostics),
              lastSyncedAt: syncedAt,
            },
            update: {
              toolSlug: manifest.toolSlug,
              modelToolName: manifest.modelToolName,
              displayTitle: manifest.displayTitle,
              description: manifest.description,
              inputSchema: manifest.inputSchema,
              outputSchema: toPrismaNullableJsonValue(manifest.outputSchema),
              annotations: toPrismaNullableJsonValue(manifest.annotations),
              actionClass: toPrismaActionClass(manifest.actionClass),
              latencyClass: toPrismaLatencyClass(manifest.latencyClass),
              safeForAutoUse: manifest.safeForAutoUse,
              syncDiagnostics: toPrismaNullableJsonValue(manifest.syncDiagnostics),
              lastSyncedAt: syncedAt,
            },
          });
        }
      },
      { timeout: 30_000 },
    );

    await markMcpConnectionSyncSuccess({
      connectionId: bundle.connection.id,
      syncedAt,
      packDescription,
      diagnostics: toPrismaJsonObject({
        toolsDiscovered: normalized.manifests.length,
        diagnostics: normalized.diagnostics,
      }),
    });
    invalidateConnectionCaches({
      connectionId: bundle.connection.id,
      userId: bundle.connection.userId,
    });

    const manifestRows = await prisma.mcpToolManifest.findMany({
      where: { connectionId: bundle.connection.id },
      select: MANIFEST_SELECT,
      orderBy: { modelToolName: 'asc' },
    });

    return {
      connection: bundle.connection,
      manifests: manifestRows.map(toManifestRecord),
      diagnostics: normalized.diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manifest sync failed.';
    await markMcpConnectionDegraded({
      connectionId: bundle.connection.id,
      reason: message.slice(0, 500),
      syncDiagnostics: toPrismaJsonObject({
        phase: 'manifest_sync',
        message: message.slice(0, 1_000),
      }),
    });
    invalidateConnectionCaches({
      connectionId: bundle.connection.id,
      userId: bundle.connection.userId,
    });
    throw error;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function loadMcpRegistrySnapshot(userId: string): Promise<McpRegistrySnapshot> {
  const cached = getCachedRegistrySnapshot(userId);
  if (cached) {
    return cached;
  }

  const [connections, manifestRows] = await Promise.all([
    listMcpConnectionsForUser(userId),
    prisma.mcpToolManifest.findMany({
      where: {
        connection: {
          userId,
        },
      },
      select: MANIFEST_SELECT,
      orderBy: [{ modelToolName: 'asc' }],
    }),
  ]);

  const grouped = new Map<string, McpToolManifestRecord[]>();
  for (const row of manifestRows) {
    const items = grouped.get(row.connectionId) ?? [];
    items.push(toManifestRecord(row));
    grouped.set(row.connectionId, items);
  }

  const snapshot: McpRegistrySnapshot = {
    userId,
    fetchedAt: new Date(),
    connections: connections.map((connection) => ({
      connection,
      tools: grouped.get(connection.id) ?? [],
    })),
  };

  setCachedRegistrySnapshot(snapshot);
  return snapshot;
}

export async function getMcpManifestByModelToolName(params: {
  userId: string;
  modelToolName: string;
}): Promise<{ connection: McpConnectionRecord; tool: McpToolManifestRecord } | null> {
  const snapshot = await loadMcpRegistrySnapshot(params.userId);
  for (const entry of snapshot.connections) {
    const tool = entry.tools.find((candidate) => candidate.modelToolName === params.modelToolName);
    if (tool && !entry.connection.disabledToolNames.includes(tool.toolName)) {
      return { connection: entry.connection, tool };
    }
  }
  return null;
}
