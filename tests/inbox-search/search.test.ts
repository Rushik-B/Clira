import { describe, expect, test } from 'vitest';
import { buildInboxSearchPlan } from '@/lib/services/inbox-search/search';
import {
  buildInboxWhyRelevant,
  calculateInboxRecencyBoost,
  collectInboxMatchedTerms,
  hasInboxExactSenderMatch,
  hasInboxExactSubjectMatch,
  inferInboxSearchConfidence,
} from '@/lib/services/inbox-search/scoring';

describe('buildInboxSearchPlan', () => {
  test('builds lexical terms and all-time deep window from intent + constraints', () => {
    const plan = buildInboxSearchPlan({
      intent: 'find "project kickoff" emails from alice@example.com about budget',
      constraints: {
        subject: 'Kickoff agenda',
        keywords: ['forecast'],
      },
      mode: 'deep',
      profile: 'default',
      now: new Date('2026-02-27T00:00:00.000Z'),
    });

    expect(plan.lexicalQuery).toContain('"project kickoff"');
    expect(plan.lexicalQuery).toContain('forecast');
    expect(plan.lexicalQuery).toContain('"Kickoff agenda"');
    expect(plan.timeWindowLabel).toBe('all time');
    expect(plan.matchTerms).toContain('alice@example.com');
  });

  test('falls back to filter-only search when constraints narrow the scope', () => {
    const plan = buildInboxSearchPlan({
      intent: 'it',
      constraints: {
        sender: 'bob@example.com',
        hasAttachment: true,
      },
      mode: 'quick',
      profile: 'default',
      now: new Date('2026-02-27T00:00:00.000Z'),
    });

    expect(plan.lexicalQuery).toBeNull();
    expect(plan.allowsFilterOnlySearch).toBe(true);
    expect(plan.notes).toContain(
      'Running a local filter-only search because no lexical query terms were available.',
    );
  });
});

describe('inbox search scoring helpers', () => {
  test('detects matched terms and exact field boosts', () => {
    expect(
      collectInboxMatchedTerms(
        [
          'Budget review next week',
          'Alice Johnson <alice@example.com>',
          'Please send the updated budget forecast today.',
        ],
        ['budget', 'forecast', 'travel'],
      ),
    ).toEqual(['budget', 'forecast']);

    expect(
      hasInboxExactSenderMatch(
        'Alice Johnson <alice@example.com>',
        ['alice@example.com'],
      ),
    ).toBe(true);

    expect(
      hasInboxExactSubjectMatch('Re: Kickoff agenda for next week', ['Kickoff agenda']),
    ).toBe(true);
  });

  test('builds deterministic relevance text and confidence', () => {
    expect(
      buildInboxWhyRelevant({
        matchedTerms: ['budget', 'forecast'],
        exactSenderMatch: true,
        exactSubjectMatch: false,
        lexicalScore: 0.9,
      }),
    ).toBe('Sender matched exactly. Matched terms: budget, forecast.');

    expect(
      inferInboxSearchConfidence({
        candidateCount: 2,
        topScore: 4.2,
        freshness: 'fresh',
        hasExactBoost: true,
      }),
    ).toBe('high');
  });

  test('applies recency decay and lowers stale confidence', () => {
    const recentBoost = calculateInboxRecencyBoost(
      new Date('2026-02-26T00:00:00.000Z'),
      new Date('2026-02-27T00:00:00.000Z'),
    );
    const olderBoost = calculateInboxRecencyBoost(
      new Date('2025-10-01T00:00:00.000Z'),
      new Date('2026-02-27T00:00:00.000Z'),
    );

    expect(recentBoost).toBeGreaterThan(olderBoost);
    expect(
      inferInboxSearchConfidence({
        candidateCount: 3,
        topScore: 5,
        freshness: 'stale',
        hasExactBoost: true,
      }),
    ).toBe('low');
  });
});
