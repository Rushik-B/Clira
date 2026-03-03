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

const prismaMocks = vi.hoisted(() => ({
  mailboxFindMany: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mailbox: {
      findMany: prismaMocks.mailboxFindMany,
    },
  },
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

function normalizeCacheValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCacheValue(item)).sort();
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value)
    .filter(([, itemValue]) => itemValue !== undefined)
    .map(([key, itemValue]) => [key, normalizeCacheValue(itemValue)] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

function createMockToolResultCache() {
  const cache = new Map<string, unknown>();

  const buildKey = (toolName: string, args: unknown) =>
    `${toolName}:${JSON.stringify(normalizeCacheValue(args))}`;

  return {
    get(toolName: string, args: unknown) {
      const key = buildKey(toolName, args);
      const cached = cache.get(key);
      if (!cached || typeof cached !== 'object' || cached === null) {
        return cached ?? null;
      }

      return {
        ...cached,
        metadata: {
          ...((cached as Record<string, unknown>).metadata as Record<string, unknown> | undefined),
          cached: true,
        },
      };
    },
    set(toolName: string, args: unknown, result: unknown) {
      cache.set(buildKey(toolName, args), result);
    },
    noteMutation() {},
    getStats() {
      return {
        search_inbox_context: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        search_calendar: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        check_calendar: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        search_memory: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
      };
    },
  };
}

function createContext() {
  return {
    input: {
      userId: 'user-1',
      userEmail: 'user@example.com',
      userRequest: 'Find the latest invoice',
      conversationId: 'conversation-1',
      channel: 'whatsapp' as const,
      conversationHistory: [] as { role: 'USER' | 'ASSISTANT' | 'SYSTEM'; content: string; id: string; createdAt: Date; direction: 'INBOUND' | 'OUTBOUND'; metadata?: Record<string, unknown> | null }[],
    },
    channel: 'whatsapp' as const,
    retrievalProfile: 'messaging' as const,
    selectedPack: 'inbox_context_pack' as const,
    selectorReasons: ['test'],
    turnFeatures: {
      explicitSendApproval: false,
      explicitSendDecline: false,
      draftCandidatePresent: false,
      draftCandidateReason: null,
      pendingCalendarChangePresent: false,
      calendarMutationIntent: false,
      calendarQueryIntent: false,
      workloadOverviewIntent: false,
      emailIntent: true,
      reminderIntent: false,
      alertIntent: false,
      recallIntent: false,
      classifierDecision: null,
      channel: 'whatsapp' as const,
      hasRecentSendSuccess: false,
      hasRecentPendingCalendarPreview: false,
      pendingCalendarConfirmIntent: false,
      pendingCalendarCancelIntent: false,
      pendingCalendarModifyIntent: false,
      ambiguousCalendarLike: false,
      ambiguousEmailLike: false,
    },
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
    toolResultCache: createMockToolResultCache(),
  };
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
    prismaMocks.mailboxFindMany.mockResolvedValue([]);
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

  test('infers user-local day constraints from inbox date requests', async () => {
    const tools = buildContextTools({
      context: createContext(),
      nextSubagentCallIndex: () => 0,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    await tools.search_inbox_context.execute({
      mode: 'deep',
      intent: 'check my inbox for 25th feb and tell me what happened',
    });

    expect(retrievalMocks.runEmailRetrieval).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'check my inbox for 25th feb and tell me what happened',
        constraints: expect.objectContaining({
          startDate: '2026-02-25T08:00:00.000Z',
          endDate: '2026-02-26T08:00:00.000Z',
        }),
      }),
      expect.any(Object),
    );
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
