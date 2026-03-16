import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  McpConnectionRecord,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';

const {
  getMcpManifestByModelToolNameMock,
  executeMcpToolMock,
  pendingFindFirstMock,
  pendingCreateMock,
  pendingUpdateMock,
  pendingUpdateManyMock,
} = vi.hoisted(() => ({
  getMcpManifestByModelToolNameMock: vi.fn(),
  executeMcpToolMock: vi.fn(),
  pendingFindFirstMock: vi.fn(),
  pendingCreateMock: vi.fn(),
  pendingUpdateMock: vi.fn(),
  pendingUpdateManyMock: vi.fn(),
}));

vi.mock('@/lib/services/mcp/registry/service', () => ({
  getMcpManifestByModelToolName: getMcpManifestByModelToolNameMock,
}));

vi.mock('@/lib/services/mcp/runtime/executor', () => ({
  executeMcpTool: executeMcpToolMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pendingMcpAction: {
      findFirst: pendingFindFirstMock,
      create: pendingCreateMock,
      update: pendingUpdateMock,
      updateMany: pendingUpdateManyMock,
    },
  },
}));

import {
  cancelPendingMcpAction,
  commitPendingMcpAction,
  planMcpMutationAction,
} from '@/lib/services/mcp/runtime/mutationFlow';

function buildConnection(overrides?: Partial<McpConnectionRecord>): McpConnectionRecord {
  return {
    id: 'conn-1',
    userId: 'user-1',
    serverKey: 'calendar',
    displayName: 'Work Calendar',
    packDescription: null,
    disabledToolNames: [],
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
    lastSyncedAt: new Date('2026-03-14T18:00:00.000Z'),
    lastHealthCheckedAt: new Date('2026-03-14T18:00:00.000Z'),
    consecutiveFailures: 0,
    circuitOpenedAt: null,
    circuitOpenUntil: null,
    disabledAt: null,
    createdAt: new Date('2026-03-14T17:00:00.000Z'),
    updatedAt: new Date('2026-03-14T18:00:00.000Z'),
    ...overrides,
  };
}

function buildTool(overrides?: Partial<McpToolManifestRecord>): McpToolManifestRecord {
  return {
    id: 'tool-1',
    connectionId: 'conn-1',
    toolName: 'create_event',
    toolSlug: 'create_event',
    modelToolName: 'mcp__calendar__create_event',
    displayTitle: 'Create event',
    description: 'Create an event.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
      required: ['title'],
    },
    outputSchema: null,
    annotations: null,
    actionClass: 'write',
    latencyClass: 'standard',
    safeForAutoUse: false,
    syncDiagnostics: null,
    lastSyncedAt: new Date('2026-03-14T18:00:00.000Z'),
    createdAt: new Date('2026-03-14T17:00:00.000Z'),
    updatedAt: new Date('2026-03-14T18:00:00.000Z'),
    ...overrides,
  };
}

function buildPendingRow(overrides?: Record<string, unknown>) {
  return {
    id: 'pending-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    connectionId: 'conn-1',
    toolName: 'create_event',
    modelToolName: 'mcp__calendar__create_event',
    displayTitle: 'Create event',
    actionClass: 'WRITE',
    trustClass: 'USER_CONFIGURED',
    userRequest: 'Book the interview',
    args: { title: 'Interview' },
    previewText: 'Preview text',
    previewSummary: null,
    status: 'PENDING',
    idempotencyKey: 'idem-1',
    expiresAt: new Date('2027-03-15T06:00:00.000Z'),
    consumedAt: null,
    cancelledAt: null,
    resultSummary: null,
    createdAt: new Date('2026-03-14T18:00:00.000Z'),
    updatedAt: new Date('2026-03-14T18:00:00.000Z'),
    ...overrides,
  };
}

