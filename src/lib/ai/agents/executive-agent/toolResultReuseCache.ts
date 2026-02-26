import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';

const TOOL_RESULT_TTL_MS = {
  search_inbox_context: 10 * 60 * 1000,
  search_calendar: 5 * 60 * 1000,
  check_calendar: 5 * 60 * 1000,
  search_memory: 15 * 60 * 1000,
} as const;

type CacheableToolName = keyof typeof TOOL_RESULT_TTL_MS;
type CacheSource = 'history' | 'runtime';

type CacheEntry = {
  result: unknown;
  storedAtMs: number;
  source: CacheSource;
};

type ExtractedToolResult = {
  toolName: CacheableToolName;
  args: unknown;
  result: unknown;
};

type CacheMetadata = {
  hit: true;
  source: CacheSource;
  ageMs: number;
  maxAgeMs: number;
  cachedAt: string;
};

type ToolCallRecord = {
  toolName: CacheableToolName;
  args: unknown;
  callId: string | null;
};

const NON_CACHEABLE_ERRORS = new Set([
  'tool_budget_exceeded',
  'deadline_exceeded',
  'superseded_by_newer_message',
  'pending_steer_event',
]);

const NON_CACHEABLE_STATUSES = new Set([
  'deferred',
]);

const CACHEABLE_TOOL_NAMES = new Set<CacheableToolName>([
  'search_inbox_context',
  'search_calendar',
  'check_calendar',
  'search_memory',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCacheableToolName(value: unknown): value is CacheableToolName {
  return typeof value === 'string' && CACHEABLE_TOOL_NAMES.has(value as CacheableToolName);
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, itemValue]) => `${JSON.stringify(key)}:${stableSerialize(itemValue)}`);

  return `{${entries.join(',')}}`;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalizedEntries = Object.entries(value)
    .filter(([, itemValue]) => itemValue !== undefined)
    .map(([key, itemValue]) => [key, normalizeValue(itemValue)] as const);

  return Object.fromEntries(normalizedEntries);
}

function normalizeToolArgs(toolName: CacheableToolName, args: unknown): unknown {
  const normalized = normalizeValue(args);
  if (!isRecord(normalized)) {
    return normalized;
  }

  if (toolName === 'search_inbox_context') {
    return {
      ...normalized,
      mode: normalized.mode ?? 'quick',
    };
  }

  if (toolName === 'search_memory') {
    return {
      ...normalized,
      limit: normalized.limit ?? 5,
    };
  }

  if (toolName === 'search_calendar') {
    return {
      ...normalized,
      maxResults: normalized.maxResults ?? 10,
      minRelevance: normalized.minRelevance ?? 40,
    };
  }

  return normalized;
}

function buildToolCacheKey(toolName: CacheableToolName, args: unknown): string {
  const normalizedArgs = normalizeToolArgs(toolName, args);
  return `${toolName}::${stableSerialize(normalizedArgs)}`;
}

function readToolName(record: Record<string, unknown>): CacheableToolName | null {
  const toolName = record.toolName ?? record.name ?? record.tool;
  if (!isCacheableToolName(toolName)) return null;
  return toolName;
}

