import { createHash } from 'node:crypto';
import { getMcpResultCacheTtlMs } from '@/lib/services/mcp/config/featureFlags';
import type { McpExecutionResult } from '@/lib/services/mcp/types';

type CacheEntry = {
  expiresAt: number;
  result: McpExecutionResult;
};

const resultCache = new Map<string, CacheEntry>();

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(',')}}`;
}

function buildCacheKey(params: {
  userId: string;
  connectionId: string;
  modelToolName: string;
  args: Record<string, unknown>;
  freshnessKey: string;
}): string {
  const payload = [
    params.userId,
    params.connectionId,
    params.modelToolName,
    params.freshnessKey,
    stableSerialize(params.args),
  ].join('::');

  return createHash('sha1').update(payload).digest('hex');
}

export function getCachedMcpResult(params: {
  userId: string;
  connectionId: string;
  modelToolName: string;
  args: Record<string, unknown>;
  freshnessKey: string;
}): McpExecutionResult | null {
  const key = buildCacheKey(params);
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return null;
  }
  return {
    ...entry.result,
    cache: 'hit',
  };
}

export function setCachedMcpResult(params: {
  userId: string;
  connectionId: string;
  modelToolName: string;
  args: Record<string, unknown>;
  freshnessKey: string;
  result: McpExecutionResult;
}): void {
  const key = buildCacheKey(params);
  resultCache.set(key, {
    result: params.result,
    expiresAt: Date.now() + getMcpResultCacheTtlMs(),
  });
}
