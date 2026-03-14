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
} = vi.hoisted(() => ({
  loadMcpRegistrySnapshotMock: vi.fn(),
  isMcpEnabledMock: vi.fn(),
  isMcpChannelEnabledMock: vi.fn(),
}));

vi.mock('@/lib/services/mcp/registry/service', () => ({
  loadMcpRegistrySnapshot: loadMcpRegistrySnapshotMock,
}));

vi.mock('@/lib/services/mcp/config/featureFlags', () => ({
  isMcpEnabled: isMcpEnabledMock,
  isMcpChannelEnabled: isMcpChannelEnabledMock,
}));

import { resolveMcpToolExposure } from '@/lib/services/mcp/policy/service';

function buildConnection(overrides?: Partial<McpConnectionRecord>): McpConnectionRecord {
  return {
    id: 'conn-1',
    userId: 'user-1',
    serverKey: 'docs',
    displayName: 'Docs Workspace',
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
    capabilityId: 'docs_read',
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
              capabilityId: 'docs_read',
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
              toolName: 'update_doc',
              toolSlug: 'update_doc',
              modelToolName: 'mcp__writer__update_doc',
              displayTitle: 'Update doc',
              actionClass: 'write',
              safeForAutoUse: false,
              capabilityId: 'docs_read',
            }),
          ],
        },
      ],
    };
    loadMcpRegistrySnapshotMock.mockResolvedValue(snapshot);

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      channel: 'twilio',
      capabilityIntents: ['docs_read'],
    });

    expect(exposure.approvedTools.map((candidate) => candidate.tool.modelToolName)).toEqual([
      'mcp__docs__search_docs',
    ]);
    expect(exposure.degradedTools.map((candidate) => candidate.tool.modelToolName)).toEqual([
      'mcp__crm__search_crm',
      'mcp__writer__update_doc',
    ]);
    expect(exposure.degradedTools.map((candidate) => candidate.decision.reason)).toEqual([
      'connection_not_ready',
      'read_only_phase',
    ]);
    expect(exposure.promptSummary.capabilityLines).toEqual([
      'Docs Workspace: docs_read via Search docs',
    ]);
    expect(exposure.promptSummary.degradedLines).toEqual([
      'CRM Mirror: docs_read unavailable (auth expired)',
      'Writer: docs_read unavailable (read_only_phase)',
    ]);
  });

  test('returns an empty exposure when MCP is disabled', async () => {
    isMcpEnabledMock.mockReturnValue(false);

    const exposure = await resolveMcpToolExposure({
      userId: 'user-1',
      channel: 'twilio',
      capabilityIntents: ['docs_read'],
    });

    expect(loadMcpRegistrySnapshotMock).not.toHaveBeenCalled();
    expect(exposure.approvedTools).toEqual([]);
    expect(exposure.degradedTools).toEqual([]);
    expect(exposure.promptSummary).toEqual({
      capabilityLines: [],
      degradedLines: [],
    });
  });
});
