import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  findManyMock,
  listMcpConnectionsForUserMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  listMcpConnectionsForUserMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mcpToolManifest: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/services/mcp/connections/service', () => ({
  getMcpConnectionWithSecrets: vi.fn(),
  listMcpConnectionsForUser: listMcpConnectionsForUserMock,
  markMcpConnectionDegraded: vi.fn(),
  markMcpConnectionSyncSuccess: vi.fn(),
}));

vi.mock('@/lib/services/mcp/runtime/client', () => ({
  createMcpTransportClient: vi.fn(),
}));

vi.mock('@/lib/services/mcp/config/featureFlags', () => ({
  getMcpHealthCacheTtlMs: () => 60_000,
  getMcpManifestCacheTtlMs: () => 60_000,
  getMcpSyncTimeoutMs: () => 30_000,
}));

import { invalidateRegistrySnapshot } from '@/lib/services/mcp/registry/cache';
import { loadMcpRegistrySnapshot } from '@/lib/services/mcp/registry/service';

describe('MCP registry service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRegistrySnapshot('user-1');
  });

  test('reclassifies stale stored list tools as read when loading the snapshot', async () => {
    listMcpConnectionsForUserMock.mockResolvedValue([
      {
        id: 'conn-1',
        userId: 'user-1',
        serverKey: 'canvas',
        displayName: 'Canvas LMS',
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
      },
    ]);
    findManyMock.mockResolvedValue([
      {
        id: 'tool-1',
        connectionId: 'conn-1',
        toolName: 'list_course_files',
        toolSlug: 'list_course_files',
        modelToolName: 'mcp__canvas__list_course_files',
        displayTitle: 'List course files',
        description:
          'List course files with add permissions, set membership, and last updated timestamps.',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: null,
        annotations: null,
        actionClass: 'WRITE',
        latencyClass: 'FAST',
        safeForAutoUse: false,
        syncDiagnostics: null,
        lastSyncedAt: new Date('2026-03-14T18:00:00.000Z'),
        createdAt: new Date('2026-03-14T17:00:00.000Z'),
        updatedAt: new Date('2026-03-14T18:00:00.000Z'),
      },
    ]);

    const snapshot = await loadMcpRegistrySnapshot('user-1');
    const tool = snapshot.connections[0]?.tools[0];

    expect(tool).toMatchObject({
      modelToolName: 'mcp__canvas__list_course_files',
      actionClass: 'read',
      safeForAutoUse: true,
    });
  });
});
