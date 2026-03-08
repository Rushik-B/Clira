function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readToolName(record: Record<string, unknown>): string | null {
  const candidate = record.toolName ?? record.name ?? record.tool;
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function sanitizeSearchInboxContextPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSearchInboxContextPayload(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === '_cache' || key === 'expandedThreads') {
      continue;
    }

    sanitized[key] = stripCacheDebugMetadataInternal(nestedValue);
  }

  return sanitized;
}

function stripCacheDebugMetadataInternal(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripCacheDebugMetadataInternal(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const toolName = readToolName(value);
  const sanitized: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === '_cache') {
      continue;
    }

    if (toolName === 'search_inbox_context' && key === 'result') {
      sanitized[key] = sanitizeSearchInboxContextPayload(nestedValue);
      continue;
    }

    sanitized[key] = stripCacheDebugMetadataInternal(nestedValue);
  }

  return sanitized;
}

export function stripCacheDebugMetadataForPersistence<T>(value: T): T {
  return stripCacheDebugMetadataInternal(value) as T;
}
