function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function sanitizeMcpText(value: string, maxLength = 4_000): string {
  return truncateString(stripControlChars(value), maxLength);
}

export function sanitizeMcpJson(value: unknown, maxDepth = 5): unknown {
  if (maxDepth <= 0) {
    return '[truncated]';
  }

  if (typeof value === 'string') {
    return sanitizeMcpText(value, 2_000);
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeMcpJson(entry, maxDepth - 1));
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, 40)
    .map(([key, entryValue]) => [key, sanitizeMcpJson(entryValue, maxDepth - 1)] as const);

  return Object.fromEntries(entries);
}
