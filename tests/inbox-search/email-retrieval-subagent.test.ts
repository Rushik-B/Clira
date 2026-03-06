import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EmailEvidencePackSchema } from '@/lib/ai/schemas/emailRetrievalSchemas';

const inboxSearchMocks = vi.hoisted(() => ({
  searchInboxDocuments: vi.fn(),
  getInboxRetrievalFeatureFlags: vi.fn(),
  fetchInboxThreadSlice: vi.fn(),
}));

const mailboxMocks = vi.hoisted(() => ({
  getMailboxesForUser: vi.fn(),
}));

const llmMocks = vi.hoisted(() => ({
  callObject: vi.fn(),
}));

const promptMocks = vi.hoisted(() => ({
  readPromptFile: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  emailRetrieval: vi.fn(),
}));

vi.mock('@/lib/services/inbox-search', () => ({
  searchInboxDocuments: inboxSearchMocks.searchInboxDocuments,
  getInboxRetrievalFeatureFlags: inboxSearchMocks.getInboxRetrievalFeatureFlags,
  fetchInboxThreadSlice: inboxSearchMocks.fetchInboxThreadSlice,
}));

vi.mock('@/lib/services/mailbox', () => ({
  getMailboxesForUser: mailboxMocks.getMailboxesForUser,
}));

vi.mock('@/lib/ai/callLlm', () => ({
  callObject: llmMocks.callObject,
}));

vi.mock('@/lib/prompts', () => ({
  readPromptFile: promptMocks.readPromptFile,
}));

vi.mock('@/lib/ai/models', () => ({
  models: {
    emailRetrieval: modelMocks.emailRetrieval,
  },
}));

const { runEmailRetrieval } = await import('@/lib/ai/agents/emailRetrievalSubagent');

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
    documentId: 'doc-1',
    threadId: 'thread-1',
    messageId: 'msg-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'user@example.com',
    date: '2026-02-26T00:00:00.000Z',
    from: 'Alice <alice@example.com>',
    subject: 'Project kickoff',
    snippet: 'Kickoff agenda and budget items.',
    matchedTerms: ['kickoff', 'budget'],
    whyRelevant: 'Matched terms: kickoff, budget.',
    lexicalRank: 1,
    lexicalScore: 0.9,
    semanticScore: 0.8,
    semanticRank: 1,
    rrfScore: 0.03,
    recencyBoost: 0.95,
    exactSenderBoost: 0,
    exactSubjectBoost: 2,
    totalScore: 2.98,
    semanticUnavailable: false,
    ...overrides,
  };
}

function createCoverage(overrides: Record<string, unknown> = {}) {
  return {
    action: 'find',
    queriesTried: ['fts=kickoff budget'],
    threadsScanned: 1,
    messagesScanned: 1,
    timeWindow: 'last 180 days',
    pagesFetched: 0,
    truncated: false,
    filterOnly: false,
    appliedFilters: [],
    budgetNotes: [],
    engineVersion: 'inbox-search-v2-hybrid',
    indexFreshness: 'fresh',
    retrievalLatencyMs: 120,
    lexicalCandidates: 1,
    semanticCandidates: 1,
    fusionMethod: 'rrf_k60',
    indexLag: 1,
    semanticUnavailable: false,
    ...overrides,
  };
}

