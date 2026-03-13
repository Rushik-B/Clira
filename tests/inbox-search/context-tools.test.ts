import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EmailEvidencePackSchema } from '@/lib/ai/schemas/emailRetrievalSchemas';
import { MESSAGING_INBOX_CALL_LIMITS } from '@/lib/ai/agents/executive-agent/constants';

const retrievalMocks = vi.hoisted(() => ({
  runEmailRetrieval: vi.fn(),
}));

const listInboxMocks = vi.hoisted(() => ({
  listInboxEmails: vi.fn(),
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

vi.mock('@/lib/services/inbox-search', () => ({
  listInboxEmails: listInboxMocks.listInboxEmails,
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
    action: 'find',
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
      action: 'find',
      queriesTried: ['fts=invoice'],
      threadsScanned: 1,
      messagesScanned: 1,
      timeWindow: 'last 30 days',
      pagesFetched: 0,
      truncated: false,
      filterOnly: false,
      appliedFilters: ['sender', 'keywords'],
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

function createListInboxEmailsResult(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        messageId: 'message-1',
        threadId: 'thread-1',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        sentAt: '2026-03-01T10:00:00.000Z',
        from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Thanks for your order',
        snippet: "Here's your receipt for order 9190.",
        hasAttachment: false,
        bodyText: 'Total $9.66',
      },
    ],
    matchedCount: 1,
    returnedCount: 1,
    truncated: false,
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
    get<T = unknown>(toolName: string, args: unknown): T | null {
      const key = buildKey(toolName, args);
      const cached = cache.get(key);
      if (!cached || typeof cached !== 'object' || cached === null) {
        return (cached ?? null) as T | null;
      }

      return {
        ...cached,
        metadata: {
          ...((cached as Record<string, unknown>).metadata as Record<string, unknown> | undefined),
          cached: true,
        },
      } as T;
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
        list_inbox_emails: {
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

function createContext(overrides: Record<string, unknown> = {}) {
  const baseContext = {
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
      draftCandidatePresent: false,
      draftCandidateReason: null,
      pendingCalendarChangePresent: false,
      calendarMutationIntent: false,
      calendarQueryIntent: false,
      workloadOverviewIntent: false,
      reminderIntent: false,
      alertIntent: false,
      channel: 'whatsapp' as const,
      hasRecentPendingCalendarPreview: false,
      pendingCalendarConfirmIntent: false,
      pendingCalendarCancelIntent: false,
      pendingCalendarModifyIntent: false,
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

  return {
    ...baseContext,
    ...overrides,
    input: {
      ...baseContext.input,
      ...((overrides.input as Record<string, unknown> | undefined) ?? {}),
    },
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
    listInboxMocks.listInboxEmails.mockResolvedValue(createListInboxEmailsResult());
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
      action: 'find',
      mode: 'quick',
      queryText: 'Find the latest invoice',
      mailboxEmail: 'USER@example.com',
      filters: {
        sender: 'Alice@example.com',
        keywords: ['invoice', 'latest'],
      },
    });
    const second = await tools.search_inbox_context.execute({
      action: 'find',
      mode: 'quick',
      queryText: '  find   the latest invoice  ',
      mailboxEmail: 'user@example.com',
      filters: {
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
    const quickLimit = MESSAGING_INBOX_CALL_LIMITS.quick;

    const first = await tools.search_inbox_context.execute({
      action: 'find',
      mode: 'quick',
      queryText: 'Find invoice A',
    });
    const duplicate = await tools.search_inbox_context.execute({
      action: 'find',
      mode: 'quick',
      queryText: 'find invoice a',
    });
    const distinctResults: unknown[] = [];
    for (let index = 1; index < quickLimit; index += 1) {
      distinctResults.push(await tools.search_inbox_context.execute({
        action: 'find',
        mode: 'quick',
        queryText: `Find invoice ${String.fromCharCode(65 + index)}`,
      }));
    }
    const overBudget = await tools.search_inbox_context.execute({
      action: 'find',
      mode: 'quick',
      queryText: `Find invoice ${String.fromCharCode(65 + quickLimit)}`,
    });

    expect(EmailEvidencePackSchema.parse(first)).toBeTruthy();
    expect(EmailEvidencePackSchema.parse(duplicate)).toBeTruthy();
    expect(EmailEvidencePackSchema.parse(distinctResults.at(-1))).toBeTruthy();
    expect((duplicate as any).metadata?.cached).toBe(true);
    expect(retrievalMocks.runEmailRetrieval).toHaveBeenCalledTimes(quickLimit);
    expect(helperMocks.buildToolBudgetExceededResult).toHaveBeenCalledTimes(1);
    expect(overBudget).toEqual({
      toolName: 'search_inbox_context',
      message: 'Max quick inbox searches reached.',
      counts: { total: quickLimit, tool: quickLimit },
      budgetExceeded: true,
    });
  });

  test('runtime inbox cache key changes when the live user request changes', async () => {
    const nextSubagentCallIndex = vi.fn(() => 0);
    const sharedCache = createMockToolResultCache();
    const args = {
      action: 'find',
      mode: 'quick',
      queryText: 'Find the invoice thread',
    };

    const firstTools = buildContextTools({
      context: createContext({
        input: {
          userRequest: 'Find the invoice thread',
        },
        toolResultCache: sharedCache,
      }),
      nextSubagentCallIndex,
    }) as Record<string, { execute: (toolArgs: Record<string, unknown>) => Promise<unknown> }>;

    const secondTools = buildContextTools({
      context: createContext({
        input: {
          userRequest: 'What happened in the invoice thread?',
        },
        toolResultCache: sharedCache,
      }),
      nextSubagentCallIndex,
    }) as Record<string, { execute: (toolArgs: Record<string, unknown>) => Promise<unknown> }>;

    await firstTools.search_inbox_context.execute(args);
    await secondTools.search_inbox_context.execute(args);

    expect(retrievalMocks.runEmailRetrieval).toHaveBeenCalledTimes(2);
  });

  test('passes structured summarize_range filters through without natural-language date inference', async () => {
    const tools = buildContextTools({
      context: createContext(),
      nextSubagentCallIndex: () => 0,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    await tools.search_inbox_context.execute({
      action: 'summarize_range',
      mode: 'deep',
      filters: {
        startDate: '2026-02-25',
        endDate: '2026-02-25',
      },
    });

    expect(retrievalMocks.runEmailRetrieval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'summarize_range',
        filters: expect.objectContaining({
          startDate: '2026-02-25',
          endDate: '2026-02-25',
        }),
        options: expect.objectContaining({
          timezone: 'America/Vancouver',
        }),
      }),
      expect.any(Object),
    );
  });

  test('returns an explicit validation result for invalid structured inbox arguments', async () => {
    const tools = buildContextTools({
      context: createContext(),
      nextSubagentCallIndex: () => 0,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    const result = await tools.search_inbox_context.execute({
      action: 'aggregate',
      mode: 'deep',
      queryText: 'invoice',
    });

    expect(retrievalMocks.runEmailRetrieval).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'aggregate',
        confidence: 'low',
        summary: 'aggregate requires options.groupBy.',
        metadata: {
          validationError: true,
        },
      }),
    );
  });

  test('memoizes duplicate list_inbox_emails calls within one run and avoids subagent execution', async () => {
    const nextSubagentCallIndex = vi.fn(() => 0);
    const tools = buildContextTools({
      context: createContext({
        input: {
          userRequest: 'How much did I spend at Tim Hortons this week?',
        },
      }),
      nextSubagentCallIndex,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    const first = await tools.list_inbox_emails.execute({
      filters: {
        sender: 'Tim Hortons',
        relativeWindow: 'last_7_days',
      },
      options: {
        includeBody: true,
        limit: 50,
      },
    });
    const second = await tools.list_inbox_emails.execute({
      filters: {
        sender: 'tim hortons',
        relativeWindow: 'last_7_days',
      },
      options: {
        includeBody: true,
        limit: 20,
      },
    });

    expect(listInboxMocks.listInboxEmails).toHaveBeenCalledTimes(1);
    expect(listInboxMocks.listInboxEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          sender: 'Tim Hortons',
          relativeWindow: 'last_7_days',
        }),
        options: expect.objectContaining({
          includeBody: true,
          limit: 20,
          sortBy: 'newest',
          timezone: 'America/Vancouver',
        }),
      }),
      expect.objectContaining({
        userId: 'user-1',
      }),
    );
    expect(retrievalMocks.runEmailRetrieval).toHaveBeenCalledTimes(0);
    expect(helperMocks.runWithSubagentBudget).toHaveBeenCalledTimes(0);
    expect(nextSubagentCallIndex).toHaveBeenCalledTimes(0);
    expect((first as any).metadata).toBeUndefined();
    expect((second as any).metadata?.cached).toBe(true);
  });

  test('returns an explicit validation result for invalid list_inbox_emails arguments', async () => {
    const tools = buildContextTools({
      context: createContext(),
      nextSubagentCallIndex: () => 0,
    }) as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;

    const result = await tools.list_inbox_emails.execute({
      options: {
        includeBody: true,
      },
    });

    expect(listInboxMocks.listInboxEmails).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      matchedCount: 0,
      returnedCount: 0,
      truncated: false,
      note:
        'list_inbox_emails requires threadId or messageId, or at least one identity/content constraint (sender, recipient, or subjectContains) plus one scope constraint (mailbox scope or date range).',
      metadata: {
        validationError: true,
      },
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
