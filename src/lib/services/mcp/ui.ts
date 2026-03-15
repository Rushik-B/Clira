export type ConnectionStatus = 'pending' | 'synced' | 'degraded' | 'disabled';
export type TransportType = 'stdio' | 'streamable_http';
export type AuthMode = 'none' | 'bearer_token' | 'static_header';

export interface McpConnectionSummary {
  id: string;
  serverKey: string;
  displayName: string;
  packDescription: string | null;
  status: ConnectionStatus;
  transport: { type: TransportType };
  degradedReason: string | null;
  toolCount: number;
  healthy: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolSummary {
  id: string;
  toolName: string;
  displayTitle: string;
  description: string | null;
  actionClass: string;
  safeForAutoUse: boolean;
}

export interface McpHeaderEntry {
  id: string;
  name: string;
  value: string;
}

const SYNC_COMPLETION_CLOCK_SKEW_MS = 5_000;

function trimOrEmpty(value: string): string {
  return value.trim();
}

export function parseTransportHeaders(entries: readonly McpHeaderEntry[]): {
  headers?: Record<string, string>;
  error?: string;
} {
  const headers: Record<string, string> = {};
  const seenNames = new Set<string>();

  for (const entry of entries) {
    const name = trimOrEmpty(entry.name);
    const value = entry.value.trim();

    if (!name && !value) {
      continue;
    }

    if (!name) {
      return { error: 'Each transport header must include a header name.' };
    }

    if (!value) {
      return { error: `Transport header "${name}" is missing a value.` };
    }

    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      return { error: `Transport header "${name}" is duplicated.` };
    }

    seenNames.add(normalizedName);
    headers[name] = value;
  }

  return Object.keys(headers).length > 0 ? { headers } : {};
}

export function parseEnvironmentVariables(raw: string): {
  env?: Record<string, string>;
  error?: string;
} {
  const env: Record<string, string> = {};

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      return { error: `Invalid environment variable "${line}". Use KEY=VALUE.` };
    }

    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1);

    if (!key) {
      return { error: `Invalid environment variable "${line}". KEY cannot be empty.` };
    }

    if (Object.hasOwn(env, key)) {
      return { error: `Environment variable "${key}" is duplicated.` };
    }

    env[key] = value;
  }

  return Object.keys(env).length > 0 ? { env } : {};
}

export function buildConnectionSnapshotVersion(
  connection: Pick<
    McpConnectionSummary,
    'id' | 'status' | 'toolCount' | 'lastSyncedAt' | 'updatedAt' | 'degradedReason'
  >,
): string {
  return [
    connection.id,
    connection.status,
    connection.toolCount,
    connection.lastSyncedAt ?? 'never',
    connection.updatedAt,
    connection.degradedReason ?? 'ok',
  ].join(':');
}

export function reconcileSyncingConnectionIds(
  currentSyncingIds: ReadonlySet<string>,
  connections: readonly Pick<McpConnectionSummary, 'id' | 'updatedAt' | 'lastSyncedAt'>[],
  requestedAtById: ReadonlyMap<string, number>,
): Set<string> {
  if (currentSyncingIds.size === 0) {
    return new Set();
  }

  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const nextSyncingIds = new Set<string>();

  for (const connectionId of currentSyncingIds) {
    const connection = connectionsById.get(connectionId);
    if (!connection) {
      continue;
    }

    const requestedAt = requestedAtById.get(connectionId);
    if (!requestedAt) {
      nextSyncingIds.add(connectionId);
      continue;
    }

    const updatedAtMs = Date.parse(connection.updatedAt);
    const lastSyncedAtMs = connection.lastSyncedAt ? Date.parse(connection.lastSyncedAt) : Number.NaN;
    const completionThreshold = requestedAt - SYNC_COMPLETION_CLOCK_SKEW_MS;

    if (
      (Number.isFinite(updatedAtMs) && updatedAtMs >= completionThreshold) ||
      (Number.isFinite(lastSyncedAtMs) && lastSyncedAtMs >= completionThreshold)
    ) {
      continue;
    }

    nextSyncingIds.add(connectionId);
  }

  return nextSyncingIds;
}
