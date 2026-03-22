import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  isPublicWebSearchConfigured,
  searchPublicWeb,
} from '@/lib/services/web-search/client';

describe('public web search client', () => {
  const originalApiKey = process.env.EXA_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.EXA_API_KEY;
    } else {
      process.env.EXA_API_KEY = originalApiKey;
    }
  });

  test('reports unavailable when EXA_API_KEY is missing', async () => {
    delete process.env.EXA_API_KEY;

    expect(isPublicWebSearchConfigured()).toBe(false);

    const result = await searchPublicWeb({
      query: 'latest AI safety updates',
      requester: 'test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected unavailable result');
    }
    expect(result.error).toBe('web_search_unavailable');
    expect(result.retryable).toBe(false);
  });

  test('maps successful results into compact public-web sources', async () => {
    process.env.EXA_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'OpenAI ships new model',
                url: 'https://openai.com/blog/new-model',
                publishedDate: '2026-03-20T12:00:00.000Z',
                author: 'OpenAI',
                highlights: ['A compact snippet about the announcement.'],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const result = await searchPublicWeb({
      query: 'latest OpenAI announcement',
      requester: 'test',
      includeDomains: ['OpenAI.com'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected successful result');
    }
    expect(result.resultCount).toBe(1);
    expect(result.sources[0]?.domain).toBe('openai.com');
    expect(result.sources[0]?.snippets[0]).toContain('announcement');
    expect(result.summary).toContain('Found 1 public web result');
  });

  test('returns a retryable degraded result when the request fails', async () => {
    process.env.EXA_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: 'upstream unavailable' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const result = await searchPublicWeb({
      query: 'latest OpenAI announcement',
      requester: 'test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure result');
    }
    expect(result.error).toBe('web_search_request_failed');
    expect(result.retryable).toBe(true);
    expect(result.message).toContain('upstream unavailable');
  });
});
