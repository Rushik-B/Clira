import { InboxBackfillState } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { analyzeInboxQueryIntent } from '@/lib/services/inbox-search/query-intent';
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

  test('classifies focused contact and entity queries deterministically', () => {
    expect(
      analyzeInboxQueryIntent({
        queryText: 'chris',
      }).intent,
    ).toBe('contact_or_person');

    expect(
      analyzeInboxQueryIntent({
        queryText: 'whistler',
      }).intent,
    ).toBe('entity_or_place');

    expect(
      analyzeInboxQueryIntent({
        queryText: '"project kickoff"',
      }).intent,
    ).toBe('exact_phrase');

    expect(
      analyzeInboxQueryIntent({
        queryText: 'topazlabs.com',
      }).intent,
    ).toBe('email_or_domain');
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

  test('keeps direct sender and outbound correspondence ahead of newsletter mentions for contact queries', async () => {
    const lexicalRows = [
      {
        documentId: 'doc-newsletter',
        threadId: 'thread-newsletter',
        messageId: 'msg-newsletter',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'SoundCloud <info@announcements.soundcloud.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Weekly Download',
        snippet: "Chris Liebing and Charlotte de Witte are in this week's mix.",
        bodyText: 'Chris Liebing and Charlotte de Witte headline the download.',
        sentAt: new Date('2026-02-27T00:00:00.000Z'),
        lexicalScore: 1.1,
        headline: 'Chris Liebing and Charlotte de Witte headline the download',
      },
      {
        documentId: 'doc-direct',
        threadId: 'thread-direct',
        messageId: 'msg-direct',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Chris Williamson <chris@chriswillx.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Weekly check-in',
        snippet: 'Wanted to follow up directly.',
        bodyText: 'Wanted to follow up directly on the plan.',
        sentAt: new Date('2026-02-20T00:00:00.000Z'),
        lexicalScore: 0.8,
        headline: 'Chris Williamson <chris@chriswillx.com> Weekly check-in',
      },
      {
        documentId: 'doc-outbound',
        threadId: 'thread-outbound',
        messageId: 'msg-outbound',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Rushik <user@example.com>',
        to: ['Chris <chris@example.com>'],
        cc: [],
        subject: 'your best hire yet??',
        snippet: 'heya chris, following up on the startup',
        bodyText: 'heya chris, following up on the startup.',
        sentAt: new Date('2026-02-18T00:00:00.000Z'),
        lexicalScore: 0.78,
        headline: 'heya <<chris>>, following up on the startup',
      },
    ];

    const semanticRows = [
      {
        documentId: 'doc-newsletter',
        threadId: 'thread-newsletter',
        messageId: 'msg-newsletter',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'SoundCloud <info@announcements.soundcloud.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Weekly Download',
        snippet: "Chris Liebing and Charlotte de Witte are in this week's mix.",
        bodyText: 'Chris Liebing and Charlotte de Witte headline the download.',
        sentAt: new Date('2026-02-27T00:00:00.000Z'),
        semanticScore: 0.96,
        semanticDistance: 0.04,
        semanticChunkText: 'Chris Liebing and Charlotte de Witte headline the download.',
      },
      {
        documentId: 'doc-direct',
        threadId: 'thread-direct',
        messageId: 'msg-direct',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Chris Williamson <chris@chriswillx.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Weekly check-in',
        snippet: 'Wanted to follow up directly.',
        bodyText: 'Wanted to follow up directly on the plan.',
        sentAt: new Date('2026-02-20T00:00:00.000Z'),
        semanticScore: 0.73,
        semanticDistance: 0.27,
        semanticChunkText: 'Chris Williamson sent a direct follow-up.',
      },
      {
        documentId: 'doc-outbound',
        threadId: 'thread-outbound',
        messageId: 'msg-outbound',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Rushik <user@example.com>',
        to: ['Chris <chris@example.com>'],
        cc: [],
        subject: 'your best hire yet??',
        snippet: 'heya chris, following up on the startup',
        bodyText: 'heya chris, following up on the startup.',
        sentAt: new Date('2026-02-18T00:00:00.000Z'),
        semanticScore: 0.76,
        semanticDistance: 0.24,
        semanticChunkText: 'Follow-up email to Chris about the startup.',
      },
    ];

    const result = await searchInboxDocuments(
      {
        userId: 'user-1',
        action: 'find',
        queryText: 'chris',
        mode: 'deep',
        profile: 'default',
        mailboxes: [
          {
            id: 'mailbox-1',
            emailAddress: 'user@example.com',
            status: 'CONNECTED',
            isPrimary: true,
          },
        ],
        maxCandidates: 10,
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
        embedInboxQueryText: async () => [0.2, 0.1, 0.7],
        now: () => new Date('2026-02-27T12:00:00.000Z'),
        isVectorEnabled: () => true,
      },
    );

    expect(result.candidates[0]?.documentId).toBe('doc-direct');
    expect(result.candidates[1]?.documentId).toBe('doc-outbound');
    expect(result.candidates[2]?.documentId).toBe('doc-newsletter');
    expect(result.candidates[0]?.whyRelevant).toContain('Sender matched exactly');
  });

  test('drops weak semantic-only noise and keeps literal whistler emails on top', async () => {
    const lexicalRows = [
      {
        documentId: 'doc-trip',
        threadId: 'thread-trip',
        messageId: 'msg-trip',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'SFU Residence Hall Association <rha_at_sfu@sfu.ca>',
        to: ['user@example.com'],
        cc: [],
        subject: '2026 RHA Whistler Trip – Spot Confirmation',
        snippet: 'Confirm your spot for the 2026 RHA Whistler Trip.',
        bodyText: 'Confirm your spot for the 2026 RHA Whistler Trip and review logistics.',
        sentAt: new Date('2026-01-29T22:26:16.000Z'),
        lexicalScore: 0.95,
        headline: '2026 RHA <<Whistler>> Trip – Spot Confirmation',
      },
      {
        documentId: 'doc-payment',
        threadId: 'thread-payment',
        messageId: 'msg-payment',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Scotiabank <catch@payments.interac.ca>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Interac e-Transfer deposited',
        snippet: 'Rushik Behal whistler trip payment',
        bodyText: 'Message: Rushik Behal whistler trip payment.',
        sentAt: new Date('2026-01-23T19:55:19.000Z'),
        lexicalScore: 0.72,
        headline: 'Rushik Behal <<whistler>> trip payment',
      },
      {
        documentId: 'doc-event',
        threadId: 'thread-event',
        messageId: 'msg-event',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Residence Housing Department <residence_housing@sfu.ca>',
        to: ['user@example.com'],
        cc: [],
        subject: 'RHA EVENT: Whistler trip - January 31',
        snippet: 'Join the Residence Hall Association trip to Whistler.',
        bodyText: 'Join the Residence Hall Association trip to Whistler.',
        sentAt: new Date('2026-01-16T21:17:36.000Z'),
        lexicalScore: 0.7,
        headline: 'RHA EVENT: <<Whistler>> trip - January 31',
      },
    ];

    const semanticRows = [
      {
        documentId: 'doc-noise',
        threadId: 'thread-noise',
        messageId: 'msg-noise',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'Eventbrite <marketing@sparkpostmail.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Events worth stepping outside for.',
        snippet: 'Find your reason to get out and explore.',
        bodyText: 'Find your reason to get out and explore.',
        sentAt: new Date('2026-03-05T03:58:00.000Z'),
        semanticScore: 0.62,
        semanticDistance: 0.38,
        semanticChunkText: 'Outdoor weekend events near Vancouver and ski destinations.',
      },
      {
        documentId: 'doc-trip',
        threadId: 'thread-trip',
        messageId: 'msg-trip',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        from: 'SFU Residence Hall Association <rha_at_sfu@sfu.ca>',
        to: ['user@example.com'],
        cc: [],
        subject: '2026 RHA Whistler Trip – Spot Confirmation',
        snippet: 'Confirm your spot for the 2026 RHA Whistler Trip.',
        bodyText: 'Confirm your spot for the 2026 RHA Whistler Trip and review logistics.',
        sentAt: new Date('2026-01-29T22:26:16.000Z'),
        semanticScore: 0.88,
        semanticDistance: 0.12,
        semanticChunkText: 'Whistler trip logistics and spot confirmation.',
      },
    ];

    const result = await searchInboxDocuments(
      {
        userId: 'user-1',
        action: 'find',
        queryText: 'whistler',
        mode: 'deep',
        profile: 'default',
        mailboxes: [
          {
            id: 'mailbox-1',
            emailAddress: 'user@example.com',
            status: 'CONNECTED',
            isPrimary: true,
          },
        ],
        maxCandidates: 10,
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
        embedInboxQueryText: async () => [0.4, 0.3, 0.2],
        now: () => new Date('2026-03-05T12:00:00.000Z'),
        isVectorEnabled: () => true,
      },
    );

    expect(result.candidates[0]?.documentId).toBe('doc-trip');
    expect(result.candidates.slice(0, 3).map((candidate) => candidate.documentId)).toEqual(
      expect.arrayContaining(['doc-trip', 'doc-payment', 'doc-event']),
    );
    expect(result.candidates.map((candidate) => candidate.documentId)).not.toContain('doc-noise');
    expect(result.coverage.budgetNotes.join(' ')).toContain(
      'Dropped 1 weak semantic-only candidate',
    );
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
