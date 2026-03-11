import { describe, expect, test } from 'vitest';
import { extractTelegramInboundMessage } from '@/lib/services/telegram/telegramClient';

describe('extractTelegramInboundMessage', () => {
  test('captures reply context and caption for photo messages', () => {
    const inbound = extractTelegramInboundMessage({
      update: { update_id: 42 },
      from: { id: 999, first_name: 'Rushik' },
      chat: { id: 12345, type: 'private' },
      message: {
        message_id: 100,
        date: 1_710_000_000,
        photo: [{ file_id: 'small' }, { file_id: 'large', mime_type: 'image/png' }],
        caption: 'Use this screenshot for the reply',
        reply_to_message: {
          message_id: 99,
          text: 'Can you answer this?',
          from: {
            id: 777,
            first_name: 'Clira',
            is_bot: true,
          },
        },
        quote: {
          text: 'answer this',
        },
      },
    } as never);

    expect(inbound).toEqual({
      updateId: 42,
      messageId: '100',
      chatId: '12345',
      telegramUserId: '999',
      telegramUsername: undefined,
      senderName: 'Rushik',
      text: '',
      timestamp: 1_710_000_000,
      imageFileId: 'large',
      imageMimeType: 'image/png',
      imageCaption: 'Use this screenshot for the reply',
      replyContext: {
        messageId: '99',
        senderName: 'Clira',
        text: 'Can you answer this?',
        quote: 'answer this',
        isBot: true,
      },
    });
  });
});
