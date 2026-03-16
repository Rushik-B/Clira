import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockConversationManager = {
  addMessage: vi.fn(),
  clearConversation: vi.fn(),
  findUserByWhatsAppNumber: vi.fn(),
  findUserByWhatsAppNumberUnverified: vi.fn(),
  getOrCreateConversation: vi.fn(),
  getRecentMessages: vi.fn(),
  hasInboundMessageWithWaMessageId: vi.fn(),
  verifyWhatsAppNumber: vi.fn(),
};

const mockWhatsAppClient = {
  getMediaBuffer: vi.fn(),
  sendMessage: vi.fn(),
  sendTypingIndicatorWithRetry: vi.fn(),
};

const mockPrepareRunWithAdapter = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pendingCalendarChange: {
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

const contentIngestionMocks = vi.hoisted(() => ({
  extractContentFromBuffer: vi.fn(),
  ingestWebChatUploads: vi.fn(),
}));

vi.mock('@/lib/services/content-ingestion', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/content-ingestion')>(
    '@/lib/services/content-ingestion',
  );

  return {
    ...actual,
    extractContentFromBuffer: contentIngestionMocks.extractContentFromBuffer,
    ingestWebChatUploads: contentIngestionMocks.ingestWebChatUploads,
  };
});

vi.mock('@/lib/ai/agents/executiveAgent', () => ({
  getExecutiveAgent: vi.fn(),
}));

vi.mock('@/lib/ai/tracing', () => ({
  createAiTraceRoot: vi.fn(),
  deriveOutputPreview: vi.fn(),
  deriveRunStatusFromError: vi.fn(() => 'ERROR'),
  finalizeAiTraceRun: vi.fn(),
}));

vi.mock('@/lib/services/whatsapp', () => ({
  getConversationManager: () => mockConversationManager,
  getWhatsAppClient: () => mockWhatsAppClient,
}));

vi.mock('@/lib/services/messaging-orchestration', () => ({
  buildOrchestrationMessageMetadata: vi.fn(),
  emitOrchestratorEvent: vi.fn(),
  getMessagingOrchestrator: () => ({
    prepareRunWithAdapter: mockPrepareRunWithAdapter,
  }),
  isDuplicateInboundFromAdapter: vi.fn(async () => ({
    isDuplicate: false,
    messageId: null,
  })),
}));

import { prisma } from '@/lib/prisma';
import { extractContentFromBuffer } from '@/lib/services/content-ingestion';
import { processWebChatMessage, processWhatsAppMessage } from '@/lib/services/whatsapp/messageProcessor';

function createExtractionResult(extractedText: string) {
  return {
    status: 'ok' as const,
    mediaFamily: 'pdf' as const,
    extractedText,
    images: [],
    structuredData: null,
    degradationNotes: [],
    attribution: {
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sniffedMimeType: 'application/pdf',
      sha256: 'pdf-sha',
      provenance: {
        sourceLabel: 'WhatsApp PDF',
        sourceKind: 'whatsapp_media',
        channel: 'whatsapp',
        conversationId: 'conv-1',
        runId: null,
        messageId: 'wa-msg-1',
        attachmentId: 'media-1',
        originUri: null,
      },
    },
    tokenCost: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
    extractionDurationMs: 25,
    cacheKey: 'pdf-cache',
    cacheStatus: 'miss' as const,
    handlerVersion: 'pdf-v1',
    budget: {
      scopeKey: 'conv-1',
      maxExtractions: 5,
      attemptsUsed: 1,
      totalTokens: 15,
      totalDurationMs: 25,
    },
    metadata: {
      sizeBytes: 2048,
      declaredMimeType: 'application/pdf',
      pageCountEstimate: 1,
      audioDurationSeconds: null,
    },
  };
}

