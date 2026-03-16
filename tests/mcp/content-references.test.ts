import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createContentReferenceId,
  type ContentReference,
} from '@/lib/services/content-ingestion';
import type {
  McpConnectionRecord,
  McpSecretConfig,
} from '@/lib/services/mcp/types';

const {
  getMcpConnectionWithSecretsMock,
  createMcpTransportClientMock,
  extractContentFromBufferMock,
} = vi.hoisted(() => ({
  getMcpConnectionWithSecretsMock: vi.fn(),
  createMcpTransportClientMock: vi.fn(),
  extractContentFromBufferMock: vi.fn(),
}));

vi.mock('@/lib/services/mcp/connections/service', () => ({
  getMcpConnectionWithSecrets: getMcpConnectionWithSecretsMock,
}));

vi.mock('@/lib/services/mcp/runtime/client', () => ({
  createMcpTransportClient: createMcpTransportClientMock,
}));

vi.mock('@/lib/services/content-ingestion', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/content-ingestion')>(
    '@/lib/services/content-ingestion',
  );

  return {
    ...actual,
    extractContentFromBuffer: extractContentFromBufferMock,
  };
});

import { readMcpContentReference } from '@/lib/services/mcp/runtime/contentReferences';

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
    lastSyncedAt: new Date('2026-03-15T01:00:00.000Z'),
    lastHealthCheckedAt: new Date('2026-03-15T01:00:00.000Z'),
    consecutiveFailures: 0,
    circuitOpenedAt: null,
    circuitOpenUntil: null,
    disabledAt: null,
    createdAt: new Date('2026-03-15T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T01:00:00.000Z'),
    ...overrides,
  };
}

function buildReference(): ContentReference {
  const locator = JSON.stringify({
    connectionId: 'conn-1',
    uri: 'docs://guide.pdf',
    mimeType: 'application/pdf',
    displayName: 'guide.pdf',
  });

  return {
    sourceKind: 'mcp_resource_link',
    locator,
    displayName: 'guide.pdf',
    mimeHint: 'application/pdf',
    trustClass: 'untrusted_external',
    requiresApproval: false,
    capability: 'document',
    contentRefId: createContentReferenceId({
      sourceKind: 'mcp_resource_link',
      locator,
    }),
    provenance: {
      sourceLabel: 'Docs Workspace',
      sourceKind: 'mcp_resource_link',
      channel: 'mcp',
      conversationId: null,
      runId: null,
      messageId: null,
      attachmentId: null,
      originUri: 'docs://guide.pdf',
    },
  };
}

describe('MCP content references', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('reads an MCP resource reference and routes it through shared content extraction', async () => {
    const connection = buildConnection();
    const closeMock = vi.fn().mockResolvedValue(undefined);

    getMcpConnectionWithSecretsMock.mockResolvedValue({
      connection,
      secrets: { authMode: 'none' } satisfies McpSecretConfig,
    });
    createMcpTransportClientMock.mockResolvedValue({
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            uri: 'docs://guide.pdf',
            blob: Buffer.from('%PDF-1.4').toString('base64'),
            mimeType: 'application/pdf',
          },
        ],
      }),
      close: closeMock,
    });
    extractContentFromBufferMock.mockResolvedValue({
      status: 'ok',
      mediaFamily: 'pdf',
      extractedText: 'Deployment checklist.',
      images: [],
      structuredData: null,
      degradationNotes: [],
      attribution: {
        filename: 'guide.pdf',
        mimeType: 'application/pdf',
        sniffedMimeType: 'application/pdf',
        sha256: 'sha-1',
        provenance: {
          sourceLabel: 'Docs Workspace',
          sourceKind: 'mcp_resource_link',
          channel: 'mcp',
          conversationId: null,
          runId: null,
          messageId: null,
          attachmentId: null,
          originUri: 'docs://guide.pdf',
        },
      },
      tokenCost: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      },
      extractionDurationMs: 9,
      cacheKey: 'cache',
      cacheStatus: 'miss',
      handlerVersion: 'pdf-v1',
      budget: {
        scopeKey: 'run-1',
        maxExtractions: 5,
        attemptsUsed: 1,
        totalTokens: 3,
        totalDurationMs: 9,
      },
      metadata: {
        sizeBytes: 8,
        declaredMimeType: 'application/pdf',
        pageCountEstimate: 1,
        audioDurationSeconds: null,
      },
    });

    const result = await readMcpContentReference({
      userId: 'user-1',
      reference: buildReference(),
      conversationId: 'conv-1',
      runId: 'run-1',
      deadlineMs: 2_000,
    });

    expect(getMcpConnectionWithSecretsMock).toHaveBeenCalledWith({
      userId: 'user-1',
      connectionId: 'conn-1',
    });
    expect(extractContentFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'application/pdf',
        filename: 'guide.pdf',
        channelLabel: 'mcp',
        scope: {
          conversationId: 'conv-1',
          runId: 'run-1',
        },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      resultCount: 1,
      results: [
        expect.objectContaining({
          status: 'ok',
          mediaFamily: 'pdf',
          extractedText: 'Deployment checklist.',
        }),
      ],
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  test('rejects malformed content references before opening an MCP client', async () => {
    const reference = buildReference();

    const result = await readMcpContentReference({
      userId: 'user-1',
      reference: {
        ...reference,
        contentRefId: 'bad-ref',
      },
      conversationId: 'conv-1',
      runId: 'run-1',
      deadlineMs: 2_000,
    });

    expect(result).toEqual({
      ok: false,
      error: 'invalid_content_reference',
      message: 'That content reference is malformed. Please re-run the MCP tool and try again.',
    });
    expect(getMcpConnectionWithSecretsMock).not.toHaveBeenCalled();
    expect(createMcpTransportClientMock).not.toHaveBeenCalled();
  });
});
