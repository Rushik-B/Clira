import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  createExecutiveToolResultReuseCache,
  type McpToolResultCacheStats,
} from '@/lib/ai/agents/executive-agent/toolResultReuseCache';
import type { ConversationMessageDTO } from '@/lib/ai/schemas/executiveAgentSchemas';
import { extractToolCallsSummary } from '@/lib/ai/agents/executiveToolCallSummary';

function buildAssistantMessage(params: {
  toolCalls?: unknown[];
  toolResults?: unknown[];
  content?: string;
  createdAt?: Date;
}): ConversationMessageDTO {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'ASSISTANT',
    direction: 'OUTBOUND',
    content: params.content ?? 'Here are the results.',
    createdAt: params.createdAt ?? new Date(),
    metadata: {
      toolCalls: params.toolCalls ?? [],
      toolResults: params.toolResults ?? [],
    },
  };
}

function buildMcpToolCall(toolName: string, args: unknown) {
  return {
    toolName,
    args,
    callId: `call-${Math.random().toString(36).slice(2, 8)}`,
  };
}

function buildMcpToolResult(toolName: string, result: unknown) {
  return {
    toolName,
    result,
  };
}

function mcpReadResult(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    toolName: 'search_docs',
    modelToolName: 'mcp__docs__search_docs',
    displayName: 'Docs Workspace',
    degraded: false,
    errorClass: null,
    freshness: {
      cacheTtlMs: 120_000,
      cachedAt: new Date().toISOString(),
      connectionLastSyncedAt: new Date().toISOString(),
    },
    userFacingDegradedReason: null,
    snippets: ['The deployment guide has three sections.'],
    structuredSummary: undefined,
    ...overrides,
  };
}

