import { getMcpHealthCacheTtlMs, getMcpManifestCacheTtlMs } from '@/lib/services/mcp/config/featureFlags';
import type { McpRegistrySnapshot } from '@/lib/services/mcp/types';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const registryCache = new Map<string, CacheEntry<McpRegistrySnapshot>>();
const healthCache = new Map<string, CacheEntry<boolean>>();

export function getCachedRegistrySnapshot(userId: string): McpRegistrySnapshot | null {
  const entry = registryCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    registryCache.delete(userId);
    return null;
  }
  return entry.value;
}

export function setCachedRegistrySnapshot(snapshot: McpRegistrySnapshot): void {
  registryCache.set(snapshot.userId, {
    value: snapshot,
    expiresAt: Date.now() + getMcpManifestCacheTtlMs(),
  });
}

export function invalidateRegistrySnapshot(userId: string): void {
  registryCache.delete(userId);
}

export function getCachedConnectionHealth(connectionId: string): boolean | null {
  const entry = healthCache.get(connectionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    healthCache.delete(connectionId);
    return null;
  }
  return entry.value;
}

export function setCachedConnectionHealth(connectionId: string, healthy: boolean): void {
  healthCache.set(connectionId, {
    value: healthy,
    expiresAt: Date.now() + getMcpHealthCacheTtlMs(),
  });
}

export function invalidateConnectionCaches(params: { connectionId: string; userId: string }): void {
  healthCache.delete(params.connectionId);
  invalidateRegistrySnapshot(params.userId);
}