function readToolCallId(record: Record<string, unknown>): string | null {
  const candidates = [
    record.toolCallId,
    record.tool_call_id,
    record.callId,
    record.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

function isResultCacheable(result: unknown): boolean {
  if (result === null || result === undefined) return false;

  if (!isRecord(result)) {
    return true;
  }

  const error = typeof result.error === 'string' ? result.error : null;
  if (error && NON_CACHEABLE_ERRORS.has(error)) {
    return false;
  }

  const status = typeof result.status === 'string' ? result.status : null;
  if (status && NON_CACHEABLE_STATUSES.has(status)) {
    return false;
  }

  if (result.ok === false || result.success === false) {
    return false;
  }

  return true;
}

function cloneValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function parseToolCalls(metadata: Record<string, unknown>): ToolCallRecord[] {
  if (!Array.isArray(metadata.toolCalls)) {
    return [];
  }

  const calls: ToolCallRecord[] = [];
  for (const rawCall of metadata.toolCalls) {
    if (!isRecord(rawCall)) continue;
    const toolName = readToolName(rawCall);
    if (!toolName) continue;

    calls.push({
      toolName,
      args: rawCall.args,
      callId: readToolCallId(rawCall),
    });
  }

  return calls;
}

function extractToolResultsFromMessage(params: {
  metadata: Record<string, unknown>;
}): ExtractedToolResult[] {
  if (!Array.isArray(params.metadata.toolResults)) {
    return [];
  }

  const toolCalls = parseToolCalls(params.metadata);
  const callArgsById = new Map<string, unknown>();
  const callArgsByTool = new Map<CacheableToolName, unknown[]>();

  for (const toolCall of toolCalls) {
    if (toolCall.callId) {
      callArgsById.set(toolCall.callId, toolCall.args);
    }

    const existing = callArgsByTool.get(toolCall.toolName) ?? [];
    existing.push(toolCall.args);
    callArgsByTool.set(toolCall.toolName, existing);
  }

  const extracted: ExtractedToolResult[] = [];

  for (const rawResult of params.metadata.toolResults) {
    if (!isRecord(rawResult)) continue;
    const toolName = readToolName(rawResult);
    if (!toolName) continue;

    const toolCallId = readToolCallId(rawResult);
    let args: unknown = undefined;

    if (toolCallId && callArgsById.has(toolCallId)) {
      args = callArgsById.get(toolCallId);
    } else {
      const queue = callArgsByTool.get(toolName);
      if (queue && queue.length > 0) {
        args = queue.shift();
      }
    }

    if (args === undefined) continue;

    const result = rawResult.result;
    if (!isResultCacheable(result)) continue;

    extracted.push({ toolName, args, result });
  }

  return extracted;
}

function attachCacheMetadata(result: unknown, metadata: CacheMetadata): unknown {
  const cloned = cloneValue(result);
  if (isRecord(cloned)) {
    return {
      ...cloned,
      _cache: metadata,
    };
  }
  return cloned;
}

export type ExecutiveToolResultReuseCache = {
  get: <T = unknown>(toolName: CacheableToolName, args: unknown) => T | null;
  set: (toolName: CacheableToolName, args: unknown, result: unknown) => void;
};

export function createExecutiveToolResultReuseCache(params: {
  conversationHistory: ConversationMessageDTO[];
}): ExecutiveToolResultReuseCache {
  const cache = new Map<string, CacheEntry>();

  for (const message of params.conversationHistory) {
    if (message.role !== 'ASSISTANT') continue;
    if (!isRecord(message.metadata)) continue;

    const createdAtMs = new Date(message.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) continue;

    const extracted = extractToolResultsFromMessage({
      metadata: message.metadata,
    });

    for (const item of extracted) {
      const key = buildToolCacheKey(item.toolName, item.args);
      const existing = cache.get(key);
      if (existing && existing.storedAtMs >= createdAtMs) {
        continue;
      }

      cache.set(key, {
        result: cloneValue(item.result),
        storedAtMs: createdAtMs,
        source: 'history',
      });
    }
  }

  return {
    get: <T = unknown>(toolName: CacheableToolName, args: unknown): T | null => {
      const key = buildToolCacheKey(toolName, args);
      const entry = cache.get(key);
      if (!entry) return null;

      const maxAgeMs = TOOL_RESULT_TTL_MS[toolName];
      const ageMs = Date.now() - entry.storedAtMs;

      if (ageMs < 0 || ageMs > maxAgeMs) {
        cache.delete(key);
        return null;
      }

      const withMetadata = attachCacheMetadata(entry.result, {
        hit: true,
        source: entry.source,
        ageMs,
        maxAgeMs,
        cachedAt: new Date(entry.storedAtMs).toISOString(),
      });

      return withMetadata as T;
    },
    set: (toolName: CacheableToolName, args: unknown, result: unknown): void => {
      if (!isResultCacheable(result)) {
        return;
      }

      const key = buildToolCacheKey(toolName, args);
      cache.set(key, {
        result: cloneValue(result),
        storedAtMs: Date.now(),
        source: 'runtime',
      });
    },
  };
}
