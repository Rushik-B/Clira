import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import { parseBooleanEnv, parseBoundedInt } from '@/lib/utils/params';

const DEFAULT_MANIFEST_CACHE_TTL_MS = 60_000;
const DEFAULT_HEALTH_CACHE_TTL_MS = 15_000;
const DEFAULT_RESULT_CACHE_TTL_MS = 90_000;
const DEFAULT_CIRCUIT_OPEN_MS = 5 * 60 * 1000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_SYNC_TIMEOUT_MS = 20_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 20_000;

function readIntEnv(name: string, defaultValue: number, options?: { min?: number; max?: number }): number {
  const parsed = parseBoundedInt(name, process.env[name], {
    defaultValue,
    min: options?.min,
    max: options?.max,
  });
  return parsed.ok ? parsed.value : defaultValue;
}

export function isMcpEnabled(): boolean {
  return parseBooleanEnv(process.env.CLIRA_MCP_ENABLED, false);
}

export function isMcpChannelEnabled(channel: ProgressUpdateChannel): boolean {
  return parseBooleanEnv(
    process.env[`CLIRA_MCP_${channel.toUpperCase()}_ENABLED`],
    true,
  );
}

export function getMcpManifestCacheTtlMs(): number {
  return readIntEnv('CLIRA_MCP_MANIFEST_CACHE_TTL_MS', DEFAULT_MANIFEST_CACHE_TTL_MS, {
    min: 1_000,
    max: 15 * 60 * 1000,
  });
}

export function getMcpHealthCacheTtlMs(): number {
  return readIntEnv('CLIRA_MCP_HEALTH_CACHE_TTL_MS', DEFAULT_HEALTH_CACHE_TTL_MS, {
    min: 1_000,
    max: 10 * 60 * 1000,
  });
}

export function getMcpResultCacheTtlMs(): number {
  return readIntEnv('CLIRA_MCP_RESULT_CACHE_TTL_MS', DEFAULT_RESULT_CACHE_TTL_MS, {
    min: 5_000,
    max: 10 * 60 * 1000,
  });
}

export function getMcpCircuitFailureThreshold(): number {
  return readIntEnv(
    'CLIRA_MCP_CIRCUIT_FAILURE_THRESHOLD',
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
    { min: 1, max: 20 },
  );
}

export function getMcpCircuitOpenMs(): number {
  return readIntEnv('CLIRA_MCP_CIRCUIT_OPEN_MS', DEFAULT_CIRCUIT_OPEN_MS, {
    min: 1_000,
    max: 60 * 60 * 1000,
  });
}

export function getMcpSyncTimeoutMs(): number {
  return readIntEnv('CLIRA_MCP_SYNC_TIMEOUT_MS', DEFAULT_SYNC_TIMEOUT_MS, {
    min: 5_000,
    max: 5 * 60 * 1000,
  });
}

export function getMcpHealthTimeoutMs(): number {
  return readIntEnv('CLIRA_MCP_HEALTH_TIMEOUT_MS', DEFAULT_HEALTH_TIMEOUT_MS, {
    min: 2_000,
    max: 60 * 1000,
  });
}

export function getMcpExecutionTimeoutMs(): number {
  return readIntEnv('CLIRA_MCP_EXECUTION_TIMEOUT_MS', DEFAULT_EXECUTION_TIMEOUT_MS, {
    min: 5_000,
    max: 5 * 60 * 1000,
  });
}
