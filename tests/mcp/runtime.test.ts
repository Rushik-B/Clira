import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  McpConnectionRecord,
  McpExecutionResult,
  McpSecretConfig,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';

const {
  getMcpManifestByModelToolNameMock,
  getCachedMcpResultMock,
  setCachedMcpResultMock,
  getMcpConnectionWithSecretsMock,
  createMcpTransportClientMock,
  createAuditMock,
} = vi.hoisted(() => ({
  getMcpManifestByModelToolNameMock: vi.fn(),
  getCachedMcpResultMock: vi.fn(),
  setCachedMcpResultMock: vi.fn(),
  getMcpConnectionWithSecretsMock: vi.fn(),
  createMcpTransportClientMock: vi.fn(),
  createAuditMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/mcp/registry/service', () => ({
  getMcpManifestByModelToolName: getMcpManifestByModelToolNameMock,
}));

vi.mock('@/lib/services/mcp/cache/resultCache', () => ({
  getCachedMcpResult: getCachedMcpResultMock,
  setCachedMcpResult: setCachedMcpResultMock,
}));

vi.mock('@/lib/services/mcp/connections/service', () => ({
  getMcpConnectionWithSecrets: getMcpConnectionWithSecretsMock,
}));

vi.mock('@/lib/services/mcp/runtime/client', () => ({
  createMcpTransportClient: createMcpTransportClientMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mcpExecutionAudit: {
      create: createAuditMock,
    },
  },
}));

import { executeMcpTool } from '@/lib/services/mcp/runtime/executor';

function buildConnection(overrides?: Partial<McpConnectionRecord>): McpConnectionRecord {
  return {
    id: 'conn-1',
    userId: 'user-1',
    serverKey: 'docs',
    displayName: 'Docs Workspace',
    packDescription: null,
    transport: {
      type: 'streamable_http',
      endpoint: 'https://mcp.example.com',
      headers: {},
    },
    authMode: 'none',
    status: 'synced',
    trustClass: 'user_configured',
    degradedReason: null,
    syncDiagnostics: null,
    healthDiagnostics: null,
    lastSyncedAt: new Date('2026-03-02T18:00:00.000Z'),
    lastHealthCheckedAt: new Date('2026-03-02T18:00:00.000Z'),
    consecutiveFailures: 0,
    circuitOpenedAt: null,
    circuitOpenUntil: null,
    disabledAt: null,
    createdAt: new Date('2026-03-02T17:00:00.000Z'),
    updatedAt: new Date('2026-03-02T18:00:00.000Z'),
    ...overrides,
  };
}

function buildTool(overrides?: Partial<McpToolManifestRecord>): McpToolManifestRecord {
  return {
    id: 'tool-1',
    connectionId: 'conn-1',
    toolName: 'search_docs',
    toolSlug: 'search_docs',
    modelToolName: 'mcp__docs__search_docs',
    displayTitle: 'Search docs',
    description: 'Search docs.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: null,
    annotations: null,
    actionClass: 'read',
    latencyClass: 'fast',
    safeForAutoUse: true,
    syncDiagnostics: null,
    lastSyncedAt: new Date('2026-03-02T18:00:00.000Z'),
    createdAt: new Date('2026-03-02T17:00:00.000Z'),
    updatedAt: new Date('2026-03-02T18:00:00.000Z'),
    ...overrides,
  };
}