describe('MCP mutation flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('reuses an existing pending preview unless the caller explicitly forces a replacement', async () => {
    getMcpManifestByModelToolNameMock.mockResolvedValue({
      connection: buildConnection(),
      tool: buildTool(),
    });
    pendingFindFirstMock.mockResolvedValue(buildPendingRow());

    const result = await planMcpMutationAction({
      userId: 'user-1',
      conversationId: 'conv-1',
      modelToolName: 'mcp__calendar__create_event',
      args: { title: 'Interview' },
      userRequest: 'Book the interview',
    });

    expect(result).toMatchObject({
      ok: true,
      previewText: 'Preview text',
      pendingAction: {
        pendingId: 'pending-1',
      },
    });
    expect(pendingCreateMock).not.toHaveBeenCalled();
  });

  test('claims, commits, and replays a consumed mutation without re-executing it', async () => {
    const summarizedResult = {
      ok: true,
      toolName: 'create_event',
      modelToolName: 'mcp__calendar__create_event',
      displayName: 'Work Calendar',
      degraded: false,
      errorClass: null,
      freshness: {
        cacheTtlMs: 90_000,
        cachedAt: '2026-03-14T18:05:00.000Z',
        connectionLastSyncedAt: '2026-03-14T18:00:00.000Z',
      },
      userFacingDegradedReason: null,
      snippets: ['Event created for Interview.'],
      structuredSummary: {
        eventId: 'evt-123',
      },
      status: 'consumed',
      message: 'Create event completed via Work Calendar.',
    };

    pendingFindFirstMock
      .mockResolvedValueOnce(buildPendingRow())
      .mockResolvedValueOnce(
        buildPendingRow({
          status: 'CONSUMED',
          consumedAt: new Date('2026-03-14T18:05:00.000Z'),
          resultSummary: summarizedResult,
        }),
      );
    pendingUpdateManyMock.mockResolvedValue({ count: 1 });
    executeMcpToolMock.mockResolvedValue({
      ok: true,
      toolName: 'create_event',
      modelToolName: 'mcp__calendar__create_event',
      connectionId: 'conn-1',
      displayName: 'Work Calendar',
      content: [
        {
          type: 'text',
          text: 'Event created for Interview.',
        },
      ],
      structuredContent: {
        eventId: 'evt-123',
      },
      degraded: false,
      latencyMs: 12,
      cache: 'miss',
      freshness: summarizedResult.freshness,
    });

    const first = await commitPendingMcpAction({
      userId: 'user-1',
      conversationId: 'conv-1',
      requestId: 'run-1',
      deadlineMs: 5_000,
    });
    const replay = await commitPendingMcpAction({
      userId: 'user-1',
      conversationId: 'conv-1',
      requestId: 'run-2',
      deadlineMs: 5_000,
    });

    expect(first).toMatchObject({
      ok: true,
      status: 'consumed',
      message: 'Create event completed via Work Calendar.',
      snippets: ['Event created for Interview.'],
      structuredSummary: {
        eventId: 'evt-123',
      },
    });
    expect(pendingUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resultSummary: expect.objectContaining({
            snippets: ['Event created for Interview.'],
            structuredSummary: {
              eventId: 'evt-123',
            },
          }),
        }),
      }),
    );
    expect(executeMcpToolMock).toHaveBeenCalledTimes(1);
    expect(executeMcpToolMock.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: 'idem-1',
      mutationApproval: 'confirmed',
    });
    expect(replay).toMatchObject({
      ok: true,
      status: 'consumed',
      replayed: true,
      message: 'Create event completed via Work Calendar.',
      snippets: ['Event created for Interview.'],
      structuredSummary: {
        eventId: 'evt-123',
      },
    });
  });

  test('cancels a pending mutation without executing it', async () => {
    pendingFindFirstMock.mockResolvedValue(buildPendingRow());
    pendingUpdateMock.mockResolvedValue(undefined);

    const result = await cancelPendingMcpAction({
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'cancelled',
      message: 'Okay, I cancelled that pending external action.',
    });
    expect(executeMcpToolMock).not.toHaveBeenCalled();
  });
});
