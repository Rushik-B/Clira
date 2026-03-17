import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  McpConnectionRecord,
  McpRegistrySnapshot,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';

const {
  loadMcpRegistrySnapshotMock,
  isMcpEnabledMock,
  isMcpChannelEnabledMock,
  getLatestPendingMcpActionMock,
} = vi.hoisted(() => ({
  loadMcpRegistrySnapshotMock: vi.fn(),
  isMcpEnabledMock: vi.fn(),
  isMcpChannelEnabledMock: vi.fn(),
  getLatestPendingMcpActionMock: vi.fn(),
}));

vi.mock('@/lib/services/mcp/registry/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/mcp/registry/service')>();
  return {
    ...actual,
    loadMcpRegistrySnapshot: loadMcpRegistrySnapshotMock,
  };
});

vi.mock('@/lib/services/mcp/config/featureFlags', () => ({
  isMcpEnabled: isMcpEnabledMock,
  isMcpChannelEnabled: isMcpChannelEnabledMock,
}));

vi.mock('@/lib/services/mcp/runtime/mutationFlow', () => ({
  getLatestPendingMcpAction: getLatestPendingMcpActionMock,
}));

import {
  listSelectableMcpServerPacks,
  resolveMcpToolExposure,
} from '@/lib/services/mcp/policy/service';

