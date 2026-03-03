import { InboxBackfillState } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { buildInboxSearchPlan, searchInboxDocuments } from '@/lib/services/inbox-search/search';
import {
  buildInboxWhyRelevant,
  calculateInboxRecencyBoost,
  collectInboxMatchedTerms,
  hasInboxExactSenderMatch,
  hasInboxExactSubjectMatch,
  inferInboxSearchConfidence,
} from '@/lib/services/inbox-search/scoring';

describe('buildInboxSearchPlan', () => {
  test('builds lexical terms from queryText and keeps subjectContains as a filter hint', () => {
    const plan = buildInboxSearchPlan({
      action: 'find',
      queryText: 'find "project kickoff" budget update',
      filters: {
        sender: 'alice@example.com',
        subjectContains: 'Kickoff agenda',
        keywords: ['forecast'],
      },
      options: {
        semantic: true,
      },
      mode: 'deep',
      profile: 'default',
      maxCandidates: 5,
      now: new Date('2026-02-27T00:00:00.000Z'),
    });

    expect(plan.lexicalQuery).toContain('"project kickoff"');
    expect(plan.lexicalQuery).toContain('forecast');
    expect(plan.timeWindowLabel).toBe('all time');
    expect(plan.matchTerms).toContain('alice@example.com');
    expect(plan.appliedFilters).toContain('subjectContains');
  });

  test('falls back to filter-only search when structured filters narrow the scope', () => {
    const plan = buildInboxSearchPlan({
      action: 'find',
      queryText: 'it',
      filters: {
        sender: 'bob@example.com',
        hasAttachment: true,
      },
      mode: 'quick',
      profile: 'default',
      maxCandidates: 5,
      now: new Date('2026-02-27T00:00:00.000Z'),
    });

    expect(plan.lexicalQuery).toBeNull();
    expect(plan.filterOnly).toBe(true);
    expect(plan.notes).toContain(
      'Running a local filter-only search because no lexical query terms were provided.',
    );
  });
});

