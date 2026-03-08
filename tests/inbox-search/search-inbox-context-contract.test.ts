import { describe, expect, test } from 'vitest';
import {
  normalizeSearchInboxContextArgs,
} from '@/lib/ai/agents/executive-agent/search-inbox-context-contract';

describe('normalizeSearchInboxContextArgs', () => {
  test('fills defaults for structured find requests', () => {
    const normalized = normalizeSearchInboxContextArgs(
      {
        action: 'find',
        queryText: 'github notifications',
      },
      { defaultTimezone: 'America/Vancouver' },
    );

    expect(normalized.mode).toBe('quick');
    expect(normalized.options.semantic).toBe(true);
    expect(normalized.options.sortBy).toBe('relevance');
    expect(normalized.options.timezone).toBe('America/Vancouver');
    expect(normalized.filters.includeDeleted).toBe(false);
  });

  test('rejects aggregate without groupBy', () => {
    expect(() =>
      normalizeSearchInboxContextArgs({
        action: 'aggregate',
        filters: {
          relativeWindow: 'last_30_days',
        },
      }),
    ).toThrow('aggregate requires options.groupBy.');
  });

  test('rejects relativeWindow combined with explicit dates', () => {
    expect(() =>
      normalizeSearchInboxContextArgs({
        action: 'summarize_range',
        filters: {
          relativeWindow: 'today',
          startDate: '2026-03-03',
        },
      }),
    ).toThrow('Use either relativeWindow or startDate/endDate, not both.');
  });
});
