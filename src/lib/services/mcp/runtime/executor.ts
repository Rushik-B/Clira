import type { McpActionClass as PrismaMcpActionClass, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getMcpResultCacheTtlMs } from '@/lib/services/mcp/config/featureFlags';
import { getMcpConnectionWithSecrets } from '@/lib/services/mcp/connections/service';
import { getCachedMcpResult, setCachedMcpResult } from '@/lib/services/mcp/cache/resultCache';
import { getMcpManifestByModelToolName } from '@/lib/services/mcp/registry/service';
import { createMcpTransportClient } from '@/lib/services/mcp/runtime/client';
import { sanitizeMcpJson, sanitizeMcpText } from '@/lib/services/mcp/security/sanitization';
import {
  toPrismaJsonObject,
  toPrismaNullableJsonValue,
} from '@/lib/services/mcp/utils/prismaJson';
import type {
  McpActionClass,
  McpExecutionRequest,
  McpExecutionResult,
} from '@/lib/services/mcp/types';

function toPrismaActionClass(actionClass: McpActionClass): PrismaMcpActionClass {
  switch (actionClass) {
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

function sanitizeContentBlocks(content: unknown[]): unknown[] {
  return content.slice(0, 8).map((block) => {
    if (!block || typeof block !== 'object') {
      return sanitizeMcpJson(block);
    }

    const record = block as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      return {
        type: 'text',
        text: sanitizeMcpText(record.text),
      };
    }

    return sanitizeMcpJson(record, 3);
  });
}

function buildFreshness(lastSyncedAt: Date | null) {
  return {
    cacheTtlMs: getMcpResultCacheTtlMs(),
    cachedAt: new Date().toISOString(),
    connectionLastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  };
}

export async function executeMcpTool(
  request: McpExecutionRequest,
): Promise<McpExecutionResult> {
  const registryEntry = await getMcpManifestByModelToolName({
    userId: request.userId,
    modelToolName: request.toolName,
  });

  if (!registryEntry) {
    return {
      ok: false,
      toolName: request.toolName,
      modelToolName: request.toolName,
      connectionId: request.connectionId,
      displayName: 'Unknown MCP connection',
      content: [],
      degraded: true,
      latencyMs: 0,
      cache: 'miss',
      freshness: buildFreshness(null),
      errorClass: 'tool_not_found',
      userFacingDegradedReason: 'The requested MCP tool is no longer available.',
    };
  }

  const freshnessKey = registryEntry.connection.lastSyncedAt?.toISOString() ?? 'never';
  const cached = getCachedMcpResult({
    userId: request.userId,
    connectionId: registryEntry.connection.id,
    modelToolName: registryEntry.tool.modelToolName,
    args: request.args,
    freshnessKey,
  });
  if (cached) {
    await prisma.mcpExecutionAudit.create({
      data: {
        userId: request.userId,
        connectionId: registryEntry.connection.id,
        toolName: registryEntry.tool.toolName,
        modelToolName: registryEntry.tool.modelToolName,
        actionClass: toPrismaActionClass(registryEntry.tool.actionClass),
        args: toPrismaJsonObject(request.args),
        resultSummary: toPrismaJsonObject({
          cache: 'hit',
          ok: cached.ok,
        }),
        latencyMs: cached.latencyMs,
        cacheHit: true,
        freshness: toPrismaJsonObject(cached.freshness),
        degraded: cached.degraded,
        errorClass: cached.errorClass,
        idempotencyKey: request.idempotencyKey,
      },
    }).catch(() => {});

    return cached;
  }

  const connectionWithSecrets = await getMcpConnectionWithSecrets({
    connectionId: registryEntry.connection.id,
    userId: request.userId,
  });

  if (!connectionWithSecrets) {
    return {
      ok: false,
      toolName: registryEntry.tool.toolName,
      modelToolName: registryEntry.tool.modelToolName,
      connectionId: registryEntry.connection.id,
      displayName: registryEntry.connection.displayName,
      content: [],
      degraded: true,
      latencyMs: 0,
      cache: 'miss',
      freshness: buildFreshness(registryEntry.connection.lastSyncedAt),
      errorClass: 'connection_not_found',
      userFacingDegradedReason: 'The MCP connection is no longer available.',
    };
  }

  const startedAt = Date.now();
  const client = await createMcpTransportClient({
    connection: connectionWithSecrets.connection,
    secrets: connectionWithSecrets.secrets,
    timeoutMs: request.deadlineMs,
  });

  let result: McpExecutionResult;
  try {
    const response = await client.callTool(
      registryEntry.tool.toolName,
      request.args,
      { timeoutMs: request.deadlineMs },
    );

    result = {
      ok: !response.isError,
      toolName: registryEntry.tool.toolName,
      modelToolName: registryEntry.tool.modelToolName,
      connectionId: registryEntry.connection.id,
      displayName: registryEntry.connection.displayName,
      content: sanitizeContentBlocks(Array.isArray(response.content) ? response.content : []),
      structuredContent:
        response.structuredContent && typeof response.structuredContent === 'object'
          ? (sanitizeMcpJson(response.structuredContent, 4) as Record<string, unknown>)
          : undefined,
      degraded: false,
      latencyMs: Date.now() - startedAt,
      cache: 'miss',
      freshness: buildFreshness(registryEntry.connection.lastSyncedAt),
      ...(response.isError ? { errorClass: 'tool_error' } : {}),
      userFacingDegradedReason: null,
    };
  } catch (error) {
    result = {
      ok: false,
      toolName: registryEntry.tool.toolName,
      modelToolName: registryEntry.tool.modelToolName,
      connectionId: registryEntry.connection.id,
      displayName: registryEntry.connection.displayName,
      content: [],
      degraded: true,
      latencyMs: Date.now() - startedAt,
      cache: 'miss',
      freshness: buildFreshness(registryEntry.connection.lastSyncedAt),
      errorClass: 'execution_failed',
      userFacingDegradedReason:
        error instanceof Error ? sanitizeMcpText(error.message, 240) : 'MCP execution failed.',
    };
  } finally {
    await client.close().catch(() => {});
  }

  await prisma.mcpExecutionAudit.create({
    data: {
      userId: request.userId,
      connectionId: registryEntry.connection.id,
      toolName: registryEntry.tool.toolName,
      modelToolName: registryEntry.tool.modelToolName,
      actionClass: toPrismaActionClass(registryEntry.tool.actionClass),
      args: toPrismaJsonObject(request.args),
      resultSummary: toPrismaJsonObject({
        ok: result.ok,
        degraded: result.degraded,
        errorClass: result.errorClass ?? null,
      }),
      latencyMs: result.latencyMs,
      cacheHit: false,
      freshness: toPrismaJsonObject(result.freshness),
      degraded: result.degraded,
      errorClass: result.errorClass,
      idempotencyKey: request.idempotencyKey,
    },
  }).catch(() => {});

  if (registryEntry.tool.actionClass === 'read' && result.ok) {
    setCachedMcpResult({
      userId: request.userId,
      connectionId: registryEntry.connection.id,
      modelToolName: registryEntry.tool.modelToolName,
      args: request.args,
      freshnessKey,
      result,
    });
  }

  return result;
}
