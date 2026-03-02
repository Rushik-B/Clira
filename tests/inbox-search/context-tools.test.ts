import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EmailEvidencePackSchema } from '@/lib/ai/schemas/emailRetrievalSchemas';

const retrievalMocks = vi.hoisted(() => ({
  runEmailRetrieval: vi.fn(),
}));

const helperMocks = vi.hoisted(() => ({
  buildToolBudgetExceededResult: vi.fn(),
  runWithSubagentBudget: vi.fn(),
  truncate: vi.fn((text: string, maxChars: number) =>
    text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text,
  ),
}));

const memoryMocks = vi.hoisted(() => ({
  gatherMemoryContextForReply: vi.fn(),
  getCalendarSnapshot: vi.fn(),
}));

const calendarAnalysisMocks = vi.hoisted(() => ({
  runCalendarAnalysis: vi.fn(),
}));

const calendarSearchMocks = vi.hoisted(() => ({
  runCalendarSearch: vi.fn(),
}));

const supermemoryMocks = vi.hoisted(() => ({
  isSupermemoryConfigured: vi.fn(),
}));

vi.mock('@/lib/ai/agents/emailRetrievalSubagent', () => ({
  runEmailRetrieval: retrievalMocks.runEmailRetrieval,
}));

vi.mock('@/lib/ai/agents/executive-agent/helpers', () => ({
  buildToolBudgetExceededResult: helperMocks.buildToolBudgetExceededResult,
  runWithSubagentBudget: helperMocks.runWithSubagentBudget,
  truncate: helperMocks.truncate,
}));

vi.mock('@/lib/services/core/replyContextTools', () => ({
  gatherMemoryContextForReply: memoryMocks.gatherMemoryContextForReply,
  getCalendarSnapshot: memoryMocks.getCalendarSnapshot,
}));

vi.mock('@/lib/ai/agents/calendarAnalysisSubagent', () => ({
  runCalendarAnalysis: calendarAnalysisMocks.runCalendarAnalysis,
}));

vi.mock('@/lib/ai/agents/calendarSearchSubagent', () => ({
  runCalendarSearch: calendarSearchMocks.runCalendarSearch,
}));

vi.mock('@/lib/services/supermemory/client', () => ({
  isSupermemoryConfigured: supermemoryMocks.isSupermemoryConfigured,
}));

const { buildContextTools } = await import(
  '@/lib/ai/agents/executive-agent/tools/context-tools'
);

