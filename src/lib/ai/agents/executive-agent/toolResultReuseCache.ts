import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';

const TOOL_RESULT_TTL_MS = {
  search_inbox_context: 10 * 60 * 1000,
  list_inbox_emails: 10 * 60 * 1000,
  read_email_pdf_attachment: 10 * 60 * 1000,
  search_calendar: 5 * 60 * 1000,
  check_calendar: 5 * 60 * 1000,
  search_memory: 15 * 60 * 1000,
} as const;

const CACHEABLE_TOOL_NAMES = [
  'search_inbox_context',
  'list_inbox_emails',
  'read_email_pdf_attachment',
  'search_calendar',
  'check_calendar',
  'search_memory',
] as const;

type CacheableToolName = (typeof CACHEABLE_TOOL_NAMES)[number];
type CacheSource = 'history' | 'runtime';
type MutationToolName = 'append_to_supermemory' | 'commit_calendar_change';
type CacheMissReason = 'not_found' | 'expired' | 'invalidated';

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

type CacheGetOptions = {
  minStoredAtMs?: number;
};

type ToolCallRecord = {
  toolName: string;
  args: unknown;
  callId: string | null;
};

type CacheStatKey =
  | 'history_hit'
  | 'runtime_hit'
  | 'miss_not_found'
  | 'miss_expired'
  | 'miss_invalidated'
  | 'set_ok'
  | 'set_skipped_non_cacheable';

type CacheToolStats = Record<CacheStatKey, number>;
export type ExecutiveToolResultCacheStats = Record<CacheableToolName, CacheToolStats>;
type ToolInvalidationCutoffs = Partial<Record<CacheableToolName, number>>;

const NON_CACHEABLE_ERRORS = new Set([
  'tool_budget_exceeded',
  'deadline_exceeded',
  'superseded_by_newer_message',
  'pending_steer_event',
]);

const NON_CACHEABLE_STATUSES = new Set([
  'deferred',
]);

