import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EmailEvidencePackSchema } from '@/lib/ai/schemas/emailRetrievalSchemas';

const inboxSearchMocks = vi.hoisted(() => ({
  searchInboxDocuments: vi.fn(),
  getInboxRetrievalFeatureFlags: vi.fn(),
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
        'Request: {userRequest}',
        'Mode: {mode}',
        'Constraints: {constraintsJson}',
        'Coverage: {coverageJson}',
        'Candidates: {candidatesJson}',
      ].join('\n'),
    );
    modelMocks.emailRetrieval.mockReturnValue('gemini-email-retrieval');
  });

  test('returns deterministic evidence pack in quick mode without LLM rerank', async () => {
    inboxSearchMocks.searchInboxDocuments.mockResolvedValue({
      candidates: [
        {
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
        },
      ],
      coverage: {
        queriesTried: ['fts=kickoff budget'],
        threadsScanned: 1,
        messagesScanned: 1,
        timeWindow: 'last 180 days',
        pagesFetched: 0,
        truncated: false,
        budgetNotes: [],
        engineVersion: 'inbox-search-v2-hybrid',
        indexFreshness: 'fresh',
        retrievalLatencyMs: 120,
        lexicalCandidates: 1,
        semanticCandidates: 1,
        fusionMethod: 'rrf_k60',
        indexLag: 1,
        semanticUnavailable: false,
      },
    });

    const result = await runEmailRetrieval(
      {
        intent: 'Find kickoff budget email',
        mode: 'quick',
      },
      {
        userId: 'user-1',
      },
    );

    expect(llmMocks.callObject).not.toHaveBeenCalled();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.threadId).toBe('thread-1');
    expect(result.coverage.engineVersion).toBe('inbox-search-v2-hybrid');
    expect(EmailEvidencePackSchema.parse(result)).toBeTruthy();
  });

  test('uses deep LLM compression over local candidates when enabled', async () => {
    inboxSearchMocks.searchInboxDocuments.mockResolvedValue({
      candidates: [
        {
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
        },
      ],
      coverage: {
        queriesTried: ['fts=kickoff budget'],
        threadsScanned: 1,
        messagesScanned: 1,
        timeWindow: 'all time',
        pagesFetched: 0,
        truncated: false,
        budgetNotes: [],
        engineVersion: 'inbox-search-v2-hybrid',
        indexFreshness: 'fresh',
        retrievalLatencyMs: 180,
        lexicalCandidates: 1,
        semanticCandidates: 1,
        fusionMethod: 'rrf_k60',
        indexLag: 1,
        semanticUnavailable: false,
      },
    });

    llmMocks.callObject.mockResolvedValue({
      object: {
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
          queriesTried: [],
          threadsScanned: 0,
          messagesScanned: 0,
          timeWindow: 'unknown',
          pagesFetched: 0,
          truncated: false,
        },
        confidence: 'high',
        followUpQuestions: [],
      },
    });

    const result = await runEmailRetrieval(
      {
        intent: 'Summarize kickoff email evidence',
        mode: 'deep',
      },
      {
        userId: 'user-1',
      },
    );

    expect(llmMocks.callObject).toHaveBeenCalledTimes(1);
    expect(result.coverage.retrievalLatencyMs).toBe(180);
    expect(result.coverage.fusionMethod).toBe('rrf_k60');
    expect(result.matches[0]?.threadId).toBe('thread-1');
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
        intent: 'find latest vendor invoice',
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
