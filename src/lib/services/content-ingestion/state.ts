import type { ContentExtractionResult } from './types';

const SCOPE_TTL_MS = 30 * 60 * 1000;

type CacheScopeState = {
  entries: Map<string, ContentExtractionResult>;
  lastTouchedAt: number;
};

type BudgetScopeState = {
  attemptsUsed: number;
  totalTokens: number;
  totalDurationMs: number;
  lastTouchedAt: number;
};

type StoredContentReferenceEntry = {
  ownerUserId: string;
  buffer: Buffer;
  filename: string | null;
  mimeType: string | null;
  storedAt: number;
};

const cacheScopes = new Map<string, CacheScopeState>();
const budgetScopes = new Map<string, BudgetScopeState>();
const storedContentReferences = new Map<string, StoredContentReferenceEntry & {
  lastTouchedAt: number;
}>();

function now(): number {
  return Date.now();
}

function cleanupExpiredScopes(): void {
  const cutoff = now() - SCOPE_TTL_MS;

  for (const [key, value] of cacheScopes.entries()) {
    if (value.lastTouchedAt < cutoff) {
      cacheScopes.delete(key);
    }
  }

  for (const [key, value] of budgetScopes.entries()) {
    if (value.lastTouchedAt < cutoff) {
      budgetScopes.delete(key);
    }
  }

  for (const [key, value] of storedContentReferences.entries()) {
    if (value.lastTouchedAt < cutoff) {
      storedContentReferences.delete(key);
    }
  }
}

function getOrCreateCacheScope(scopeKey: string): CacheScopeState {
  cleanupExpiredScopes();
  const existing = cacheScopes.get(scopeKey);
  if (existing) {
    existing.lastTouchedAt = now();
    return existing;
  }

  const created: CacheScopeState = {
    entries: new Map(),
    lastTouchedAt: now(),
  };
  cacheScopes.set(scopeKey, created);
  return created;
}

function getOrCreateBudgetScope(scopeKey: string): BudgetScopeState {
  cleanupExpiredScopes();
  const existing = budgetScopes.get(scopeKey);
  if (existing) {
    existing.lastTouchedAt = now();
    return existing;
  }

  const created: BudgetScopeState = {
    attemptsUsed: 0,
    totalTokens: 0,
    totalDurationMs: 0,
    lastTouchedAt: now(),
  };
  budgetScopes.set(scopeKey, created);
  return created;
}

export function readCachedExtractionResult(
  scopeKey: string | null,
  cacheKey: string,
): ContentExtractionResult | null {
  if (!scopeKey) return null;
  const scope = getOrCreateCacheScope(scopeKey);
  return scope.entries.get(cacheKey) ?? null;
}

export function storeCachedExtractionResult(
  scopeKey: string | null,
  cacheKey: string,
  result: ContentExtractionResult,
): void {
  if (!scopeKey) return;
  const scope = getOrCreateCacheScope(scopeKey);
  scope.entries.set(cacheKey, result);
}

export function reserveExtractionBudget(params: {
  scopeKey: string | null;
  maxExtractionsPerTurn: number;
}): { ok: true; attemptsUsed: number } | { ok: false; attemptsUsed: number } {
  if (!params.scopeKey) {
    return { ok: true, attemptsUsed: 1 };
  }

  const scope = getOrCreateBudgetScope(params.scopeKey);
  if (scope.attemptsUsed >= params.maxExtractionsPerTurn) {
    return { ok: false, attemptsUsed: scope.attemptsUsed };
  }

  scope.attemptsUsed += 1;
  scope.lastTouchedAt = now();

  return { ok: true, attemptsUsed: scope.attemptsUsed };
}

export function commitExtractionMetrics(params: {
  scopeKey: string | null;
  totalTokens: number;
  durationMs: number;
}): void {
  if (!params.scopeKey) return;

  const scope = getOrCreateBudgetScope(params.scopeKey);
  scope.totalTokens += Math.max(0, params.totalTokens);
  scope.totalDurationMs += Math.max(0, params.durationMs);
  scope.lastTouchedAt = now();
}

export function getExtractionBudgetSnapshot(params: {
  scopeKey: string | null;
  maxExtractionsPerTurn: number | null;
}): {
  scopeKey: string | null;
  maxExtractions: number | null;
  attemptsUsed: number;
  totalTokens: number;
  totalDurationMs: number;
} {
  if (!params.scopeKey) {
    return {
      scopeKey: null,
      maxExtractions: params.maxExtractionsPerTurn,
      attemptsUsed: 0,
      totalTokens: 0,
      totalDurationMs: 0,
    };
  }

  const scope = getOrCreateBudgetScope(params.scopeKey);
  return {
    scopeKey: params.scopeKey,
    maxExtractions: params.maxExtractionsPerTurn,
    attemptsUsed: scope.attemptsUsed,
    totalTokens: scope.totalTokens,
    totalDurationMs: scope.totalDurationMs,
  };
}

export function storeContentReferenceBuffer(params: {
  referenceId: string;
  ownerUserId: string;
  buffer: Buffer;
  filename?: string | null;
  mimeType?: string | null;
}): void {
  cleanupExpiredScopes();
  storedContentReferences.set(params.referenceId, {
    ownerUserId: params.ownerUserId,
    buffer: params.buffer,
    filename: params.filename ?? null,
    mimeType: params.mimeType ?? null,
    storedAt: now(),
    lastTouchedAt: now(),
  });
}

export function readContentReferenceBuffer(referenceId: string): StoredContentReferenceEntry | null {
  cleanupExpiredScopes();
  const stored = storedContentReferences.get(referenceId);
  if (!stored) {
    return null;
  }

  stored.lastTouchedAt = now();
  return {
    ownerUserId: stored.ownerUserId,
    buffer: stored.buffer,
    filename: stored.filename,
    mimeType: stored.mimeType,
    storedAt: stored.storedAt,
  };
}

export function resetContentIngestionStateForTests(): void {
  cacheScopes.clear();
  budgetScopes.clear();
  storedContentReferences.clear();
}
