import type { Job } from 'bullmq';
import { logger } from '@/lib/logger';
import {
  getMcpConnectionWithSecrets,
  markMcpConnectionDegraded,
  markMcpConnectionHealthSuccess,
} from '@/lib/services/mcp/connections/service';
import {
  getMcpCircuitFailureThreshold,
  getMcpCircuitOpenMs,
  getMcpHealthTimeoutMs,
} from '@/lib/services/mcp/config/featureFlags';
import { invalidateConnectionCaches, setCachedConnectionHealth } from '@/lib/services/mcp/registry/cache';
import { syncMcpConnectionRegistry } from '@/lib/services/mcp/registry/service';
import { createMcpTransportClient } from '@/lib/services/mcp/runtime/client';
import { McpServiceError } from '@/lib/services/mcp/types';
import type {
  McpHealthcheckConnectionJobData,
  McpSyncConnectionJobData,
} from '@/lib/services/utils/queues';

function classifyJobFailure(error: unknown): never {
  if (error instanceof McpServiceError && !error.retryable) {
    throw error;
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export async function processMcpSyncConnectionJob(job: Job<McpSyncConnectionJobData>) {
  logger.info('[MCP] sync start', {
    jobId: job.id,
    ...job.data,
  });

  try {
    const result = await syncMcpConnectionRegistry({
      connectionId: job.data.connectionId,
      userId: job.data.userId,
    });

    setCachedConnectionHealth(job.data.connectionId, true);
    logger.info('[MCP] sync complete', {
      jobId: job.id,
      connectionId: job.data.connectionId,
      manifestCount: result.manifests.length,
      diagnostics: result.diagnostics,
    });
    return {
      status: 'ok' as const,
      manifestCount: result.manifests.length,
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    logger.error('[MCP] sync failed', {
      jobId: job.id,
      connectionId: job.data.connectionId,
      error,
    });
    return classifyJobFailure(error);
  }
}

export async function processMcpHealthcheckConnectionJob(
  job: Job<McpHealthcheckConnectionJobData>,
) {
  logger.info('[MCP] healthcheck start', {
    jobId: job.id,
    ...job.data,
  });

  const bundle = await getMcpConnectionWithSecrets({
    connectionId: job.data.connectionId,
    userId: job.data.userId,
  });

  if (!bundle) {
    throw new McpServiceError('MCP connection not found for healthcheck.', {
      errorClass: 'not_found',
    });
  }

  const client = await createMcpTransportClient({
    connection: bundle.connection,
    secrets: bundle.secrets,
    timeoutMs: getMcpHealthTimeoutMs(),
  });

  try {
    const tools = await client.listTools();
    const checkedAt = new Date();
    await markMcpConnectionHealthSuccess({
      connectionId: bundle.connection.id,
      checkedAt,
      diagnostics: {
        toolsVisible: tools.length,
        reason: job.data.reason,
      },
    });
    invalidateConnectionCaches({
      connectionId: bundle.connection.id,
      userId: bundle.connection.userId,
    });
    setCachedConnectionHealth(bundle.connection.id, true);

    return {
      status: 'healthy' as const,
      toolsVisible: tools.length,
      checkedAt: checkedAt.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MCP healthcheck failed.';
    const failureCount = bundle.connection.consecutiveFailures + 1;
    const threshold = getMcpCircuitFailureThreshold();
    const openUntil =
      failureCount >= threshold
        ? new Date(Date.now() + getMcpCircuitOpenMs())
        : null;

    await markMcpConnectionDegraded({
      connectionId: bundle.connection.id,
      reason: message.slice(0, 500),
      healthDiagnostics: {
        phase: 'healthcheck',
        reason: job.data.reason,
        message: message.slice(0, 1_000),
        failureCount,
        circuitOpenUntil: openUntil?.toISOString() ?? null,
      },
      openedCircuitUntil: openUntil,
    });
    invalidateConnectionCaches({
      connectionId: bundle.connection.id,
      userId: bundle.connection.userId,
    });
    setCachedConnectionHealth(bundle.connection.id, false);
    logger.warn('[MCP] healthcheck degraded', {
      jobId: job.id,
      connectionId: bundle.connection.id,
      failureCount,
      threshold,
      openUntil: openUntil?.toISOString() ?? null,
      error,
    });
    return classifyJobFailure(error);
  } finally {
    await client.close().catch(() => {});
  }
}