describe('searchInboxDocuments hybrid retrieval', () => {
  test('uses semantic + lexical fusion and ranks by RRF with deterministic collapse', async () => {
    const lexicalRows = [
      {
        documentId: 'doc-a',
        threadId: 'thread-a',
        messageId: 'msg-a',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Alice <alice@example.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Project kickoff agenda',
        snippet: 'Kickoff details',
        bodyText: 'Kickoff agenda details and budget notes.',
        sentAt: new Date('2026-02-26T00:00:00.000Z'),
        lexicalScore: 0.9,
        headline: 'Kickoff <<agenda>> details',
      },
      {
        documentId: 'doc-b',
        threadId: 'thread-b',
        messageId: 'msg-b',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Bob <bob@example.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Budget update',
        snippet: 'Budget follow-up',
        bodyText: 'Latest budget update from Bob.',
        sentAt: new Date('2026-02-26T00:00:00.000Z'),
        lexicalScore: 0.6,
        headline: 'Budget <<update>>',
      },
    ];

    const semanticRows = [
      {
        documentId: 'doc-b',
        threadId: 'thread-b',
        messageId: 'msg-b',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Bob <bob@example.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Budget update',
        snippet: 'Budget follow-up',
        bodyText: 'Latest budget update from Bob.',
        sentAt: new Date('2026-02-26T00:00:00.000Z'),
        semanticScore: 0.95,
        semanticDistance: 0.05,
        semanticChunkText: 'Budget update for kickoff agenda',
      },
      {
        // Duplicate doc-b row should collapse to the smaller distance record above.
        documentId: 'doc-b',
        threadId: 'thread-b',
        messageId: 'msg-b',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Bob <bob@example.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Budget update',
        snippet: 'Budget follow-up',
        bodyText: 'Latest budget update from Bob.',
        sentAt: new Date('2026-02-26T00:00:00.000Z'),
        semanticScore: 0.7,
        semanticDistance: 0.3,
        semanticChunkText: 'Older chunk',
      },
      {
        documentId: 'doc-a',
        threadId: 'thread-a',
        messageId: 'msg-a',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Alice <alice@example.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Project kickoff agenda',
        snippet: 'Kickoff details',
        bodyText: 'Kickoff agenda details and budget notes.',
        sentAt: new Date('2026-02-26T00:00:00.000Z'),
        semanticScore: 0.8,
        semanticDistance: 0.2,
        semanticChunkText: 'Kickoff agenda with budget details',
      },
    ];

    const result = await searchInboxDocuments(
      {
        userId: 'user-1',
        action: 'find',
        queryText: 'kickoff budget update',
        mode: 'quick',
        profile: 'default',
        mailboxes: [
          {
            id: 'mailbox-1',
            emailAddress: 'user@example.com',
            status: 'CONNECTED',
            isPrimary: true,
          },
        ],
        maxCandidates: 5,
        snippetChars: 200,
      },
      {
        fetchLexicalCandidatesAndCheckpoints: async () => ({
          rows: lexicalRows,
          checkpoints: [
            {
              mailboxId: 'mailbox-1',
              lastIndexedAt: new Date('2026-02-27T00:00:00.000Z'),
              lagEstimate: 3,
              backfillState: InboxBackfillState.COMPLETE,
            },
          ],
        }),
        fetchSemanticCandidates: async () => semanticRows,
        embedInboxQueryText: async () => [0.1, 0.2, 0.3],
        now: () => new Date('2026-02-27T00:00:00.000Z'),
        isVectorEnabled: () => true,
      },
    );

    expect(result.coverage.semanticCandidates).toBe(2);
    expect(result.coverage.fusionMethod).toBe('rrf_k60');
    expect(result.coverage.semanticUnavailable).toBe(false);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.documentId).toBe('doc-a');
    expect(result.candidates[0]?.semanticRank).toBe(2);
    expect(result.candidates[1]?.documentId).toBe('doc-b');
    expect(result.candidates[1]?.semanticScore).toBe(0.95);
    expect(result.candidates[1]?.semanticRank).toBe(1);
  });

  test('falls back to lexical-only when query embedding fails', async () => {
    const result = await searchInboxDocuments(
      {
        userId: 'user-1',
        action: 'find',
        queryText: 'budget from alice',
        mode: 'quick',
        profile: 'default',
        filters: {
          sender: 'alice@example.com',
        },
        mailboxes: [
          {
            id: 'mailbox-1',
            emailAddress: 'user@example.com',
            status: 'CONNECTED',
            isPrimary: true,
          },
        ],
        maxCandidates: 5,
        snippetChars: 200,
      },
      {
        fetchLexicalCandidatesAndCheckpoints: async () => ({
          rows: [
            {
              documentId: 'doc-a',
              threadId: 'thread-a',
              messageId: 'msg-a',
              mailboxId: 'mailbox-1',
              mailboxEmail: 'user@example.com',
              from: 'Alice <alice@example.com>',
              to: ['user@example.com'],
              cc: [],
              subject: 'Budget report',
              snippet: 'Budget report attached',
              bodyText: 'Sharing the budget report.',
              sentAt: new Date('2026-02-26T00:00:00.000Z'),
              lexicalScore: 0.75,
              headline: 'Budget report',
            },
          ],
          checkpoints: [
            {
              mailboxId: 'mailbox-1',
              lastIndexedAt: new Date('2026-02-27T00:00:00.000Z'),
              lagEstimate: 1,
              backfillState: InboxBackfillState.COMPLETE,
            },
          ],
        }),
        fetchSemanticCandidates: async () => [],
        embedInboxQueryText: async () => {
          throw new Error('embedding service unavailable');
        },
        now: () => new Date('2026-02-27T00:00:00.000Z'),
        isVectorEnabled: () => true,
      },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.coverage.fusionMethod).toBe('lexical-only');
    expect(result.coverage.semanticUnavailable).toBe(true);
    expect(result.coverage.semanticCandidates).toBe(0);
    expect(result.coverage.budgetNotes.join(' ')).toContain('Semantic retrieval failed');
  });

  test('reports stale freshness metadata when checkpoint is pending', async () => {
    const result = await searchInboxDocuments(
      {
        userId: 'user-1',
        action: 'find',
        queryText: 'status report',
        mode: 'quick',
        profile: 'default',
        mailboxes: [
          {
            id: 'mailbox-1',
            emailAddress: 'user@example.com',
            status: 'CONNECTED',
            isPrimary: true,
          },
        ],
        maxCandidates: 5,
        snippetChars: 200,
      },
      {
        fetchLexicalCandidatesAndCheckpoints: async () => ({
          rows: [],
          checkpoints: [
            {
              mailboxId: 'mailbox-1',
              lastIndexedAt: new Date('2026-02-27T00:00:00.000Z'),
              lagEstimate: 240,
              backfillState: InboxBackfillState.PENDING,
            },
          ],
        }),
        fetchSemanticCandidates: async () => [],
        embedInboxQueryText: async () => [0.1, 0.2],
        now: () => new Date('2026-02-27T00:00:00.000Z'),
        isVectorEnabled: () => true,
      },
    );

    expect(result.coverage.indexFreshness).toBe('stale');
    expect(result.coverage.indexLag).toBe(240);
    expect(result.coverage.budgetNotes.join(' ')).toContain('not started inbox backfill');
  });

  test('returns deterministic grouped counts without LLM retrieval paths', async () => {
    const result = await searchInboxDocuments(
      {
        userId: 'user-1',
        action: 'aggregate',
        mode: 'quick',
        profile: 'default',
        filters: {
          relativeWindow: 'last_30_days',
        },
        options: {
          groupBy: 'sender',
          limit: 3,
        },
        mailboxes: [
          {
            id: 'mailbox-1',
            emailAddress: 'user@example.com',
            status: 'CONNECTED',
            isPrimary: true,
          },
        ],
        maxCandidates: 5,
        snippetChars: 200,
      },
      {
        fetchLexicalCandidatesAndCheckpoints: async () => ({
          rows: [],
          checkpoints: [
            {
              mailboxId: 'mailbox-1',
              lastIndexedAt: new Date('2026-02-27T00:00:00.000Z'),
              lagEstimate: 1,
              backfillState: InboxBackfillState.COMPLETE,
            },
          ],
        }),
        fetchDocumentCount: async () => 7,
        fetchAggregateBuckets: async () => [
          { key: 'Alice <alice@example.com>', count: 4 },
          { key: 'Bob <bob@example.com>', count: 3 },
        ],
        now: () => new Date('2026-02-27T00:00:00.000Z'),
        isVectorEnabled: () => true,
      },
    );

    expect(result.action).toBe('aggregate');
    expect(result.count).toBe(7);
    expect(result.aggregates?.[0]?.key).toContain('Alice');
    expect(result.groupBy).toBe('sender');
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