const CACHEABLE_TOOL_NAME_SET = new Set<CacheableToolName>(CACHEABLE_TOOL_NAMES);
const HISTORY_MUTATION_TOOL_SET = new Set<MutationToolName>([
  'append_to_supermemory',
  'commit_calendar_change',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCacheableToolName(value: unknown): value is CacheableToolName {
  return typeof value === 'string' && CACHEABLE_TOOL_NAME_SET.has(value as CacheableToolName);
}

function isMutationToolName(value: unknown): value is MutationToolName {
  return typeof value === 'string' && HISTORY_MUTATION_TOOL_SET.has(value as MutationToolName);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

function normalizeCaseInsensitiveString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function deriveSearchInboxIntentFingerprint(args: unknown, result?: unknown): string {
  const argsRecord = isRecord(args) ? args : null;
  const resultRecord = isRecord(result) ? result : null;
  const actionCandidate = argsRecord?.action ?? resultRecord?.action;
  const action = typeof actionCandidate === 'string' && actionCandidate.trim()
    ? actionCandidate.trim()
    : 'find';

  if (
    argsRecord &&
    typeof argsRecord.intentFingerprint === 'string' &&
    argsRecord.intentFingerprint.trim().length > 0
  ) {
    return argsRecord.intentFingerprint.trim().toLowerCase();
  }

  const expansion = isRecord(resultRecord?.expansion) ? resultRecord?.expansion : null;
  const modeCandidate = expansion?.mode;
  const hasExpandedThreads =
    Array.isArray(resultRecord?.expandedThreads) && resultRecord.expandedThreads.length > 0;
  const shape =
    modeCandidate === 'expanded' || hasExpandedThreads
      ? 'expanded'
      : 'compact';

  return `${action}:${shape}`;
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
      intentFingerprint: deriveSearchInboxIntentFingerprint(normalized),
    };
  }

  if (toolName === 'list_inbox_emails') {
    const rawFilters = isRecord(normalized.filters) ? normalized.filters : {};
    const normalizedFilters = isRecord(normalized.filters)
      ? {
          ...rawFilters,
          sender: normalizeCaseInsensitiveString(rawFilters.sender),
          recipient: normalizeCaseInsensitiveString(rawFilters.recipient),
          subjectContains: normalizeCaseInsensitiveString(rawFilters.subjectContains),
          includeDeleted: rawFilters.includeDeleted ?? false,
        }
      : {
          includeDeleted: false,
        };
    const rawOptions = isRecord(normalized.options) ? normalized.options : {};
    return {
      ...normalized,
      mailboxEmail: normalizeCaseInsensitiveString(normalized.mailboxEmail),
      filters: normalizedFilters,
      options: {
        ...rawOptions,
        limit: rawOptions.limit ?? 20,
        sortBy: rawOptions.sortBy ?? 'newest',
        includeBody: rawOptions.includeBody ?? false,
      },
    };
  }

  if (toolName === 'read_email_pdf_attachment') {
    return {
      ...normalized,
      mailboxEmail: normalizeCaseInsensitiveString(normalized.mailboxEmail),
      attachmentFilename: normalizeCaseInsensitiveString(normalized.attachmentFilename),
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

function readAnyToolName(record: Record<string, unknown>): string | null {
  const toolName = record.toolName ?? record.name ?? record.tool;
  if (typeof toolName !== 'string') return null;
  const trimmed = toolName.trim();
  if (!trimmed) return null;
  return trimmed;
}

function readCacheableToolName(record: Record<string, unknown>): CacheableToolName | null {
  const toolName = readAnyToolName(record);
  if (!isCacheableToolName(toolName)) return null;
  return toolName;
}

function readMutationToolName(record: Record<string, unknown>): MutationToolName | null {
  const toolName = readAnyToolName(record);
  if (!isMutationToolName(toolName)) return null;
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

function resolveResultArgs(params: {
  rawResult: Record<string, unknown>;
  toolName: string;
  callArgsById: Map<string, unknown>;
  callArgsByTool: Map<string, unknown[]>;
}): unknown {
  const toolCallId = readToolCallId(params.rawResult);
  if (toolCallId && params.callArgsById.has(toolCallId)) {
    return params.callArgsById.get(toolCallId);
  }

  const queue = params.callArgsByTool.get(params.toolName);
  if (queue && queue.length > 0) {
    return queue.shift();
  }

  return undefined;
}

function updateInvalidationCutoff(
  cutoffs: ToolInvalidationCutoffs,
  toolName: CacheableToolName,
  cutoffMs: number,
): void {
  const existing = cutoffs[toolName];
  if (!isFiniteNumber(existing) || cutoffMs > existing) {
    cutoffs[toolName] = cutoffMs;
  }
}

function buildInitialStats(): ExecutiveToolResultCacheStats {
  const stats = {} as ExecutiveToolResultCacheStats;
  for (const toolName of CACHEABLE_TOOL_NAMES) {
    stats[toolName] = {
      history_hit: 0,
      runtime_hit: 0,
      miss_not_found: 0,
      miss_expired: 0,
      miss_invalidated: 0,
      set_ok: 0,
      set_skipped_non_cacheable: 0,
    };
  }
  return stats;
}

function cloneStats(stats: ExecutiveToolResultCacheStats): ExecutiveToolResultCacheStats {
  const cloned = {} as ExecutiveToolResultCacheStats;
  for (const toolName of CACHEABLE_TOOL_NAMES) {
    cloned[toolName] = { ...stats[toolName] };
  }
  return cloned;
}

function recordCacheMiss(
  stats: ExecutiveToolResultCacheStats,
  toolName: CacheableToolName,
  reason: CacheMissReason,
): void {
  if (reason === 'not_found') {
    stats[toolName].miss_not_found += 1;
    return;
  }

  if (reason === 'expired') {
    stats[toolName].miss_expired += 1;
    return;
  }

  stats[toolName].miss_invalidated += 1;
}

function markCacheHit(
  stats: ExecutiveToolResultCacheStats,
  toolName: CacheableToolName,
  source: CacheSource,
): void {
  if (source === 'history') {
    stats[toolName].history_hit += 1;
    return;
  }

  stats[toolName].runtime_hit += 1;
}

function parseToolCalls(metadata: Record<string, unknown>): ToolCallRecord[] {
  if (!Array.isArray(metadata.toolCalls)) {
    return [];
  }

  const calls: ToolCallRecord[] = [];
  for (const rawCall of metadata.toolCalls) {
    if (!isRecord(rawCall)) continue;
    const toolName = readAnyToolName(rawCall);
    if (!toolName) continue;

    calls.push({
      toolName,
      args: rawCall.args,
      callId: readToolCallId(rawCall),
    });
  }

  return calls;
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

export function isAppendToSupermemorySuccessful(result: unknown): boolean {
  return isRecord(result) && result.stored === true;
}

export function isCommitCalendarChangeSuccessful(args: unknown, result: unknown): boolean {
  if (!isRecord(result) || result.ok !== true) {
    return false;
  }

  if (isRecord(args) && args.decision === 'cancel') {
    return false;
  }

  if (result.status === 'cancelled') {
    return false;
  }

  return true;
}

function applyMutationInvalidation(params: {
  mutationToolName: MutationToolName;
  cutoffs: ToolInvalidationCutoffs;
  storedAtMs: number;
}): void {
  if (params.mutationToolName === 'append_to_supermemory') {
    updateInvalidationCutoff(params.cutoffs, 'search_memory', params.storedAtMs);
    return;
  }

  updateInvalidationCutoff(params.cutoffs, 'search_calendar', params.storedAtMs);
  updateInvalidationCutoff(params.cutoffs, 'check_calendar', params.storedAtMs);
}

function cloneValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function applyMutationCutoffFromHistory(params: {
  metadata: Record<string, unknown>;
  storedAtMs: number;
  cutoffs: ToolInvalidationCutoffs;
}): void {
  if (!Array.isArray(params.metadata.toolResults)) {
    return;
  }

  const toolCalls = parseToolCalls(params.metadata);
  const callArgsById = new Map<string, unknown>();
  const callArgsByTool = new Map<string, unknown[]>();

  for (const toolCall of toolCalls) {
    if (toolCall.callId) {
      callArgsById.set(toolCall.callId, toolCall.args);
    }

    const existing = callArgsByTool.get(toolCall.toolName) ?? [];
    existing.push(toolCall.args);
    callArgsByTool.set(toolCall.toolName, existing);
  }

  for (const rawResult of params.metadata.toolResults) {
    if (!isRecord(rawResult)) continue;
    const mutationToolName = readMutationToolName(rawResult);
    if (!mutationToolName) continue;

    const args = resolveResultArgs({
      rawResult,
      toolName: mutationToolName,
      callArgsById,
      callArgsByTool,
    });
    const result = rawResult.result;

    if (mutationToolName === 'append_to_supermemory') {
      if (!isAppendToSupermemorySuccessful(result)) continue;
      applyMutationInvalidation({
        mutationToolName,
        cutoffs: params.cutoffs,
        storedAtMs: params.storedAtMs,
      });
      continue;
    }

    if (!isCommitCalendarChangeSuccessful(args, result)) continue;
    applyMutationInvalidation({
      mutationToolName,
      cutoffs: params.cutoffs,
      storedAtMs: params.storedAtMs,
    });
  }
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
    if (!isCacheableToolName(toolCall.toolName)) {
      continue;
    }

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
    const toolName = readCacheableToolName(rawResult);
    if (!toolName) continue;

    const args = resolveResultArgs({
      rawResult,
      toolName,
      callArgsById,
      callArgsByTool,
    });
    if (args === undefined) continue;

    const result = rawResult.result;
    if (!isResultCacheable(result)) continue;

    const normalizedArgs =
      toolName === 'search_inbox_context' && isRecord(args)
        ? {
            ...args,
            intentFingerprint: deriveSearchInboxIntentFingerprint(args, result),
          }
        : normalizeToolArgs(toolName, args);

    extracted.push({ toolName, args: normalizedArgs, result });
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

function resolveMinStoredAtMs(params: {
  toolName: CacheableToolName;
  options: CacheGetOptions | undefined;
  invalidationCutoffsByTool: ToolInvalidationCutoffs;
}): number | null {
  const values = [params.options?.minStoredAtMs, params.invalidationCutoffsByTool[params.toolName]]
    .filter(isFiniteNumber);

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function applyInvalidationGuard(params: {
  entry: CacheEntry;
  minStoredAtMs: number | null;
}): boolean {
  if (!isFiniteNumber(params.minStoredAtMs)) {
    return false;
  }

  return params.entry.storedAtMs < params.minStoredAtMs;
}

function applyTtlGuard(params: {
  toolName: CacheableToolName;
  entry: CacheEntry;
  nowMs: number;
}): { expired: boolean; ageMs: number; maxAgeMs: number } {
  const maxAgeMs = TOOL_RESULT_TTL_MS[params.toolName];
  const ageMs = params.nowMs - params.entry.storedAtMs;
  const expired = ageMs < 0 || ageMs > maxAgeMs;
  return {
    expired,
    ageMs,
    maxAgeMs,
  };
}

export type ExecutiveToolResultReuseCache = {
  get: <T = unknown>(
    toolName: CacheableToolName,
    args: unknown,
    options?: CacheGetOptions,
  ) => T | null;
  set: (toolName: CacheableToolName, args: unknown, result: unknown) => void;
  noteMutation: (toolName: MutationToolName, storedAtMs: number) => void;
  getStats: () => ExecutiveToolResultCacheStats;
};

export function createExecutiveToolResultReuseCache(params: {
  conversationHistory: ConversationMessageDTO[];
}): ExecutiveToolResultReuseCache {
  const cache = new Map<string, CacheEntry>();
  const stats = buildInitialStats();
  const invalidationCutoffsByTool: ToolInvalidationCutoffs = {};

  for (const message of params.conversationHistory) {
    if (message.role !== 'ASSISTANT') continue;
    if (!isRecord(message.metadata)) continue;

    const createdAtMs = new Date(message.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) continue;

    applyMutationCutoffFromHistory({
      metadata: message.metadata,
      storedAtMs: createdAtMs,
      cutoffs: invalidationCutoffsByTool,
    });

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
    get: <T = unknown>(
      toolName: CacheableToolName,
      args: unknown,
      options?: CacheGetOptions,
    ): T | null => {
      const key = buildToolCacheKey(toolName, args);
      const entry = cache.get(key);
      if (!entry) {
        recordCacheMiss(stats, toolName, 'not_found');
        return null;
      }

      const nowMs = Date.now();
      const ttl = applyTtlGuard({
        toolName,
        entry,
        nowMs,
      });

      if (ttl.expired) {
        cache.delete(key);
        recordCacheMiss(stats, toolName, 'expired');
        return null;
      }

      const minStoredAtMs = resolveMinStoredAtMs({
        toolName,
        options,
        invalidationCutoffsByTool,
      });

      if (applyInvalidationGuard({ entry, minStoredAtMs })) {
        cache.delete(key);
        recordCacheMiss(stats, toolName, 'invalidated');
        return null;
      }

      markCacheHit(stats, toolName, entry.source);
      const withMetadata = attachCacheMetadata(entry.result, {
        hit: true,
        source: entry.source,
        ageMs: ttl.ageMs,
        maxAgeMs: ttl.maxAgeMs,
        cachedAt: new Date(entry.storedAtMs).toISOString(),
      });

      return withMetadata as T;
    },
    set: (toolName: CacheableToolName, args: unknown, result: unknown): void => {
      if (!isResultCacheable(result)) {
        stats[toolName].set_skipped_non_cacheable += 1;
        return;
      }

      const key = buildToolCacheKey(toolName, args);
      cache.set(key, {
        result: cloneValue(result),
        storedAtMs: Date.now(),
        source: 'runtime',
      });
      stats[toolName].set_ok += 1;
    },
    noteMutation: (toolName: MutationToolName, storedAtMs: number): void => {
      applyMutationInvalidation({
        mutationToolName: toolName,
        cutoffs: invalidationCutoffsByTool,
        storedAtMs,
      });
    },
    getStats: () => cloneStats(stats),
  };
}
