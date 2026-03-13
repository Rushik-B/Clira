import type { Prisma } from '@prisma/client';

const DEFAULT_MAX_STRING_LENGTH = 24_000;
const SECRET_KEY_PATTERN = /(authorization|token|api[-_]?key|secret|password|cookie|set-cookie)/i;

function truncateString(value: string, maxLength = DEFAULT_MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeKeyValue(
  key: string,
  value: unknown,
  visited: WeakSet<object>,
): Prisma.InputJsonValue {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  return sanitizeForTrace(value, visited);
}

export function sanitizeForTrace(
  value: unknown,
  visited = new WeakSet<object>(),
): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }

  if (typeof value === 'string') {
    return truncateString(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return '[Function]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack, 12_000) : null,
      cause: value.cause ? sanitizeForTrace(value.cause, visited) : null,
    } as Prisma.InputJsonObject;
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return {
      type: 'Buffer',
      byteLength: value.length,
    } as Prisma.InputJsonObject;
  }

  if (value instanceof Uint8Array) {
    return {
      type: value.constructor?.name ?? 'Uint8Array',
      byteLength: value.byteLength,
    } as Prisma.InputJsonObject;
  }

  if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) {
    return {
      type: 'AbortSignal',
      aborted: value.aborted,
    } as Prisma.InputJsonObject;
  }

  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return '[Circular]';
    }
    visited.add(value);
    try {
      return value.map((item) => sanitizeForTrace(item, visited)) as Prisma.InputJsonArray;
    } finally {
      visited.delete(value);
    }
  }

  if (!isPlainObject(value)) {
    try {
      return truncateString(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  if (visited.has(value)) {
    return '[Circular]';
  }

  visited.add(value);
  try {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = sanitizeKeyValue(key, entry, visited);
    }
    return result as Prisma.InputJsonObject;
  } finally {
    visited.delete(value);
  }
}

export function previewText(value: unknown, maxLength = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}
