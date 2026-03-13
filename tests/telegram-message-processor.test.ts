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

vi.mock('@/lib/ai/describeIncomingImage', () => ({
  describeIncomingImage: vi.fn(),
}));

vi.mock('@/lib/ai/extractIncomingPdfText', () => ({
  extractIncomingPdfText: vi.fn(),
}));

vi.mock('@/lib/ai/transcribeVoiceMemo', () => ({
  transcribeVoiceMemo: vi.fn(),
}));

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
  isDuplicateInboundFromAdapter: vi.fn(async () => ({
    isDuplicate: false,
    messageId: null,
  })),
}));

import { prisma } from '@/lib/prisma';
import { describeIncomingImage } from '@/lib/ai/describeIncomingImage';
import { extractIncomingPdfText } from '@/lib/ai/extractIncomingPdfText';
import { processTelegramMessage } from '@/lib/services/telegram/messageProcessor';

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
    vi.mocked(describeIncomingImage).mockResolvedValue('Image shows an invoice and due date.');

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

    expect(describeIncomingImage).toHaveBeenCalledWith(
      Buffer.from('image-bytes'),
      'image/png',
      expect.objectContaining({
        channelLabel: 'Telegram',
        userCaption: 'Please summarize the key charges',
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
    vi.mocked(extractIncomingPdfText).mockResolvedValue('SUMMARY: Invoice for March.\n- KEY DETAILS:\n  - Total due: $400');

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

    expect(extractIncomingPdfText).toHaveBeenCalledWith(
      Buffer.from('pdf-bytes'),
      'application/pdf',
      expect.objectContaining({
        channelLabel: 'Telegram',
        filename: 'invoice.pdf',
        userCaption: 'Pull out the amount due',
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
        userRequest: expect.stringContaining('Detailed PDF extraction:\n\nSUMMARY: Invoice for March.'),
      }),
    );
  });
});