function buildConnection(overrides?: Partial<McpConnectionRecord>): McpConnectionRecord {
  return {
    id: 'conn-1',
    userId: 'user-1',
    serverKey: 'docs',
    displayName: 'Docs Workspace',
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

describe('MCP policy service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMcpEnabledMock.mockReturnValue(true);
    isMcpChannelEnabledMock.mockReturnValue(true);
    getLatestPendingMcpActionMock.mockResolvedValue(null);
  });

  test('approves only relevant read-only tools and surfaces degraded matches', async () => {
    const snapshot: McpRegistrySnapshot = {
      userId: 'user-1',
      fetchedAt: new Date('2026-03-02T18:05:00.000Z'),
      connections: [
        {
          connection: buildConnection(),
          tools: [buildTool()],
        },
        {
          connection: buildConnection({
            id: 'conn-2',
            serverKey: 'crm',
            displayName: 'CRM Mirror',
            status: 'degraded',
            degradedReason: 'auth expired',
          }),
          tools: [
            buildTool({
              id: 'tool-2',
              connectionId: 'conn-2',
              toolName: 'search_crm',
              toolSlug: 'search_crm',
              modelToolName: 'mcp__crm__search_crm',
              displayTitle: 'Search CRM',
            }),
          ],
        },
        {
          connection: buildConnection({
            id: 'conn-3',
            serverKey: 'writer',
            displayName: 'Writer',
          }),
          tools: [
            buildTool({
              id: 'tool-3',
              connectionId: 'conn-3',
              toolName: 'lookup_docs',
              toolSlug: 'lookup_docs',
              modelToolName: 'mcp__writer__lookup_docs',
              displayTitle: 'Lookup docs',
            }),
          ],
        },
      ],
    };
    loadMcpRegistrySnapshotMock.mockResolvedValue(snapshot);

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      conversationId: 'conv-1',
      channel: 'twilio',
      selectedConnectionIds: ['conn-1', 'conn-2', 'conn-3'],
    });

    expect(exposure.approvedTools.map((candidate) => candidate.tool.modelToolName)).toEqual([
      'mcp__writer__lookup_docs',
      'mcp__docs__search_docs',
    ]);
    expect(exposure.mutationTools).toEqual([]);
    expect(exposure.degradedTools.map((candidate) => candidate.tool.modelToolName)).toEqual([
      'mcp__crm__search_crm',
    ]);
    expect(exposure.degradedTools.map((candidate) => candidate.decision.reason)).toEqual([
      'connection_not_ready',
    ]);
    expect(exposure.promptSummary.toolSummaryLines).toEqual([
      'Writer: Lookup docs (read)',
      'Docs Workspace: Search docs (read)',
    ]);
    expect(exposure.promptSummary.degradedLines).toEqual([
      'CRM Mirror: Search CRM unavailable (auth expired)',
    ]);
  });

  test('approves correctly classified read tools even when safeForAutoUse is false', async () => {
    const snapshot: McpRegistrySnapshot = {
      userId: 'user-1',
      fetchedAt: new Date('2026-03-02T18:05:00.000Z'),
      connections: [
        {
          connection: buildConnection({
            id: 'conn-lookup',
            serverKey: 'writer',
            displayName: 'Writer',
          }),
          tools: [
            buildTool({
              id: 'tool-lookup',
              connectionId: 'conn-lookup',
              toolName: 'lookup_docs',
              toolSlug: 'lookup_docs',
              modelToolName: 'mcp__writer__lookup_docs',
              displayTitle: 'Lookup docs',
              safeForAutoUse: false,
            }),
          ],
        },
      ],
    };
    loadMcpRegistrySnapshotMock.mockResolvedValue(snapshot);

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      conversationId: 'conv-1',
      channel: 'twilio',
      selectedConnectionIds: ['conn-lookup'],
    });

    expect(exposure.approvedTools.map((candidate) => candidate.tool.modelToolName)).toEqual([
      'mcp__writer__lookup_docs',
    ]);
    expect(exposure.approvedTools[0]?.decision.reason).toBe('approved');
    expect(exposure.degradedTools).toEqual([]);
    expect(exposure.promptSummary.toolSummaryLines).toEqual([
      'Writer: Lookup docs (read)',
    ]);
  });

  test('surfaces calendar mutation tools as preview-only candidates and carries pending action state', async () => {
    const snapshot: McpRegistrySnapshot = {
      userId: 'user-1',
      fetchedAt: new Date('2026-03-02T18:05:00.000Z'),
      connections: [
        {
          connection: buildConnection({
            id: 'conn-cal',
            serverKey: 'calendar',
            displayName: 'Work Calendar',
          }),
          tools: [
            buildTool({
              id: 'tool-cal-write',
              connectionId: 'conn-cal',
              toolName: 'create_event',
              toolSlug: 'create_event',
              modelToolName: 'mcp__calendar__create_event',
              displayTitle: 'Create event',
              actionClass: 'write',
              safeForAutoUse: false,
            }),
          ],
        },
      ],
    };
    loadMcpRegistrySnapshotMock.mockResolvedValue(snapshot);
    getLatestPendingMcpActionMock.mockResolvedValue({
      id: 'pending-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      connectionId: 'conn-cal',
      toolName: 'create_event',
      modelToolName: 'mcp__calendar__create_event',
      displayTitle: 'Create event',
      actionClass: 'write',
      trustClass: 'user_configured',
      userRequest: 'Book time',
      args: { title: 'Interview' },
      previewText: 'Preview',
      previewSummary: null,
      status: 'pending',
      idempotencyKey: 'idem-1',
      expiresAt: new Date('2026-03-02T19:00:00.000Z'),
      consumedAt: null,
      cancelledAt: null,
      resultSummary: null,
      createdAt: new Date('2026-03-02T18:00:00.000Z'),
      updatedAt: new Date('2026-03-02T18:00:00.000Z'),
    });

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      conversationId: 'conv-1',
      channel: 'twilio',
      selectedConnectionIds: ['conn-cal'],
    });

    expect(exposure.approvedTools).toEqual([]);
    expect(exposure.mutationTools.map((candidate) => candidate.tool.modelToolName)).toEqual([
      'mcp__calendar__create_event',
    ]);
    expect(exposure.mutationTools[0]?.decision.reason).toBe('preview_required');
    expect(exposure.pendingAction?.id).toBe('pending-1');
    expect(exposure.promptSummary.toolSummaryLines).toEqual([
      'Work Calendar: Create event (write, preview required)',
    ]);
  });

  test('blocks third-party MCP mutations even when the capability intent matches', async () => {
    const snapshot: McpRegistrySnapshot = {
      userId: 'user-1',
      fetchedAt: new Date('2026-03-02T18:05:00.000Z'),
      connections: [
        {
          connection: buildConnection({
            id: 'conn-third',
            serverKey: 'calendar',
            displayName: 'Vendor Calendar',
            trustClass: 'third_party',
          }),
          tools: [
            buildTool({
              id: 'tool-third',
              connectionId: 'conn-third',
              toolName: 'create_event',
              toolSlug: 'create_event',
              modelToolName: 'mcp__calendar__create_event',
              displayTitle: 'Create event',
              actionClass: 'write',
              safeForAutoUse: false,
            }),
          ],
        },
      ],
    };
    loadMcpRegistrySnapshotMock.mockResolvedValue(snapshot);

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      conversationId: 'conv-1',
      channel: 'twilio',
      selectedConnectionIds: ['conn-third'],
    });

    expect(exposure.mutationTools).toEqual([]);
    expect(exposure.degradedTools[0]?.decision.reason).toBe('third_party_mutation_blocked');
    expect(exposure.promptSummary.degradedLines).toEqual([
      'Vendor Calendar: Create event unavailable (third_party_mutation_blocked)',
    ]);
  });

  test('surfaces disabled MCP tools as unavailable and never approves them', async () => {
    const snapshot: McpRegistrySnapshot = {
      userId: 'user-1',
      fetchedAt: new Date('2026-03-02T18:05:00.000Z'),
      connections: [
        {
          connection: buildConnection({
            id: 'conn-disabled-tool',
            serverKey: 'docs',
            displayName: 'Docs Workspace',
            disabledToolNames: ['search_docs'],
          }),
          tools: [
            buildTool({
              id: 'tool-disabled',
              connectionId: 'conn-disabled-tool',
              toolName: 'search_docs',
              toolSlug: 'search_docs',
              modelToolName: 'mcp__docs__search_docs',
              displayTitle: 'Search docs',
            }),
          ],
        },
      ],
    };
    loadMcpRegistrySnapshotMock.mockResolvedValue(snapshot);

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      conversationId: 'conv-1',
      channel: 'twilio',
      selectedConnectionIds: ['conn-disabled-tool'],
    });

    expect(exposure.approvedTools).toEqual([]);
    expect(exposure.mutationTools).toEqual([]);
    expect(exposure.degradedTools.map((candidate) => candidate.decision.reason)).toEqual([
      'tool_disabled',
    ]);
    expect(exposure.promptSummary.degradedLines).toEqual([
      'Docs Workspace: Search docs unavailable (tool_disabled)',
    ]);
  });

  test('returns an empty exposure when MCP is disabled', async () => {
    isMcpEnabledMock.mockReturnValue(false);

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      conversationId: 'conv-1',
      channel: 'twilio',
      selectedConnectionIds: ['conn-1'],
    });

    expect(loadMcpRegistrySnapshotMock).not.toHaveBeenCalled();
    expect(exposure.approvedTools).toEqual([]);
    expect(exposure.mutationTools).toEqual([]);
    expect(exposure.degradedTools).toEqual([]);
    expect(exposure.pendingAction).toBeNull();
    expect(exposure.promptSummary).toEqual({
      toolSummaryLines: [],
      degradedLines: [],
    });
  });

  test('lists only selector-eligible MCP server packs and rebuilds descriptions from eligible tools', async () => {
    const snapshot: McpRegistrySnapshot = {
      userId: 'user-1',
      fetchedAt: new Date('2026-03-02T18:05:00.000Z'),
      connections: [
        {
          connection: buildConnection({
            id: 'conn-mixed',
            serverKey: 'docs',
            displayName: 'Docs Workspace',
            disabledToolNames: ['write_doc'],
          }),
          tools: [
            buildTool({
              id: 'tool-search',
              connectionId: 'conn-mixed',
              toolName: 'search_docs',
              toolSlug: 'search_docs',
              modelToolName: 'mcp__docs__search_docs',
              displayTitle: 'Search docs',
              actionClass: 'read',
            }),
            buildTool({
              id: 'tool-write',
              connectionId: 'conn-mixed',
              toolName: 'write_doc',
              toolSlug: 'write_doc',
              modelToolName: 'mcp__docs__write_doc',
              displayTitle: 'Write doc',
              actionClass: 'write',
            }),
          ],
        },
        {
          connection: buildConnection({
            id: 'conn-disabled-only',
            serverKey: 'empty',
            displayName: 'Empty Server',
            disabledToolNames: ['search_docs'],
          }),
          tools: [
            buildTool({
              id: 'tool-empty',
              connectionId: 'conn-disabled-only',
              toolName: 'search_docs',
              toolSlug: 'search_docs',
              modelToolName: 'mcp__empty__search_docs',
              displayTitle: 'Search docs',
            }),
          ],
        },
        {
          connection: buildConnection({
            id: 'conn-third-party',
            serverKey: 'vendor',
            displayName: 'Vendor Server',
            trustClass: 'third_party',
          }),
          tools: [
            buildTool({
              id: 'tool-vendor-write',
              connectionId: 'conn-third-party',
              toolName: 'create_record',
              toolSlug: 'create_record',
              modelToolName: 'mcp__vendor__create_record',
              displayTitle: 'Create record',
              actionClass: 'write',
            }),
          ],
        },
        {
          connection: buildConnection({
            id: 'conn-circuit-open',
            serverKey: 'offline',
            displayName: 'Offline Server',
            circuitOpenUntil: new Date(Date.now() + 60_000),
          }),
          tools: [
            buildTool({
              id: 'tool-offline',
              connectionId: 'conn-circuit-open',
              toolName: 'search_docs',
              toolSlug: 'search_docs',
              modelToolName: 'mcp__offline__search_docs',
              displayTitle: 'Search docs',
            }),
          ],
        },
      ],
    };
    loadMcpRegistrySnapshotMock.mockResolvedValue(snapshot);

    const packs = await listSelectableMcpServerPacks({
      userId: 'user-1',
      channel: 'twilio',
    });

    expect(packs).toEqual([
      {
        connectionId: 'conn-mixed',
        serverKey: 'docs',
        displayName: 'Docs Workspace',
        packDescription: 'Docs Workspace: 1 read tools (Search docs)',
      },
    ]);
  });
});
