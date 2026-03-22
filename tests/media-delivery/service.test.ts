import { beforeEach, describe, expect, test, vi } from 'vitest';

const contentIngestionMocks = vi.hoisted(() => ({
  loadContentReferenceAsset: vi.fn(),
}));

const deliveryTargetMocks = vi.hoisted(() => ({
  resolveTelegramDeliveryTargetForUser: vi.fn(),
}));

const telegramClientMocks = vi.hoisted(() => ({
  sendDocument: vi.fn(),
  sendPhoto: vi.fn(),
}));

vi.mock('@/lib/services/content-ingestion/referenceRuntime', () => ({
  loadContentReferenceAsset: contentIngestionMocks.loadContentReferenceAsset,
}));

vi.mock('@/lib/services/messagingDeliveryTargets', () => ({
  resolveTelegramDeliveryTargetForUser: deliveryTargetMocks.resolveTelegramDeliveryTargetForUser,
}));

vi.mock('@/lib/services/telegram', () => ({
  getTelegramClient: () => telegramClientMocks,
}));

import { deliverContentReference } from '@/lib/services/media-delivery/service';

const reference = {
  sourceKind: 'stored_content',
  locator: '{"storageId":"storage-1"}',
  displayName: 'invoice.pdf',
  mimeHint: 'application/pdf',
  trustClass: 'trusted_internal' as const,
  requiresApproval: false,
  provenance: {
    sourceLabel: 'Gmail email attachment',
    sourceKind: 'gmail_attachment',
    channel: 'gmail',
    conversationId: null,
    runId: null,
    messageId: null,
    attachmentId: null,
    originUri: null,
  },
  capability: 'document' as const,
  contentRefId: 'ref-1',
};

describe('deliverContentReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentIngestionMocks.loadContentReferenceAsset.mockResolvedValue({
      ok: true,
      reference,
      ownerUserId: 'user-1',
      bytes: Buffer.from('pdf-bytes'),
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      storedAt: Date.now(),
    });
    deliveryTargetMocks.resolveTelegramDeliveryTargetForUser.mockResolvedValue({
      chatId: 'chat-1',
      telegramUserId: 'tg-1',
    });
    telegramClientMocks.sendDocument.mockResolvedValue({ messageId: 'tg-doc-1' });
    telegramClientMocks.sendPhoto.mockResolvedValue({ messageId: 'tg-photo-1' });
  });

  test('delivers documents via Telegram sendDocument', async () => {
    const result = await deliverContentReference({
      userId: 'user-1',
      reference,
      channel: 'telegram',
      caption: 'Here it is',
    });

    expect(telegramClientMocks.sendDocument).toHaveBeenCalledWith('chat-1', {
      data: Buffer.from('pdf-bytes'),
      filename: 'invoice.pdf',
      caption: 'Here it is',
    });
    expect(telegramClientMocks.sendPhoto).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      channel: 'telegram',
      deliveryMode: 'document',
      externalMessageId: 'tg-doc-1',
    });
  });

  test('delivers supported images via Telegram sendPhoto', async () => {
    contentIngestionMocks.loadContentReferenceAsset.mockResolvedValueOnce({
      ok: true,
      reference: {
        ...reference,
        displayName: 'image.png',
        mimeHint: 'image/png',
      },
      ownerUserId: 'user-1',
      bytes: Buffer.from('image-bytes'),
      filename: 'image.png',
      mimeType: 'image/png',
      storedAt: Date.now(),
    });

    const result = await deliverContentReference({
      userId: 'user-1',
      reference: {
        ...reference,
        displayName: 'image.png',
        mimeHint: 'image/png',
      },
      channel: 'telegram',
    });

    expect(telegramClientMocks.sendPhoto).toHaveBeenCalledWith('chat-1', {
      data: Buffer.from('image-bytes'),
      filename: 'image.png',
      caption: undefined,
    });
    expect(result).toMatchObject({
      success: true,
      channel: 'telegram',
      deliveryMode: 'photo',
      externalMessageId: 'tg-photo-1',
    });
  });

  test('returns a clear error when Telegram is not linked', async () => {
    deliveryTargetMocks.resolveTelegramDeliveryTargetForUser.mockResolvedValueOnce(null);

    const result = await deliverContentReference({
      userId: 'user-1',
      reference,
      channel: 'telegram',
    });

    expect(result).toEqual({
      success: false,
      channel: 'telegram',
      error: 'delivery_target_unavailable',
      retryable: false,
      message: 'Telegram is not connected for this user right now.',
      contentRef: expect.any(Object),
    });
  });
});