function createEvidencePack(overrides: Record<string, unknown> = {}) {
  return {
    matches: [
      {
        threadId: 'thread-1',
        messageId: 'message-1',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        date: '2026-03-01T10:00:00.000Z',
        from: 'Alice <alice@example.com>',
        subject: 'Invoice follow-up',
        whyRelevant: 'Matched terms: invoice.',
        quote: 'Invoice is attached.',
      },
    ],
    quotes: [],
    coverage: {
      queriesTried: ['fts=invoice'],
      threadsScanned: 1,
      messagesScanned: 1,
      timeWindow: 'last 30 days',
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
    confidence: 'high',
    followUpQuestions: [],
    ...overrides,
  };
}

function createContext() {
  return {
    input: {
      userId: 'user-1',
      userEmail: 'user@example.com',
      userRequest: 'Find the latest invoice',
      conversationId: 'conversation-1',
      channel: 'whatsapp',
      conversationHistory: [],
    },
    channel: 'whatsapp',
    retrievalProfile: 'messaging',
    userTimezone: 'America/Vancouver',
    currentTimeUtc: '2026-03-02T10:00:00.000Z',
    currentTimeUserTz: 'Monday, March 2, 2026 at 02:00 AM',
    dayOfWeek: 'Monday',
    toolAbort: {
      timeLeftMs: () => 60_000,
    },
    toolAbortSignal: undefined,
    isRunCurrent: async () => true,
    isBurstStable: () => true,
    onMemoryStored: vi.fn(),
  } as const;
}

describe('buildContextTools search_inbox_context', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    helperMocks.runWithSubagentBudget.mockImplementation(
      async ({ run }: { run: (budgetContext: { abortSignal?: AbortSignal; deadlineAt?: number }) => Promise<unknown> }) =>
        run({ abortSignal: undefined, deadlineAt: Date.now() + 30_000 }),
    );
    helperMocks.buildToolBudgetExceededResult.mockImplementation(
      (toolName: string, message: string, counts: Record<string, number>) => ({
        toolName,
        message,
        counts,
        budgetExceeded: true,
      }),
    );
    retrievalMocks.runEmailRetrieval.mockResolvedValue(createEvidencePack());
    supermemoryMocks.isSupermemoryConfigured.mockReturnValue(false);
  });

  test('memoizes duplicate inbox calls within one run and marks cached reuse', async () => {
    const nextSubagentCallIndex = vi.fn(() => 0);
    const tools = buildContextTools({
      context: createContext(),
      nextSubagentCallIndex,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    const first = await tools.search_inbox_context.execute({
      mode: 'quick',
      intent: 'Find the latest invoice',
      mailboxEmail: 'USER@example.com',
      constraints: {
        sender: 'Alice@example.com',
        keywords: ['invoice', 'latest'],
      },
    });
    const second = await tools.search_inbox_context.execute({
      mode: 'quick',
      intent: '  find   the latest invoice  ',
      mailboxEmail: 'user@example.com',
      constraints: {
        sender: 'alice@example.com',
        keywords: ['latest', 'invoice'],
      },
    });

    expect(retrievalMocks.runEmailRetrieval).toHaveBeenCalledTimes(1);
    expect(helperMocks.runWithSubagentBudget).toHaveBeenCalledTimes(1);
    expect(nextSubagentCallIndex).toHaveBeenCalledTimes(1);
    expect((first as any).metadata).toBeUndefined();
    expect((second as any).metadata?.cached).toBe(true);
    expect(EmailEvidencePackSchema.parse(second)).toBeTruthy();
  });

  test('cached duplicate calls do not consume the inbox call budget', async () => {
    const tools = buildContextTools({
      context: createContext(),
      nextSubagentCallIndex: () => 0,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    const first = await tools.search_inbox_context.execute({
      mode: 'quick',
      intent: 'Find invoice A',
    });
    const duplicate = await tools.search_inbox_context.execute({
      mode: 'quick',
      intent: 'find invoice a',
    });
    const secondDistinct = await tools.search_inbox_context.execute({
      mode: 'quick',
      intent: 'Find invoice B',
    });
    const overBudget = await tools.search_inbox_context.execute({
      mode: 'quick',
      intent: 'Find invoice C',
    });

    expect(EmailEvidencePackSchema.parse(first)).toBeTruthy();
    expect(EmailEvidencePackSchema.parse(duplicate)).toBeTruthy();
    expect(EmailEvidencePackSchema.parse(secondDistinct)).toBeTruthy();
    expect((duplicate as any).metadata?.cached).toBe(true);
    expect(retrievalMocks.runEmailRetrieval).toHaveBeenCalledTimes(2);
    expect(helperMocks.buildToolBudgetExceededResult).toHaveBeenCalledTimes(1);
    expect(overBudget).toEqual({
      toolName: 'search_inbox_context',
      message: 'Max quick inbox searches reached.',
      counts: { total: 2, tool: 2 },
      budgetExceeded: true,
    });
  });

  test('memory and calendar context tools keep existing local behavior', async () => {
    const tools = buildContextTools({
      context: createContext(),
      nextSubagentCallIndex: () => 0,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    const memoryResult = await tools.search_memory.execute({
      query: 'who is my manager',
    });
    const calendarResult = await tools.check_calendar.execute({
      startDate: 'bad-date',
      endDate: 'bad-date',
    });

    expect(memoryResult).toEqual({
      query: 'who is my manager',
      count: 0,
      memories: [],
      note: 'Memory system not configured',
    });
    expect(calendarResult).toEqual({
      freeSlots: [],
      conflicts: [],
      recommendation: 'Invalid date format. Use ISO format like "2026-01-20".',
    });
    expect(calendarAnalysisMocks.runCalendarAnalysis).not.toHaveBeenCalled();
  });
});