describe('MCP cross-turn cache', () => {
  describe('history extraction', () => {
    test('rebuilds MCP results from prior assistant message metadata', () => {
      const args = { query: 'deployment guide' };
      const result = mcpReadResult();

      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__docs__search_docs', args)],
            toolResults: [buildMcpToolResult('mcp__docs__search_docs', result)],
            createdAt: new Date(Date.now() - 60_000),
          }),
        ],
      });

      const cached = cache.getMcp('mcp__docs__search_docs', args);
      expect(cached).not.toBeNull();
      expect((cached as any).ok).toBe(true);
      expect((cached as any).displayName).toBe('Docs Workspace');
      expect((cached as any)._cache).toBeDefined();
      expect((cached as any)._cache.hit).toBe(true);
      expect((cached as any)._cache.source).toBe('history');
    });

    test('does not cache failed MCP results from history', () => {
      const args = { query: 'bad query' };
      const failedResult = mcpReadResult({ ok: false, degraded: true, errorClass: 'execution_failed' });

      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__docs__search_docs', args)],
            toolResults: [buildMcpToolResult('mcp__docs__search_docs', failedResult)],
            createdAt: new Date(Date.now() - 60_000),
          }),
        ],
      });

      const cached = cache.getMcp('mcp__docs__search_docs', args);
      expect(cached).toBeNull();
    });

    test('prefers newest result when same MCP tool called across turns', () => {
      const args = { query: 'deployment' };
      const oldResult = mcpReadResult({ snippets: ['Old result.'] });
      const newResult = mcpReadResult({ snippets: ['New result.'] });

      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__docs__search_docs', args)],
            toolResults: [buildMcpToolResult('mcp__docs__search_docs', oldResult)],
            createdAt: new Date(Date.now() - 120_000),
          }),
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__docs__search_docs', args)],
            toolResults: [buildMcpToolResult('mcp__docs__search_docs', newResult)],
            createdAt: new Date(Date.now() - 30_000),
          }),
        ],
      });

      const cached = cache.getMcp<Record<string, unknown>>('mcp__docs__search_docs', args);
      expect(cached).not.toBeNull();
      expect((cached as any).snippets).toEqual(['New result.']);
    });

    test('ignores non-MCP tools in MCP cache track', () => {
      const args = { query: 'test' };
      const result = { ok: true, count: 3, memories: [] };

      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('search_memory', args)],
            toolResults: [buildMcpToolResult('search_memory', result)],
            createdAt: new Date(Date.now() - 60_000),
          }),
        ],
      });

      const cached = cache.getMcp('search_memory', args);
      expect(cached).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    test('expires MCP results older than 5 minutes', () => {
      const args = { query: 'old data' };
      const result = mcpReadResult();

      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__docs__search_docs', args)],
            toolResults: [buildMcpToolResult('mcp__docs__search_docs', result)],
            createdAt: new Date(Date.now() - 6 * 60 * 1000),
          }),
        ],
      });

      const cached = cache.getMcp('mcp__docs__search_docs', args);
      expect(cached).toBeNull();

      const stats = cache.getMcpStats();
      expect(stats.miss_expired).toBe(1);
    });
  });

  describe('runtime set and get', () => {
    test('stores and retrieves MCP results within the same turn', () => {
      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [],
      });

      const args = { query: 'spec doc' };
      const result = mcpReadResult({ snippets: ['The spec covers API design.'] });

      cache.setMcp('mcp__docs__search_docs', args, result);

      const cached = cache.getMcp<Record<string, unknown>>('mcp__docs__search_docs', args);
      expect(cached).not.toBeNull();
      expect((cached as any).ok).toBe(true);
      expect((cached as any)._cache.source).toBe('runtime');
    });

    test('does not store non-cacheable results', () => {
      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [],
      });

      cache.setMcp('mcp__docs__search_docs', { query: 'bad' }, { ok: false, error: 'tool_budget_exceeded' });

      const cached = cache.getMcp('mcp__docs__search_docs', { query: 'bad' });
      expect(cached).toBeNull();

      const stats = cache.getMcpStats();
      expect(stats.set_skipped_non_cacheable).toBe(1);
    });
  });

  describe('mutation invalidation', () => {
    test('commit_mcp_action invalidates all cached MCP results', () => {
      const args = { query: 'deployment' };
      const result = mcpReadResult();

      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__docs__search_docs', args)],
            toolResults: [buildMcpToolResult('mcp__docs__search_docs', result)],
            createdAt: new Date(Date.now() - 60_000),
          }),
        ],
      });

      const beforeInvalidation = cache.getMcp('mcp__docs__search_docs', args);
      expect(beforeInvalidation).not.toBeNull();

      cache.noteMcpMutation(Date.now());

      const afterInvalidation = cache.getMcp('mcp__docs__search_docs', args);
      expect(afterInvalidation).toBeNull();

      const stats = cache.getMcpStats();
      expect(stats.miss_invalidated).toBe(1);
    });

    test('history-based commit_mcp_action invalidates older MCP results', () => {
      const readArgs = { query: 'items' };
      const readResult = mcpReadResult({ snippets: ['Before mutation.'] });

      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__crm__list_items', readArgs)],
            toolResults: [buildMcpToolResult('mcp__crm__list_items', readResult)],
            createdAt: new Date(Date.now() - 120_000),
          }),
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('commit_mcp_action', {})],
            toolResults: [buildMcpToolResult('commit_mcp_action', { ok: true, status: 'committed' })],
            createdAt: new Date(Date.now() - 60_000),
          }),
        ],
      });

      const cached = cache.getMcp('mcp__crm__list_items', readArgs);
      expect(cached).toBeNull();
    });
  });

  describe('arg normalization', () => {
    test('treats equivalent args with different key ordering as same cache key', () => {
      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [],
      });

      const result = mcpReadResult();
      cache.setMcp('mcp__docs__search', { query: 'test', limit: 10 }, result);

      const cached = cache.getMcp('mcp__docs__search', { limit: 10, query: 'test' });
      expect(cached).not.toBeNull();
    });

    test('trims string values for cache key matching', () => {
      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [],
      });

      const result = mcpReadResult();
      cache.setMcp('mcp__docs__search', { query: '  test  ' }, result);

      const cached = cache.getMcp('mcp__docs__search', { query: 'test' });
      expect(cached).not.toBeNull();
    });
  });

  describe('stats tracking', () => {
    test('tracks MCP cache stats correctly', () => {
      const cache = createExecutiveToolResultReuseCache({
        conversationHistory: [
          buildAssistantMessage({
            toolCalls: [buildMcpToolCall('mcp__docs__search', { query: 'cached' })],
            toolResults: [buildMcpToolResult('mcp__docs__search', mcpReadResult())],
            createdAt: new Date(Date.now() - 30_000),
          }),
        ],
      });

      cache.getMcp('mcp__docs__search', { query: 'cached' });
      cache.getMcp('mcp__docs__search', { query: 'miss' });
      cache.setMcp('mcp__docs__search', { query: 'new' }, mcpReadResult());

      const stats = cache.getMcpStats();
      expect(stats.history_hit).toBe(1);
      expect(stats.miss_not_found).toBe(1);
      expect(stats.set_ok).toBe(1);
    });
  });
});

describe('MCP tool call summary', () => {
  test('summarizes successful MCP read result', () => {
    const metadata = {
      toolCalls: [{ toolName: 'mcp__docs__search_docs', args: { query: 'deploy' } }],
      toolResults: [
        {
          toolName: 'mcp__docs__search_docs',
          result: mcpReadResult({ snippets: ['Deploy guide section 1.'] }),
        },
      ],
    };

    const summary = extractToolCallsSummary(metadata);
    expect(summary).toContain('mcp__docs__search_docs');
    expect(summary).toContain('ok');
    expect(summary).toContain('Docs Workspace');
    expect(summary).toContain('snippet');
  });

  test('summarizes degraded MCP result with error class', () => {
    const metadata = {
      toolCalls: [{ toolName: 'mcp__crm__lookup', args: {} }],
      toolResults: [
        {
          toolName: 'mcp__crm__lookup',
          result: mcpReadResult({
            ok: false,
            degraded: true,
            errorClass: 'execution_failed',
            snippets: [],
          }),
        },
      ],
    };

    const summary = extractToolCallsSummary(metadata);
    expect(summary).toContain('mcp__crm__lookup');
    expect(summary).toContain('failed');
    expect(summary).toContain('execution_failed');
  });

  test('does not produce MCP summary for non-MCP tools', () => {
    const metadata = {
      toolCalls: [{ toolName: 'unknown_tool', args: {} }],
      toolResults: [
        {
          toolName: 'unknown_tool',
          result: { some: 'data' },
        },
      ],
    };

    const summary = extractToolCallsSummary(metadata);
    expect(summary).toBe('unknown_tool');
  });
});
