import { z } from 'zod';
import { logger } from '@/lib/logger';

const DEFAULT_BASE_URL = 'https://api.exa.ai';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_HIGHLIGHT_CHARACTERS = 4_000;
const DEFAULT_TEXT_CHARACTERS = 12_000;

export const PUBLIC_WEB_SEARCH_CATEGORY_VALUES = [
  'general',
  'news',
  'company',
  'person',
  'research',
] as const;
export type PublicWebSearchCategory = (typeof PUBLIC_WEB_SEARCH_CATEGORY_VALUES)[number];

export const PUBLIC_WEB_SEARCH_RESULT_MODE_VALUES = ['highlights', 'text'] as const;
export type PublicWebSearchResultMode = (typeof PUBLIC_WEB_SEARCH_RESULT_MODE_VALUES)[number];

export const PUBLIC_WEB_SEARCH_FRESHNESS_VALUES = [
  'default',
  'day',
  'hour',
  'live',
  'cache_only',
] as const;
export type PublicWebSearchFreshness = (typeof PUBLIC_WEB_SEARCH_FRESHNESS_VALUES)[number];

export type PublicWebSearchSource = {
  title: string | null;
  url: string;
  domain: string | null;
  publishedDate: string | null;
  author: string | null;
  score: number | null;
  snippets: string[];
  textExcerpt: string | null;
};

export type PublicWebSearchResponse =
  | {
      ok: true;
      provider: 'public_web';
      searchType: 'auto';
      query: string;
      category: PublicWebSearchCategory;
      freshness: PublicWebSearchFreshness;
      resultMode: PublicWebSearchResultMode;
      resultCount: number;
      sources: PublicWebSearchSource[];
      summary: string;
    }
  | {
      ok: false;
      provider: 'public_web';
      searchType: 'auto';
      query: string;
      category: PublicWebSearchCategory;
      freshness: PublicWebSearchFreshness;
      resultMode: PublicWebSearchResultMode;
      resultCount: 0;
      sources: [];
      error:
        | 'web_search_unavailable'
        | 'web_search_request_failed'
        | 'web_search_bad_response';
      message: string;
      retryable: boolean;
      degraded: true;
      summary: string;
    };

type PublicWebSearchFailureError =
  | 'web_search_unavailable'
  | 'web_search_request_failed'
  | 'web_search_bad_response';

type PublicWebSearchRequest = {
  query: string;
  category?: PublicWebSearchCategory;
  freshness?: PublicWebSearchFreshness;
  resultMode?: PublicWebSearchResultMode;
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  requester?: string;
};

const exaSearchResultSchema = z.object({
  title: z.string().trim().optional().nullable(),
  url: z.string().url(),
  publishedDate: z.string().trim().optional().nullable(),
  author: z.string().trim().optional().nullable(),
  score: z.number().optional().nullable(),
  highlights: z.array(z.string()).optional().nullable(),
  text: z.string().optional().nullable(),
}).passthrough();

