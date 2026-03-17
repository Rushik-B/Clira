import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createContentReferenceId } from '@/lib/services/content-ingestion/references';
import type { ContentReference } from '@/lib/services/content-ingestion/types';

const serviceMocks = vi.hoisted(() => ({
  extractContentFromBuffer: vi.fn(),
}));

vi.mock('@/lib/services/content-ingestion/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/content-ingestion/service')>(
    '@/lib/services/content-ingestion/service',
  );

  return {
    ...actual,
    extractContentFromBuffer: serviceMocks.extractContentFromBuffer,
  };
});

import {
  resetContentIngestionStateForTests,
} from '@/lib/services/content-ingestion';
import { readContentReference } from '@/lib/services/content-ingestion/referenceRuntime';
import { createStoredContentReference } from '@/lib/services/content-ingestion/referenceStore';

const originalFirecrawlApiKey = process.env.FIRECRAWL_API_KEY;

function createReference(): ContentReference {
  return createStoredContentReference({
    userId: 'user-1',
    buffer: Buffer.from('Quarterly targets'),
    displayName: 'brief.txt',
    mimeHint: 'text/plain',
    trustClass: 'user_provided',
    provenance: {
      sourceLabel: 'Web chat upload',
      sourceKind: 'web_chat_upload',
      channel: 'web',
      conversationId: 'conv-1',
      runId: 'run-1',
      messageId: null,
      attachmentId: 'upload-1',
      originUri: null,
    },
  });
}

function createThirdPartyReference(): ContentReference {
  const locator = 'https://example.com/holidays/diwali';

  return {
    sourceKind: 'third_party',
    locator,
    displayName: 'diwali',
    mimeHint: null,
    trustClass: 'third_party',
    requiresApproval: false,
    capability: 'link',
    contentRefId: createContentReferenceId({
      sourceKind: 'third_party',
      locator,
    }),
    provenance: {
      sourceLabel: 'Exa result',
      sourceKind: 'third_party',
      channel: 'mcp',
      conversationId: null,
      runId: null,
      messageId: null,
      attachmentId: null,
      originUri: locator,
    },
  };
}

describe('content reference runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetContentIngestionStateForTests();
    if (typeof originalFirecrawlApiKey === 'string') {
      process.env.FIRECRAWL_API_KEY = originalFirecrawlApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    serviceMocks.extractContentFromBuffer.mockResolvedValue({
      status: 'ok',
      mediaFamily: 'text',
      extractedText: 'Quarterly targets',
      images: [],
      structuredData: null,
      degradationNotes: [],
      attribution: {
        filename: 'brief.txt',
        mimeType: 'text/plain',
        sniffedMimeType: 'text/plain',
        sha256: 'sha-1',
        provenance: {
          sourceLabel: 'Web chat upload',
          sourceKind: 'web_chat_upload',
          channel: 'web',
          conversationId: 'conv-1',
          runId: 'run-1',
          messageId: null,
          attachmentId: 'upload-1',
          originUri: null,
        },
      },
      tokenCost: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      extractionDurationMs: 1,
      cacheKey: 'cache-1',
      cacheStatus: 'miss',
      handlerVersion: 'text-v1',
      budget: {
        scopeKey: 'run-1',
        maxExtractions: 5,
        attemptsUsed: 0,
        totalTokens: 0,
        totalDurationMs: 1,
      },
      metadata: {
        sizeBytes: 17,
        declaredMimeType: 'text/plain',
        pageCountEstimate: null,
        audioDurationSeconds: null,
      },
    });
  });

  afterEach(() => {
    if (typeof originalFirecrawlApiKey === 'string') {
      process.env.FIRECRAWL_API_KEY = originalFirecrawlApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
  });

  test('resolves stored content references through the shared extraction runtime', async () => {
    const reference = createReference();

    const result = await readContentReference({
      userId: 'user-1',
      reference,
      conversationId: 'conv-1',
      runId: 'run-1',
      deadlineMs: 2_000,
    });

    expect(serviceMocks.extractContentFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'brief.txt',
        mimeType: 'text/plain',
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
          mediaFamily: 'text',
          extractedText: 'Quarterly targets',
        }),
      ],
    });
  });

  test('rejects stored content references from another user', async () => {
    const reference = createReference();

    const result = await readContentReference({
      userId: 'user-2',
      reference,
      conversationId: 'conv-1',
      runId: 'run-1',
      deadlineMs: 2_000,
    });

    expect(result).toEqual({
      ok: false,
      error: 'content_reference_not_found',
      message: 'That uploaded content is no longer available. Please upload it again.',
      contentRef: expect.any(Object),
    });
    expect(serviceMocks.extractContentFromBuffer).not.toHaveBeenCalled();
  });

  test('resolves third-party URL references through Firecrawl and shared extraction', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: '# Diwali\n\nDiwali is on October 30, 2026.',
            metadata: {
              title: 'Diwali 2026',
            },
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const result = await readContentReference({
      userId: 'user-1',
      reference: createThirdPartyReference(),
      conversationId: 'conv-1',
      runId: 'run-1',
      deadlineMs: 2_000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fc-test-key',
        }),
      }),
    );
    expect(serviceMocks.extractContentFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'text/markdown',
        filename: 'diwali',
        trustClass: 'third_party',
        channelLabel: 'third_party',
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
          mediaFamily: 'text',
          extractedText: 'Quarterly targets',
        }),
      ],
    });
  });

  test('surfaces a degraded error when third-party reading is not configured', async () => {
    delete process.env.FIRECRAWL_API_KEY;

    const result = await readContentReference({
      userId: 'user-1',
      reference: createThirdPartyReference(),
      conversationId: 'conv-1',
      runId: 'run-1',
      deadlineMs: 2_000,
    });

    expect(result).toEqual({
      ok: false,
      error: 'third_party_reader_unavailable',
      message:
        'Third-party webpage reading is not configured right now. Please try again later.',
      contentRef: expect.any(Object),
    });
    expect(serviceMocks.extractContentFromBuffer).not.toHaveBeenCalled();
  });
});
