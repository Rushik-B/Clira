import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockConversationManager = {
  addMessage: vi.fn(),
  clearConversation: vi.fn(),
  getMessageByTelegramMessageId: vi.fn(),
  getOrCreateConversation: vi.fn(),
  getRecentMessages: vi.fn(),
  hasInboundMessageWithTelegramMessageId: vi.fn(),
  hasInboundMessageWithUpdateId: vi.fn(),
};

const mockPairingManager = {
  createOrReusePairingRequest: vi.fn(),
  findActiveLinkByTelegramUserId: vi.fn(),
  touchLinkActivityByTelegramUserId: vi.fn(),
};

const mockTelegramClient = {
  getFileBuffer: vi.fn(),
  sendMessage: vi.fn(),
  startTypingIndicator: vi.fn(),
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
}));

vi.mock('@/lib/services/content-ingestion', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/content-ingestion')>(
    '@/lib/services/content-ingestion',
  );

  return {
    ...actual,
    extractContentFromBuffer: contentIngestionMocks.extractContentFromBuffer,
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

vi.mock('@/lib/services/telegram', () => ({
  getConversationManager: () => mockConversationManager,
  getPairingManager: () => mockPairingManager,
  getTelegramClient: () => mockTelegramClient,
}));

vi.mock('@/lib/services/messaging-orchestration', () => ({
  buildOrchestrationMessageMetadata: vi.fn(),
  emitOrchestratorEvent: vi.fn(),
  getMessagingOrchestrator: () => ({
    prepareRunWithAdapter: mockPrepareRunWithAdapter,
  }),
  getDuplicateInboundMessageIdFromAdapter: vi.fn(async () => null),
}));

import { prisma } from '@/lib/prisma';
import { extractContentFromBuffer } from '@/lib/services/content-ingestion';
import { processTelegramMessage } from '@/lib/services/telegram/messageProcessor';

function createExtractionResult(params: {
  mediaFamily: 'image' | 'pdf';
  extractedText: string;
}) {
  return {
    status: 'ok' as const,
    mediaFamily: params.mediaFamily,
    extractedText: params.extractedText,
    images: [],
    structuredData: null,
    degradationNotes: [],
    attribution: {
      filename: params.mediaFamily === 'pdf' ? 'invoice.pdf' : null,
      mimeType: params.mediaFamily === 'pdf' ? 'application/pdf' : 'image/png',
      sniffedMimeType: params.mediaFamily === 'pdf' ? 'application/pdf' : 'image/png',
      sha256: `${params.mediaFamily}-sha`,
      provenance: {
        sourceLabel: params.mediaFamily === 'pdf' ? 'Telegram PDF' : 'Telegram image',
        sourceKind: 'telegram_media',
        channel: 'telegram',
        conversationId: 'conv-1',
        runId: null,
        messageId: '102',
        attachmentId: params.mediaFamily === 'pdf' ? 'pdf-1' : 'file-1',
        originUri: null,
      },
    },
    tokenCost: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
    extractionDurationMs: 25,
    cacheKey: `${params.mediaFamily}-cache`,
    cacheStatus: 'miss' as const,
    handlerVersion: `${params.mediaFamily}-v1`,
    budget: {
      scopeKey: 'conv-1',
      maxExtractions: 5,
      attemptsUsed: 1,
      totalTokens: 15,
      totalDurationMs: 25,
    },
    metadata: {
      sizeBytes: 2048,
      declaredMimeType: params.mediaFamily === 'pdf' ? 'application/pdf' : 'image/png',
      pageCountEstimate: params.mediaFamily === 'pdf' ? 1 : null,
      audioDurationSeconds: null,
    },
  };
}

describe('processTelegramMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockConversationManager.hasInboundMessageWithUpdateId.mockResolvedValue(false);
    mockConversationManager.hasInboundMessageWithTelegramMessageId.mockResolvedValue(false);
    mockConversationManager.getOrCreateConversation.mockResolvedValue({ id: 'conv-1' });
    mockConversationManager.addMessage.mockResolvedValue({ id: 'stored-1' });
    mockConversationManager.getRecentMessages.mockResolvedValue([]);

    mockPairingManager.findActiveLinkByTelegramUserId.mockResolvedValue({ userId: 'user-1' });
    mockPairingManager.touchLinkActivityByTelegramUserId.mockResolvedValue(undefined);

    mockTelegramClient.sendMessage.mockResolvedValue({ messageId: 'tg-out-1' });
    mockTelegramClient.startTypingIndicator.mockReturnValue(() => {});

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ email: 'user@example.com' } as never);
    mockPrepareRunWithAdapter.mockResolvedValue({ kind: 'skip', reason: 'test-terminal' });
    contentIngestionMocks.extractContentFromBuffer.mockResolvedValue(
      createExtractionResult({
        mediaFamily: 'pdf',
        extractedText: [
          'Invoice for March',
          'Account: ACME Co.',
          'Total due: $400',
        ].join('\n'),
      }),
    );
  });

  test('adds explicit reply context for text replies to prior user messages', async () => {
    mockConversationManager.getMessageByTelegramMessageId.mockResolvedValue({
      role: 'USER',
      direction: 'INBOUND',
      content: 'Draft a reply to Sarah about Thursday afternoon.',
    });

    await processTelegramMessage({
      updateId: 1,
      messageId: '101',
      chatId: 'chat-1',
      telegramUserId: 'tg-user-1',
      senderName: 'Rushik',
      text: 'What about this one?',
      timestamp: 1_710_000_001,
      replyContext: {
        messageId: '88',
        text: 'Previous text',
      },
    });

    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('User is replying to an earlier User message on Telegram.'),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('Replied-to message: Draft a reply to Sarah about Thursday afternoon.'),
      }),
    );
    expect(mockConversationManager.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        content: expect.stringContaining('What about this one?'),
        metadata: expect.objectContaining({
          replyContext: expect.objectContaining({
            messageId: '88',
            role: 'USER',
            direction: 'INBOUND',
            repliedText: 'Draft a reply to Sarah about Thursday afternoon.',
          }),
        }),
      }),
    );
  });

  test('preserves image captions and reply context in the agent request', async () => {
    mockConversationManager.getMessageByTelegramMessageId.mockResolvedValue({
      role: 'ASSISTANT',
      direction: 'OUTBOUND',
      content: 'Please check the screenshot and tell me what to respond.',
    });
    mockTelegramClient.getFileBuffer.mockResolvedValue({
      data: Buffer.from('image-bytes'),
      mimeType: 'image/png',
    });
    contentIngestionMocks.extractContentFromBuffer.mockResolvedValue(
      createExtractionResult({
        mediaFamily: 'image',
        extractedText: 'Image shows an invoice and due date.',
      }),
    );

    await processTelegramMessage({
      updateId: 2,
      messageId: '102',
      chatId: 'chat-1',
      telegramUserId: 'tg-user-1',
      senderName: 'Rushik',
      text: '',
      timestamp: 1_710_000_002,
      imageFileId: 'file-1',
      imageMimeType: 'image/png',
      imageCaption: 'Please summarize the key charges',
      replyContext: {
        messageId: '89',
        text: 'Check the screenshot',
        isBot: true,
      },
    });

    expect(extractContentFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
        channelLabel: 'Telegram',
        userCaption: 'Please summarize the key charges',
        scope: {
          conversationId: 'conv-1',
        },
        provenance: expect.objectContaining({
          sourceLabel: 'Telegram image',
          sourceKind: 'telegram_media',
          channel: 'telegram',
          conversationId: 'conv-1',
          messageId: '102',
          attachmentId: 'file-1',
        }),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('User is replying to an earlier Assistant message on Telegram.'),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('User caption: Please summarize the key charges'),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('Detailed image description:\n\nImage shows an invoice and due date.'),
      }),
    );
  });

  test('formats pdf content into the agent request with filename and caption', async () => {
    mockTelegramClient.getFileBuffer.mockResolvedValue({
      data: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
    });
    contentIngestionMocks.extractContentFromBuffer.mockResolvedValue(
      createExtractionResult({
        mediaFamily: 'pdf',
        extractedText: [
          'Invoice for March',
          'Account: ACME Co.',
          'Total due: $400',
        ].join('\n'),
      }),
    );

    await processTelegramMessage({
      updateId: 3,
      messageId: '103',
      chatId: 'chat-1',
      telegramUserId: 'tg-user-1',
      senderName: 'Rushik',
      text: '',
      timestamp: 1_710_000_003,
      pdfFileId: 'pdf-1',
      pdfMimeType: 'application/pdf',
      pdfFilename: 'invoice.pdf',
      pdfCaption: 'Pull out the amount due',
    });

    expect(extractContentFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('pdf-bytes'),
        mimeType: 'application/pdf',
        channelLabel: 'Telegram',
        filename: 'invoice.pdf',
        userCaption: 'Pull out the amount due',
        scope: {
          conversationId: 'conv-1',
        },
        provenance: expect.objectContaining({
          sourceLabel: 'Telegram PDF',
          sourceKind: 'telegram_media',
          channel: 'telegram',
          conversationId: 'conv-1',
          messageId: '103',
          attachmentId: 'pdf-1',
        }),
      }),
    );
    expect(mockPrepareRunWithAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        userRequest: expect.stringContaining('User sent a PDF on Telegram.'),
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
});