describe('processWhatsAppMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockConversationManager.findUserByWhatsAppNumber.mockResolvedValue('user-1');
    mockConversationManager.findUserByWhatsAppNumberUnverified.mockResolvedValue(null);
    mockConversationManager.verifyWhatsAppNumber.mockResolvedValue(undefined);
    mockConversationManager.hasInboundMessageWithWaMessageId.mockResolvedValue(false);
    mockConversationManager.getOrCreateConversation.mockResolvedValue({ id: 'conv-1' });
    mockConversationManager.addMessage.mockResolvedValue({ id: 'stored-1' });
    mockConversationManager.getRecentMessages.mockResolvedValue([]);

    mockWhatsAppClient.sendMessage.mockResolvedValue({ messageId: 'wa-out-1' });
    mockWhatsAppClient.sendTypingIndicatorWithRetry.mockResolvedValue(undefined);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: 'user@example.com' } as never);
    mockPrepareRunWithAdapter.mockResolvedValue({ kind: 'skip', reason: 'test-terminal' });
    contentIngestionMocks.extractContentFromBuffer.mockResolvedValue(
      createExtractionResult(
        [
          'Invoice for March',
          'Account: ACME Co.',
          'Total due: $400',
        ].join('\n'),
      ),
    );
    contentIngestionMocks.ingestWebChatUploads.mockResolvedValue({
      appendedText: 'User uploaded a file in web chat.\n\nFilename: brief.pdf\n\nReadable content:\n\nQuarterly targets',
      contentRefs: [{ contentRefId: 'upload-ref-1' }],
      uploadMetadata: [
        {
          filename: 'brief.pdf',
          mediaType: 'application/pdf',
          contentRefId: 'upload-ref-1',
          status: 'ok',
          error: null,
        },
      ],
    });
  });

  test('formats pdf content into the agent request through shared content ingestion', async () => {
    mockWhatsAppClient.getMediaBuffer.mockResolvedValue({
      data: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
    });

    await processWhatsAppMessage({
      waId: '15551234567',
      senderName: 'Rushik',
      messageId: 'wa-msg-1',
      text: '',
      timestamp: 1_710_000_003,
      pdfMediaId: 'media-1',
      pdfMimeType: 'application/pdf',
      pdfFilename: 'invoice.pdf',
      pdfCaption: 'Pull out the amount due',
    });

    expect(extractContentFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('pdf-bytes'),
        mimeType: 'application/pdf',
        channelLabel: 'WhatsApp',
        filename: 'invoice.pdf',
        userCaption: 'Pull out the amount due',
        scope: {
          conversationId: 'conv-1',
        },
        provenance: expect.objectContaining({
          sourceLabel: 'WhatsApp PDF',
          sourceKind: 'whatsapp_media',
          channel: 'whatsapp',
          conversationId: 'conv-1',
          messageId: 'wa-msg-1',
          attachmentId: 'media-1',
        }),
      }),
    );
    expect(mockConversationManager.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        content: expect.stringContaining('User sent a PDF on WhatsApp.'),
        metadata: expect.objectContaining({
          fromPdf: true,
          pdfFilename: 'invoice.pdf',
          pdfCaption: 'Pull out the amount due',
        }),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('Filename: invoice.pdf'),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('User caption: Pull out the amount due'),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining(
          'Raw PDF text:\n\nInvoice for March\nAccount: ACME Co.\nTotal due: $400',
        ),
      }),
    );
  });

  test('routes web chat uploads through shared content references before invoking the agent', async () => {
    mockConversationManager.getOrCreateConversation.mockResolvedValue({ id: 'conv-web-1' });

    await processWebChatMessage('user-1', 'user@example.com', 'Summarize this', {
      requestId: 'web-run-1',
      uploads: [
        {
          filename: 'brief.pdf',
          mediaType: 'application/pdf',
          url: 'data:application/pdf;base64,ZmFrZQ==',
        },
      ],
    });

    expect(contentIngestionMocks.ingestWebChatUploads).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'conv-web-1',
      runId: 'web-run-1',
      uploads: [
        {
          filename: 'brief.pdf',
          mediaType: 'application/pdf',
          url: 'data:application/pdf;base64,ZmFrZQ==',
        },
      ],
    });
    expect(mockConversationManager.addMessage).toHaveBeenCalledWith(
      'conv-web-1',
      expect.objectContaining({
        content: expect.stringContaining('User uploaded a file in web chat.'),
        metadata: expect.objectContaining({
          uploadCount: 1,
          contentRefIds: ['upload-ref-1'],
        }),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('Quarterly targets'),
      }),
    );
  });
});
