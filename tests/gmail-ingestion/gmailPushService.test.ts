import { describe, expect, test, vi } from 'vitest';
import { GmailPushService } from '@/lib/email/gmailPushService';

describe('gmailPushService duplicate suppression', () => {
  test('dedupeEmailsByMessageId merges duplicate parsed emails by message id', () => {
    const service = new GmailPushService();

    const deduped = (service as any).dedupeEmailsByMessageId([
      {
        messageId: 'msg-1',
        labelIds: ['INBOX'],
        to: ['one@example.com'],
        cc: [],
        body: 'short body',
        snippet: 'short',
        isSent: false,
        isDraft: false,
      },
      {
        messageId: 'msg-1',
        labelIds: ['IMPORTANT'],
        to: ['one@example.com', 'two@example.com'],
        cc: ['copy@example.com'],
        body: 'this body is longer',
        snippet: 'this snippet is longer too',
        isSent: false,
        isDraft: false,
      },
      {
        messageId: 'msg-2',
        labelIds: ['SENT'],
        to: ['three@example.com'],
        cc: [],
        body: 'other body',
        snippet: 'other',
        isSent: true,
        isDraft: false,
      },
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toMatchObject({
      messageId: 'msg-1',
      labelIds: ['INBOX', 'IMPORTANT'],
      to: ['one@example.com', 'two@example.com'],
      cc: ['copy@example.com'],
      body: 'this body is longer',
      snippet: 'this snippet is longer too',
    });
    expect(deduped[1]).toMatchObject({
      messageId: 'msg-2',
      labelIds: ['SENT'],
      isSent: true,
    });
  });

  test('getNewEmailsFromHistoryWithLabels fetches each duplicated history message only once', async () => {
    const service = new GmailPushService('user-1') as any;
    const historyList = vi.fn().mockResolvedValue({
      data: {
        history: [
          {
            messagesAdded: [
              { message: { id: 'msg-1' } },
              { message: { id: 'msg-1' } },
              { message: { id: 'msg-2' } },
            ],
          },
          {
            messagesAdded: [
              { message: { id: 'msg-2' } },
              { message: { id: 'msg-1' } },
            ],
          },
        ],
      },
    });
    const messageGet = vi.fn(async ({ id }: { id: string }) => ({
      data: { id },
    }));

    service.ensureAuthenticated = vi.fn().mockResolvedValue(undefined);
    service.handleSentEmailForReplyResolution = vi.fn().mockResolvedValue(undefined);
    service.parseGmailMessageWithLabels = vi.fn((message: { id: string }) => ({
      messageId: message.id,
      from: 'sender@example.com',
      to: [],
      cc: [],
      subject: `subject-${message.id}`,
      body: '',
      snippet: '',
      isSent: false,
      isDraft: false,
      labelIds: [],
      date: new Date('2026-03-18T00:00:00.000Z'),
    }));
    service.gmail = {
      users: {
        history: {
          list: historyList,
        },
        messages: {
          get: messageGet,
        },
      },
    };

    const emails = await service.getNewEmailsFromHistoryWithLabels({
      startHistoryId: '1',
      endHistoryId: '2',
      userId: 'user-1',
      mailboxId: 'mailbox-1',
    });

    expect(historyList).toHaveBeenCalledTimes(1);
    expect(messageGet).toHaveBeenCalledTimes(2);
    expect(messageGet.mock.calls.map((call) => call[0].id)).toEqual(['msg-1', 'msg-2']);
    expect(emails.map((email: { messageId: string }) => email.messageId)).toEqual(['msg-1', 'msg-2']);
  });
});