describe('runEmailRetrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    inboxSearchMocks.getInboxRetrievalFeatureFlags.mockReturnValue({
      retrievalV2Enabled: true,
      vectorEnabled: true,
      llmRerankDeepOnly: true,
    });
    mailboxMocks.getMailboxesForUser.mockResolvedValue([
      {
        id: 'mailbox-1',
        emailAddress: 'user@example.com',
        status: 'CONNECTED',
        isPrimary: true,
      },
    ]);
    promptMocks.readPromptFile.mockReturnValue(
      [
        'Action: {action}',
        'Query: {queryText}',
        'Mode: {mode}',
        'Filters: {filtersJson}',
        'Options: {optionsJson}',
        'Coverage: {coverageJson}',
        'Candidates: {candidatesJson}',
      ].join('\n'),
    );
    modelMocks.emailRetrieval.mockReturnValue('gemini-email-retrieval');
    inboxSearchMocks.fetchInboxThreadSlice.mockResolvedValue(null);
    llmMocks.callObject.mockImplementation(async ({ op }: { op?: string }) => {
      if (op === 'email.retrieval.expansion_decision') {
        return {
          object: {
            shouldExpand: false,
            reasons: ['Compact evidence is sufficient for this request.'],
          },
        };
      }

      throw new Error(`Unexpected callObject op: ${op ?? '(none)'}`);
    });
  });

  test('returns deterministic evidence pack in quick mode without LLM rerank', async () => {
    inboxSearchMocks.searchInboxDocuments.mockResolvedValue({
      action: 'find',
      candidates: [createCandidate()],
      coverage: createCoverage(),
    });

    const result = await runEmailRetrieval(
      {
        action: 'find',
        queryText: 'Find kickoff budget email',
        mode: 'quick',
      },
      {
        userId: 'user-1',
      },
    );

    expect(llmMocks.callObject).toHaveBeenCalledTimes(1);
    expect(llmMocks.callObject).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'email.retrieval.expansion_decision',
      }),
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.threadId).toBe('thread-1');
    expect(result.expansion).toEqual({
      applied: false,
      mode: 'compact',
      reasons: ['Compact evidence is sufficient for this request.'],
    });
    expect(result.coverage.engineVersion).toBe('inbox-search-v2-hybrid');
    expect(EmailEvidencePackSchema.parse(result)).toBeTruthy();
  });

  test('escalates weak quick retrieval internally before returning', async () => {
    inboxSearchMocks.searchInboxDocuments
      .mockResolvedValueOnce({
        action: 'find',
        candidates: [],
        coverage: createCoverage({
          queriesTried: ['fts=invoice'],
          threadsScanned: 0,
          messagesScanned: 0,
          indexFreshness: 'unknown',
          retrievalLatencyMs: 90,
          lexicalCandidates: 0,
          semanticCandidates: 0,
          indexLag: null,
        }),
      })
      .mockResolvedValueOnce({
        action: 'find',
        candidates: [
          createCandidate({
            documentId: 'doc-2',
            threadId: 'thread-2',
            messageId: 'msg-2',
            date: '2026-02-20T00:00:00.000Z',
            from: 'Bob <bob@example.com>',
            subject: 'Invoice attached',
            snippet: 'Here is the invoice you asked for.',
            matchedTerms: ['invoice'],
            whyRelevant: 'Subject phrase matched. Matched terms: invoice.',
            lexicalScore: 0.8,
            semanticScore: 0.7,
            recencyBoost: 0.9,
            totalScore: 4.2,
          }),
        ],
        coverage: createCoverage({
          queriesTried: ['fts=invoice | escalated=deep'],
          timeWindow: 'all time',
          retrievalLatencyMs: 160,
          indexLag: 2,
        }),
      });

    const result = await runEmailRetrieval(
      {
        action: 'find',
        queryText: 'Find the invoice email',
        mode: 'quick',
      },
      {
        userId: 'user-1',
      },
    );

    expect(inboxSearchMocks.searchInboxDocuments).toHaveBeenCalledTimes(2);
    expect(inboxSearchMocks.searchInboxDocuments.mock.calls[0]?.[0]?.mode).toBe('quick');
    expect(inboxSearchMocks.searchInboxDocuments.mock.calls[1]?.[0]?.mode).toBe('deep');
    expect(llmMocks.callObject).toHaveBeenCalledTimes(1);
    expect(result.metadata?.escalation).toBe('quick_to_deep');
    expect(result.coverage.budgetNotes?.join(' ')).toContain(
      'Escalated from quick to deep local retrieval',
    );
    expect(result.matches[0]?.threadId).toBe('thread-2');
    expect(EmailEvidencePackSchema.parse(result)).toBeTruthy();
  });

  test('uses deep LLM compression over local candidates when enabled', async () => {
    inboxSearchMocks.searchInboxDocuments.mockResolvedValue({
      action: 'find',
      candidates: [createCandidate()],
      coverage: createCoverage({
        timeWindow: 'all time',
        retrievalLatencyMs: 180,
      }),
    });

    llmMocks.callObject.mockImplementation(async ({ op }: { op?: string }) => {
      if (op === 'email.retrieval') {
        return {
          object: {
            action: 'find',
            matches: [
              {
                threadId: 'thread-1',
                messageId: 'msg-1',
                mailboxId: 'mailbox-1',
                mailboxEmail: 'user@example.com',
                date: '2026-02-26T00:00:00.000Z',
                from: 'Alice <alice@example.com>',
                subject: 'Project kickoff',
                whyRelevant: 'Budget and kickoff details in this thread.',
                quote: 'Kickoff agenda and budget items.',
              },
            ],
            quotes: [],
            coverage: {
              action: 'find',
              queriesTried: [],
              threadsScanned: 0,
              messagesScanned: 0,
              timeWindow: 'unknown',
              pagesFetched: 0,
              truncated: false,
              filterOnly: false,
              appliedFilters: [],
            },
            confidence: 'high',
            followUpQuestions: [],
          },
        };
      }

      if (op === 'email.retrieval.expansion_decision') {
        return {
          object: {
            shouldExpand: false,
            reasons: ['Compact evidence is sufficient for this request.'],
          },
        };
      }

      throw new Error(`Unexpected callObject op: ${op ?? '(none)'}`);
    });

    const result = await runEmailRetrieval(
      {
        action: 'find',
        queryText: 'Summarize kickoff email evidence',
        mode: 'deep',
      },
      {
        userId: 'user-1',
      },
    );

    expect(llmMocks.callObject).toHaveBeenCalledTimes(2);
    expect(result.coverage.retrievalLatencyMs).toBe(180);
    expect(result.coverage.fusionMethod).toBe('rrf_k60');
    expect(result.matches[0]?.threadId).toBe('thread-1');
    expect(EmailEvidencePackSchema.parse(result)).toBeTruthy();
  });

  test('keeps focused-query confidence low when results are semantic-only', async () => {
    inboxSearchMocks.searchInboxDocuments.mockResolvedValue({
      action: 'find',
      candidates: [
        createCandidate({
          from: 'Eventbrite <marketing@sparkpostmail.com>',
          subject: 'Events worth stepping outside for.',
          snippet: 'Find your reason to get out and explore.',
          matchedTerms: [],
          whyRelevant: 'Semantic similarity 0.910.',
          exactSenderBoost: 0,
          exactSubjectBoost: 0,
          semanticScore: 0.91,
          lexicalScore: null,
          lexicalRank: 0,
          totalScore: 2.1,
        }),
      ],
      coverage: createCoverage({
        lexicalCandidates: 0,
        semanticCandidates: 12,
      }),
    });

    const result = await runEmailRetrieval(
      {
        action: 'find',
        queryText: 'whistler',
        mode: 'quick',
      },
      {
        userId: 'user-1',
      },
    );

    expect(result.confidence).toBe('low');
    expect(result.followUpQuestions).toHaveLength(1);
    expect(EmailEvidencePackSchema.parse(result)).toBeTruthy();
  });

  test('attaches expanded thread slices and records promoted candidate ranks', async () => {
    inboxSearchMocks.searchInboxDocuments.mockResolvedValue({
      action: 'find',
      candidates: [
        createCandidate({ threadId: 'thread-1', messageId: 'msg-1', subject: 'Top result 1', totalScore: 8 }),
        createCandidate({ documentId: 'doc-2', threadId: 'thread-2', messageId: 'msg-2', subject: 'Top result 2', totalScore: 7 }),
        createCandidate({ documentId: 'doc-3', threadId: 'thread-3', messageId: 'msg-3', subject: 'Top result 3', totalScore: 6 }),
        createCandidate({ documentId: 'doc-4', threadId: 'thread-4', messageId: 'msg-4', subject: 'Top result 4', totalScore: 5 }),
        createCandidate({ documentId: 'doc-5', threadId: 'thread-5', messageId: 'msg-5', subject: 'Top result 5', totalScore: 4 }),
        createCandidate({ documentId: 'doc-6', threadId: 'thread-6', messageId: 'msg-6', subject: 'Important thread details', totalScore: 3 }),
      ],
      coverage: createCoverage({
        lexicalCandidates: 6,
        semanticCandidates: 6,
        threadsScanned: 6,
        messagesScanned: 6,
      }),
    });

    llmMocks.callObject.mockImplementation(async ({ op }: { op?: string }) => {
      if (op === 'email.retrieval.expansion_decision') {
        return {
          object: {
            shouldExpand: true,
            reasons: ['Thread context is needed to answer what happened.'],
            preferredAnchorRanks: [6],
          },
        };
      }

      throw new Error(`Unexpected callObject op: ${op ?? '(none)'}`);
    });

    inboxSearchMocks.fetchInboxThreadSlice.mockResolvedValue({
      threadId: 'thread-6',
      mailboxId: 'mailbox-1',
      mailboxEmail: 'user@example.com',
      anchorMessageId: 'msg-6',
      hasMoreBefore: true,
      hasMoreAfter: false,
      messagesReturned: 2,
      bodyCharsUsed: 80,
      messages: [
        {
          messageId: 'msg-5a',
          date: '2026-02-20T00:00:00.000Z',
          from: 'Alice <alice@example.com>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Earlier note',
          bodyText: 'Earlier context',
          isAnchor: false,
          truncatedBody: false,
        },
        {
          messageId: 'msg-6',
          date: '2026-02-21T00:00:00.000Z',
          from: 'Alice <alice@example.com>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Important thread details',
          bodyText: 'Anchor body',
          isAnchor: true,
          truncatedBody: false,
        },
      ],
    });

    const result = await runEmailRetrieval(
      {
        action: 'find',
        queryText: 'What happened in the important thread?',
        userRequestText: 'What happened in the important thread?',
        mode: 'quick',
      },
      {
        userId: 'user-1',
      },
    );

    expect(result.expansion).toEqual({
      applied: true,
      mode: 'expanded',
      reasons: ['Thread context is needed to answer what happened.'],
      promotedCandidateRanks: [6],
    });
    expect(result.expandedThreads).toHaveLength(1);
    expect(result.expandedThreads?.[0]?.selectionRank).toBe(6);
    expect(result.expandedThreads?.[0]?.messagesReturned).toBe(2);
    expect(result.expandedThreads?.[0]?.messages?.[1]?.isAnchor).toBe(true);
    expect(EmailEvidencePackSchema.parse(result)).toBeTruthy();
  });

  test('returns explicit empty coverage when retrieval v2 is disabled by flag', async () => {
    inboxSearchMocks.getInboxRetrievalFeatureFlags.mockReturnValue({
      retrievalV2Enabled: false,
      vectorEnabled: true,
      llmRerankDeepOnly: true,
    });

    const result = await runEmailRetrieval(
      {
        action: 'find',
        queryText: 'find latest vendor invoice',
        mode: 'quick',
      },
      {
        userId: 'user-1',
      },
    );

    expect(inboxSearchMocks.searchInboxDocuments).not.toHaveBeenCalled();
    expect(result.matches).toEqual([]);
    expect(result.coverage.budgetNotes?.join(' ')).toContain(
      'INBOX_RETRIEVAL_V2_ENABLED=false',
    );
    expect(EmailEvidencePackSchema.parse(result)).toBeTruthy();
  });
});