const exaSearchResponseSchema = z.object({
  results: z.array(exaSearchResultSchema).default([]),
}).passthrough();

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 3))}...`;
}

function resolveWebSearchConfig() {
  const timeoutMs = Number.parseInt(process.env.EXA_TIMEOUT_MS ?? '', 10);
  return {
    apiKey: trimToNull(process.env.EXA_API_KEY),
    baseUrl: trimToNull(process.env.EXA_BASE_URL)?.replace(/\/+$/, '') ?? DEFAULT_BASE_URL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

export function isPublicWebSearchConfigured(): boolean {
  return Boolean(resolveWebSearchConfig().apiKey);
}

function mapCategory(category: PublicWebSearchCategory): string | undefined {
  switch (category) {
    case 'news':
      return 'news';
    case 'company':
      return 'company';
    case 'person':
      return 'people';
    case 'research':
      return 'research paper';
    default:
      return undefined;
  }
}

function mapFreshnessToMaxAgeHours(
  freshness: PublicWebSearchFreshness,
): number | undefined {
  switch (freshness) {
    case 'day':
      return 24;
    case 'hour':
      return 1;
    case 'live':
      return 0;
    case 'cache_only':
      return -1;
    default:
      return undefined;
  }
}

function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, '').split('/')[0] ?? null;
  }
}

function normalizeDomains(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const unique = Array.from(
    new Set(
      values
        .map((value) => normalizeDomain(value))
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return unique.length > 0 ? unique : undefined;
}

function resolveDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function dedupeStrings(values: Array<string | null | undefined>, maxChars: number): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(truncate(normalized, maxChars));
  }

  return results;
}

function buildSummary(query: string, sources: PublicWebSearchSource[]): string {
  if (sources.length === 0) {
    return `No public web results found for "${truncate(query, 120)}".`;
  }

  const labels = sources
    .slice(0, 2)
    .map((source) => source.title ?? source.domain ?? source.url)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (labels.length === 0) {
    return `Found ${sources.length} public web result(s).`;
  }

  return `Found ${sources.length} public web result(s), starting with ${labels.join(' and ')}.`;
}

function buildFailureResult(params: {
  query: string;
  category: PublicWebSearchCategory;
  freshness: PublicWebSearchFreshness;
  resultMode: PublicWebSearchResultMode;
  error: PublicWebSearchFailureError;
  message: string;
  retryable: boolean;
}): PublicWebSearchResponse {
  return {
    ok: false,
    provider: 'public_web',
    searchType: 'auto',
    query: params.query,
    category: params.category,
    freshness: params.freshness,
    resultMode: params.resultMode,
    resultCount: 0,
    sources: [],
    error: params.error,
    message: params.message,
    retryable: params.retryable,
    degraded: true,
    summary: params.message,
  };
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const filtered = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (filtered.length === 0) {
    return undefined;
  }
  if (filtered.length === 1) {
    return filtered[0];
  }
  return AbortSignal.any(filtered);
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.message, record.error];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export async function searchPublicWeb(
  params: PublicWebSearchRequest,
): Promise<PublicWebSearchResponse> {
  const config = resolveWebSearchConfig();
  const category = params.category ?? 'general';
  const freshness = params.freshness ?? 'default';
  const resultMode = params.resultMode ?? 'highlights';
  const maxResults = Math.max(1, Math.min(params.maxResults ?? DEFAULT_MAX_RESULTS, 8));

  if (!config.apiKey) {
    logger.warn('[webSearch] search unavailable', {
      requester: params.requester ?? 'unknown',
      query: params.query,
      reason: 'missing_exa_api_key',
    });
    return buildFailureResult({
      query: params.query,
      category,
      freshness,
      resultMode,
      error: 'web_search_unavailable',
      message: 'Public web search is not configured right now.',
      retryable: false,
    });
  }

  const body: Record<string, unknown> = {
    query: params.query,
    type: 'auto',
    num_results: maxResults,
    contents:
      resultMode === 'text'
        ? {
            text: {
              max_characters: DEFAULT_TEXT_CHARACTERS,
            },
          }
        : {
            highlights: {
              max_characters: DEFAULT_HIGHLIGHT_CHARACTERS,
            },
          },
  };

  const categoryFilter = mapCategory(category);
  if (categoryFilter) {
    body.category = categoryFilter;
  }

  const includeDomains = normalizeDomains(params.includeDomains);
  if (includeDomains) {
    body.includeDomains = includeDomains;
  }

  const excludeDomains = normalizeDomains(params.excludeDomains);
  if (excludeDomains) {
    body.excludeDomains = excludeDomains;
  }

  const maxAgeHours = mapFreshnessToMaxAgeHours(freshness);
  if (typeof maxAgeHours === 'number') {
    body.maxAgeHours = maxAgeHours;
  }

  const timeoutMs = Math.max(1_000, Math.min(params.timeoutMs ?? config.timeoutMs, 30_000));
  const signal = combineSignals([params.signal, AbortSignal.timeout(timeoutMs)]);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'TimeoutError'
        ? `Public web search timed out after ${timeoutMs}ms.`
        : 'Public web search failed before a response was received.';

    logger.warn('[webSearch] request failed', {
      requester: params.requester ?? 'unknown',
      query: params.query,
      category,
      freshness,
      resultMode,
      error: error instanceof Error ? error.message : String(error),
    });

    return buildFailureResult({
      query: params.query,
      category,
      freshness,
      resultMode,
      error: 'web_search_request_failed',
      message,
      retryable: true,
    });
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      extractErrorMessage(payload) ??
      `Public web search returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;

    logger.warn('[webSearch] search rejected', {
      requester: params.requester ?? 'unknown',
      query: params.query,
      category,
      freshness,
      resultMode,
      status: response.status,
      message,
    });

    return buildFailureResult({
      query: params.query,
      category,
      freshness,
      resultMode,
      error: 'web_search_request_failed',
      message,
      retryable: response.status >= 500 || response.status === 429,
    });
  }

  const parsed = exaSearchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn('[webSearch] invalid response payload', {
      requester: params.requester ?? 'unknown',
      query: params.query,
      issues: parsed.error.issues.map((issue) => issue.message),
    });

    return buildFailureResult({
      query: params.query,
      category,
      freshness,
      resultMode,
      error: 'web_search_bad_response',
      message: 'Public web search returned an unreadable response.',
      retryable: true,
    });
  }

  const sources: PublicWebSearchSource[] = parsed.data.results
    .slice(0, maxResults)
    .map((result) => ({
      title: trimToNull(result.title),
      url: result.url,
      domain: resolveDomainFromUrl(result.url),
      publishedDate: trimToNull(result.publishedDate),
      author: trimToNull(result.author),
      score: typeof result.score === 'number' ? result.score : null,
      snippets: dedupeStrings(result.highlights ?? [], 500).slice(0, 3),
      textExcerpt:
        resultMode === 'text' && typeof result.text === 'string'
          ? truncate(result.text.replace(/\s+/g, ' '), 2_400)
          : null,
    }))
    .map((source) => {
      if (source.snippets.length > 0 || !source.textExcerpt) {
        return source;
      }

      return {
        ...source,
        snippets: [truncate(source.textExcerpt, 500)],
      };
    });

  return {
    ok: true,
    provider: 'public_web',
    searchType: 'auto',
    query: params.query,
    category,
    freshness,
    resultMode,
    resultCount: sources.length,
    sources,
    summary: buildSummary(params.query, sources),
  };
}
