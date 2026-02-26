function stripCacheDebugMetadataInternal(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripCacheDebugMetadataInternal(item));
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (key === '_cache') {
      continue;
    }
    sanitized[key] = stripCacheDebugMetadataInternal(nestedValue);
  }

  return sanitized;
}

export function stripCacheDebugMetadataForPersistence<T>(value: T): T {
  return stripCacheDebugMetadataInternal(value) as T;
}