describe('MCP runtime executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sanitizes and caches successful read-only results', async () => {
    const connection = buildConnection();
    const tool = buildTool();
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const callToolMock = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'Hello\u0007 world',
        },
      ],
      structuredContent: {
        summary: 'Alpha\u0001Beta',
      },
      isError: false,
    });

    getMcpManifestByModelToolNameMock.mockResolvedValue({ connection, tool });
    getCachedMcpResultMock.mockReturnValue(null);
    getMcpConnectionWithSecretsMock.mockResolvedValue({
      connection,
      secrets: { authMode: 'none' } satisfies McpSecretConfig,
    });
    createMcpTransportClientMock.mockResolvedValue({
      listTools: vi.fn(),
      callTool: callToolMock,
      close: closeMock,
    });

    const result = await executeMcpTool({
      userId: 'user-1',
      connectionId: connection.id,
      toolName: tool.modelToolName,
      args: { query: 'handoff' },
      deadlineMs: 2_000,
      requestId: 'run-1',
      conversationId: 'conv-1',
    });

    expect(result.ok).toBe(true);
    expect(result.cache).toBe('miss');
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Hello world',
      },
    ]);
    expect(result.structuredContent).toEqual({
      summary: 'AlphaBeta',
    });
    expect(setCachedMcpResultMock).toHaveBeenCalledTimes(1);
    expect(setCachedMcpResultMock.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user-1',
      connectionId: connection.id,
      modelToolName: tool.modelToolName,
      freshnessKey: connection.lastSyncedAt?.toISOString(),
    });
    expect(createAuditMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  test('returns cached results without opening a transport client', async () => {
    const connection = buildConnection();
    const tool = buildTool();
    const cachedResult: McpExecutionResult = {
      ok: true,
      toolName: tool.toolName,
      modelToolName: tool.modelToolName,
      connectionId: connection.id,
      displayName: connection.displayName,
      content: [],
      degraded: false,
      latencyMs: 12,
      cache: 'hit',
      freshness: {
        cacheTtlMs: 90_000,
        cachedAt: '2026-03-02T18:00:00.000Z',
        connectionLastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      },
    };

    getMcpManifestByModelToolNameMock.mockResolvedValue({ connection, tool });
    getCachedMcpResultMock.mockReturnValue(cachedResult);

    const result = await executeMcpTool({
      userId: 'user-1',
      connectionId: connection.id,
      toolName: tool.modelToolName,
      args: { query: 'handoff' },
      deadlineMs: 2_000,
      requestId: 'run-1',
    });

    expect(result.cache).toBe('hit');
    expect(createMcpTransportClientMock).not.toHaveBeenCalled();
    expect(getMcpConnectionWithSecretsMock).not.toHaveBeenCalled();
    expect(createAuditMock).toHaveBeenCalledTimes(1);
  });

  test('blocks direct mutation execution without explicit confirmation', async () => {
    const connection = buildConnection({
      id: 'conn-2',
      serverKey: 'calendar',
      displayName: 'Work Calendar',
    });
    const tool = buildTool({
      id: 'tool-2',
      connectionId: connection.id,
      toolName: 'create_event',
      toolSlug: 'create_event',
      modelToolName: 'mcp__calendar__create_event',
      displayTitle: 'Create event',
      actionClass: 'write',
      safeForAutoUse: false,
    });

    getMcpManifestByModelToolNameMock.mockResolvedValue({ connection, tool });

    const result = await executeMcpTool({
      userId: 'user-1',
      connectionId: connection.id,
      toolName: tool.modelToolName,
      args: { title: 'Interview' },
      deadlineMs: 2_000,
      requestId: 'run-2',
    });

    expect(result.ok).toBe(false);
    expect(result.errorClass).toBe('confirmation_required');
    expect(createMcpTransportClientMock).not.toHaveBeenCalled();
    expect(createAuditMock).toHaveBeenCalledTimes(1);
  });

  test('executes confirmed mutations without caching and preserves idempotency audit state', async () => {
    const connection = buildConnection({
      id: 'conn-2',
      serverKey: 'calendar',
      displayName: 'Work Calendar',
    });
    const tool = buildTool({
      id: 'tool-2',
      connectionId: connection.id,
      toolName: 'create_event',
      toolSlug: 'create_event',
      modelToolName: 'mcp__calendar__create_event',
      displayTitle: 'Create event',
      actionClass: 'write',
      safeForAutoUse: false,
    });
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const callToolMock = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'created' }],
      structuredContent: { id: 'evt_1' },
      isError: false,
    });

    getMcpManifestByModelToolNameMock.mockResolvedValue({ connection, tool });
    getCachedMcpResultMock.mockReturnValue(null);
    getMcpConnectionWithSecretsMock.mockResolvedValue({
      connection,
      secrets: { authMode: 'none' } satisfies McpSecretConfig,
    });
    createMcpTransportClientMock.mockResolvedValue({
      listTools: vi.fn(),
      callTool: callToolMock,
      close: closeMock,
    });

    const result = await executeMcpTool({
      userId: 'user-1',
      connectionId: connection.id,
      toolName: tool.modelToolName,
      args: { title: 'Interview' },
      deadlineMs: 2_000,
      requestId: 'run-3',
      idempotencyKey: 'idem-123',
      mutationApproval: 'confirmed',
    });

    expect(result.ok).toBe(true);
    expect(setCachedMcpResultMock).not.toHaveBeenCalled();
    expect(createAuditMock).toHaveBeenCalledTimes(1);
    expect(createAuditMock.mock.calls[0]?.[0]).toMatchObject({
      data: {
        idempotencyKey: 'idem-123',
        actionClass: 'WRITE',
        cacheHit: false,
      },
    });
  });
});
