import { beforeEach, describe, expect, test, vi } from 'vitest';
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

describe('content reference runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContentIngestionStateForTests();
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
});
