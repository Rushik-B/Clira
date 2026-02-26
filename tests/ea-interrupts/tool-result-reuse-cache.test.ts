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
  });
});
