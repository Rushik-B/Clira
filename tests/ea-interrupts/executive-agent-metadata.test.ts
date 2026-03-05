import { describe, expect, test } from 'vitest';
import {
  stripCacheDebugMetadataForPersistence,
} from '@/lib/ai/agents/executive-agent/persistence';

describe('Executive agent metadata persistence', () => {
  test('removes _cache from toolResults payload recursively', () => {
    const payload = [
      {
        toolName: 'search_inbox_context',
        toolCallId: 'tool-1',
        result: {
          matches: [
            {
              threadId: 'thread-1',
              _cache: { hit: true, source: 'history' },
            },
          ],
          expandedThreads: [
            {
              threadId: 'thread-1',
              messages: [
                {
                  messageId: 'msg-1',
                  bodyText: 'very long body',
                },
              ],
            },
          ],
          summary: 'one match',
          _cache: {
            hit: true,
            source: 'runtime',
            ageMs: 120,
            maxAgeMs: 600000,
            cachedAt: '2026-02-26T12:00:00.000Z',
          },
        },
      },
    ];

    const sanitized = stripCacheDebugMetadataForPersistence(payload) as Array<{
      result?: {
        _cache?: unknown;
        matches?: Array<{ _cache?: unknown }>;
        expandedThreads?: unknown;
      };
    }>;

    expect(sanitized[0]?.result?._cache).toBeUndefined();
    expect(sanitized[0]?.result?.matches?.[0]?._cache).toBeUndefined();
    expect(sanitized[0]?.result?.expandedThreads).toBeUndefined();
  });
});
