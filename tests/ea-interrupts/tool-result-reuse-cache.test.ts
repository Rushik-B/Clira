import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createExecutiveToolResultReuseCache,
} from '@/lib/ai/agents/executive-agent/toolResultReuseCache';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';

function buildAssistantMessage(params: {
  createdAt: Date;
  metadata: Record<string, unknown>;
}): ConversationMessageDTO {
  return {
    id: 'msg-assistant',
    content: 'ok',
    role: 'ASSISTANT',
    direction: 'OUTBOUND',
    createdAt: params.createdAt,
    metadata: params.metadata,
  };
}

describe('Executive tool result reuse cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('reuses matching search_inbox_context result from history with normalized defaults', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:58:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'search_inbox_context',
              toolCallId: 'call-1',
              args: {
                mode: 'quick',
                intent: 'invoice status',
                constraints: { sender: 'finance@acme.com' },
              },
            },
          ],
          toolResults: [
            {
              toolName: 'search_inbox_context',
              toolCallId: 'call-1',
              result: {
                matches: [{ threadId: 't-1' }],
                confidence: 'high',
              },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const cached = cache.get<Record<string, unknown>>('search_inbox_context', {
      intent: 'invoice status',
      constraints: { sender: 'finance@acme.com' },
    });

    expect(cached).toBeTruthy();
    expect(cached?.matches).toBeTruthy();
    expect((cached?._cache as { source?: string } | undefined)?.source).toBe('history');
    expect((cached?._cache as { hit?: boolean } | undefined)?.hit).toBe(true);
  });

  test('does not reuse stale search_calendar result after TTL expiry', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:53:30.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'search_calendar',
              toolCallId: 'call-2',
              args: {
                query: 'team sync',
                startDate: '2026-02-26',
                endDate: '2026-02-26',
              },
            },
          ],
          toolResults: [
            {
              toolName: 'search_calendar',
              toolCallId: 'call-2',
              result: { events: [{ eventId: 'evt-1' }], summary: 'found one' },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const cached = cache.get('search_calendar', {
      query: 'team sync',
      startDate: '2026-02-26',
      endDate: '2026-02-26',
    });

    expect(cached).toBeNull();
  });

  test('ignores non-cacheable failed results from history', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:59:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'search_inbox_context',
              toolCallId: 'call-3',
              args: { mode: 'deep', intent: 'budget report' },
            },
          ],
          toolResults: [
            {
              toolName: 'search_inbox_context',
              toolCallId: 'call-3',
              result: { ok: false, error: 'tool_budget_exceeded' },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const cached = cache.get('search_inbox_context', {
      mode: 'deep',
      intent: 'budget report',
    });

    expect(cached).toBeNull();
  });

  test('stores and reuses runtime results within the same run', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: [] });
    cache.set(
      'search_memory',
      { query: 'manager' },
      {
        query: 'manager',
        count: 1,
        memories: [{ content: 'Manager is Priya', relevanceScore: 0.92 }],
      },
    );

    const cached = cache.get<Record<string, unknown>>('search_memory', {
      query: 'manager',
      limit: 5,
    });

    expect(cached).toBeTruthy();
    expect(cached?.count).toBe(1);
    expect((cached?._cache as { source?: string } | undefined)?.source).toBe('runtime');
    const stats = cache.getStats();
    expect(stats.search_memory.set_ok).toBe(1);
    expect(stats.search_memory.runtime_hit).toBe(1);
  });

  test('reuses search_web runtime results with normalized defaults', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: [] });
    cache.set(
      'search_web',
      {
        query: 'latest openai announcement',
        includeDomains: ['OpenAI.com', 'openai.com'],
      },
      {
        ok: true,
        provider: 'public_web',
        searchType: 'auto',
        query: 'latest openai announcement',
        category: 'general',
        freshness: 'default',
        resultMode: 'highlights',
        resultCount: 1,
        sources: [{ title: 'OpenAI', url: 'https://openai.com', snippets: [] }],
        summary: 'Found 1 public web result.',
      },
    );

    const cached = cache.get<Record<string, unknown>>('search_web', {
      query: 'latest openai announcement',
      category: 'general',
      freshness: 'default',
      resultMode: 'highlights',
      maxResults: 5,
      includeDomains: [' openai.com '],
    });

    expect(cached).toBeTruthy();
    expect(cached?.resultCount).toBe(1);
    expect((cached?._cache as { source?: string } | undefined)?.source).toBe('runtime');
    expect(cache.getStats().search_web.runtime_hit).toBe(1);
  });

  test('reuses list_inbox_emails history results with normalized defaults', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:58:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'list_inbox_emails',
              toolCallId: 'call-list',
              args: {
                filters: {
                  sender: 'Tim Hortons',
                  relativeWindow: 'last_7_days',
                },
                options: {
                  includeBody: true,
                },
              },
            },
          ],
          toolResults: [
            {
              toolName: 'list_inbox_emails',
              toolCallId: 'call-list',
              result: {
                items: [{ messageId: 'msg-1' }],
                matchedCount: 4,
                returnedCount: 4,
                truncated: false,
              },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const cached = cache.get<Record<string, unknown>>('list_inbox_emails', {
      filters: {
        sender: ' tim hortons ',
        relativeWindow: 'last_7_days',
      },
      options: {
        includeBody: true,
        limit: 20,
        sortBy: 'newest',
      },
    });

    expect(cached).toBeTruthy();
    expect(cached?.matchedCount).toBe(4);
    expect((cached?._cache as { source?: string } | undefined)?.source).toBe('history');
    const stats = cache.getStats();
    expect(stats.list_inbox_emails.history_hit).toBe(1);
  });

  test('reuses read_email_pdf_attachment history results with normalized mailbox and filename', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:58:30.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'read_email_pdf_attachment',
              toolCallId: 'call-pdf',
              args: {
                messageId: 'message-1',
                mailboxEmail: 'User@Example.com',
                attachmentFilename: 'Invoice.PDF',
              },
            },
          ],
          toolResults: [
            {
              toolName: 'read_email_pdf_attachment',
              toolCallId: 'call-pdf',
              result: {
                ok: true,
                status: 'ok',
                extractedText: 'Invoice attached.\nTotal due: $400',
              },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const cached = cache.get<Record<string, unknown>>('read_email_pdf_attachment', {
      messageId: 'message-1',
      mailboxEmail: 'user@example.com',
      attachmentFilename: 'invoice.pdf',
    });

    expect(cached).toBeTruthy();
    expect(cached?.extractedText).toBe('Invoice attached.\nTotal due: $400');
    expect((cached?._cache as { source?: string } | undefined)?.source).toBe('history');
    expect(cache.getStats().read_email_pdf_attachment.history_hit).toBe(1);
  });

  test('invalidates search_memory cache entries older than successful append_to_supermemory', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:58:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'search_memory',
              toolCallId: 'call-memory',
              args: { query: 'manager', limit: 5 },
            },
          ],
          toolResults: [
            {
              toolName: 'search_memory',
              toolCallId: 'call-memory',
              result: {
                query: 'manager',
                count: 1,
                memories: [{ content: 'Manager is Priya', relevanceScore: 0.92 }],
              },
            },
          ],
        },
      }),
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:59:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'append_to_supermemory',
              toolCallId: 'call-append',
              args: { content: 'Manager is Priya', type: 'relationship_info' },
            },
          ],
          toolResults: [
            {
              toolName: 'append_to_supermemory',
              toolCallId: 'call-append',
              result: { stored: true, customId: 'memory-1' },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const cached = cache.get('search_memory', { query: 'manager', limit: 5 });

    expect(cached).toBeNull();
    const stats = cache.getStats();
    expect(stats.search_memory.miss_invalidated).toBe(1);
  });

  test('invalidates calendar cache entries older than successful confirm commit_calendar_change', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:58:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'search_calendar',
              toolCallId: 'call-calendar',
              args: { query: 'team sync', startDate: '2026-02-26', endDate: '2026-02-26' },
            },
          ],
          toolResults: [
            {
              toolName: 'search_calendar',
              toolCallId: 'call-calendar',
              result: {
                events: [{ eventId: 'evt-1' }],
                summary: 'found one',
              },
            },
          ],
        },
      }),
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:59:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'commit_calendar_change',
              toolCallId: 'call-commit',
              args: { decision: 'confirm' },
            },
          ],
          toolResults: [
            {
              toolName: 'commit_calendar_change',
              toolCallId: 'call-commit',
              result: { ok: true, status: 'updated' },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const cached = cache.get('search_calendar', {
      query: 'team sync',
      startDate: '2026-02-26',
      endDate: '2026-02-26',
    });

    expect(cached).toBeNull();
    const stats = cache.getStats();
    expect(stats.search_calendar.miss_invalidated).toBe(1);
  });

  test('respects per-call minStoredAtMs freshness cutoff', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const history: ConversationMessageDTO[] = [
      buildAssistantMessage({
        createdAt: new Date('2026-02-26T11:58:00.000Z'),
        metadata: {
          toolCalls: [
            {
              toolName: 'search_inbox_context',
              toolCallId: 'call-inbox',
              args: { mode: 'quick', intent: 'invoice status' },
            },
          ],
          toolResults: [
            {
              toolName: 'search_inbox_context',
              toolCallId: 'call-inbox',
              result: { matches: [{ threadId: 't-1' }] },
            },
          ],
        },
      }),
    ];

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: history });
    const minStoredAtMs = new Date('2026-02-26T11:59:00.000Z').getTime();
    const cached = cache.get(
      'search_inbox_context',
      { mode: 'quick', intent: 'invoice status' },
      { minStoredAtMs },
    );

    expect(cached).toBeNull();
    const stats = cache.getStats();
    expect(stats.search_inbox_context.miss_invalidated).toBe(1);
  });

  test('tracks set_skipped_non_cacheable for failed runtime writes', () => {
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'));

    const cache = createExecutiveToolResultReuseCache({ conversationHistory: [] });
    cache.set('search_inbox_context', { mode: 'deep', intent: 'budget report' }, {
      ok: false,
      error: 'tool_budget_exceeded',
    });

    const cached = cache.get('search_inbox_context', { mode: 'deep', intent: 'budget report' });
    expect(cached).toBeNull();

    const stats = cache.getStats();
    expect(stats.search_inbox_context.set_skipped_non_cacheable).toBe(1);
    expect(stats.search_inbox_context.miss_not_found).toBe(1);
  });
});
