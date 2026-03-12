import { beforeEach, describe, expect, test, vi } from 'vitest';

const mailboxMocks = vi.hoisted(() => ({
  getMailboxesForUser: vi.fn(),
}));

const txMocks = vi.hoisted(() => ({
  runInboxSearchTransaction: vi.fn(),
}));

vi.mock('@/lib/services/mailbox/getMailboxesForUser', () => ({
  getMailboxesForUser: mailboxMocks.getMailboxesForUser,
}));

vi.mock('@/lib/services/inbox-search/tx', () => ({
  runInboxSearchTransaction: txMocks.runInboxSearchTransaction,
}));

const { listInboxEmails } = await import('@/lib/services/inbox-search/list-emails');

describe('listInboxEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mailboxMocks.getMailboxesForUser.mockResolvedValue([
      {
        id: 'mailbox-1',
        emailAddress: 'user@example.com',
        status: 'CONNECTED',
        isPrimary: true,
      },
    ]);
  });

  test('returns exact matched items with deterministic metadata and omits bodies by default', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([
        {
          messageId: 'message-2',
          threadId: 'thread-2',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-10T18:12:12.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 2',
          hasAttachment: false,
          bodyText: 'Total $9.66',
        },
        {
          messageId: 'message-1',
          threadId: 'thread-1',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-09T20:07:16.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 1',
          hasAttachment: false,
          bodyText: 'Total $6.30',
        },
      ]);

    txMocks.runInboxSearchTransaction.mockImplementation(
      async (_userId: string, fn: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>) =>
        fn({ $queryRaw: queryRaw }),
    );

    const result = await listInboxEmails(
      {
        filters: {
          sender: 'Tim Hortons',
          relativeWindow: 'last_7_days',
          includeDeleted: false,
        },
        options: {
          includeBody: false,
          limit: 20,
          sortBy: 'newest',
          timezone: 'America/Vancouver',
        },
      },
      {
        userId: 'user-1',
      },
    );

    expect(result).toEqual({
      items: [
        {
          messageId: 'message-2',
          threadId: 'thread-2',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: '2026-03-10T18:12:12.000Z',
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 2',
          hasAttachment: false,
        },
        {
          messageId: 'message-1',
          threadId: 'thread-1',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: '2026-03-09T20:07:16.000Z',
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 1',
          hasAttachment: false,
        },
      ],
      matchedCount: 2,
      returnedCount: 2,
      truncated: false,
    });
  });

  test('includes full bodies when requested and marks truncation from matchedCount', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ count: 4 }])
      .mockResolvedValueOnce([
        {
          messageId: 'message-4',
          threadId: 'thread-4',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-11T18:12:12.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 4',
          hasAttachment: false,
          bodyText: 'Total $4.11',
        },
        {
          messageId: 'message-3',
          threadId: 'thread-3',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-10T18:12:12.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 3',
          hasAttachment: false,
          bodyText: 'Total $9.66',
        },
      ]);

    txMocks.runInboxSearchTransaction.mockImplementation(
      async (_userId: string, fn: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>) =>
        fn({ $queryRaw: queryRaw }),
    );

    const result = await listInboxEmails(
      {
        filters: {
          sender: 'Tim Hortons',
          relativeWindow: 'last_7_days',
          includeDeleted: false,
        },
        options: {
          includeBody: true,
          limit: 2,
          sortBy: 'newest',
          timezone: 'America/Vancouver',
        },
      },
      {
        userId: 'user-1',
      },
    );

    expect(result.matchedCount).toBe(4);
    expect(result.returnedCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.items[0]?.bodyText).toBe('Total $4.11');
    expect(result.items[1]?.bodyText).toBe('Total $9.66');
  });

  test('returns all receipt emails in the bounded window for receipt-style queries', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ count: 4 }])
      .mockResolvedValueOnce([
        {
          messageId: 'message-4',
          threadId: 'thread-4',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-11T18:12:12.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 4',
          hasAttachment: false,
          bodyText: 'Total $4.11',
        },
        {
          messageId: 'message-3',
          threadId: 'thread-3',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-10T18:12:12.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 3',
          hasAttachment: false,
          bodyText: 'Total $9.66',
        },
        {
          messageId: 'message-2',
          threadId: 'thread-2',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-09T20:07:16.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 2',
          hasAttachment: false,
          bodyText: 'Total $6.30',
        },
        {
          messageId: 'message-1',
          threadId: 'thread-1',
          mailboxId: 'mailbox-1',
          mailboxEmail: 'user@example.com',
          sentAt: new Date('2026-03-08T17:01:00.000Z'),
          from: 'Tim Hortons <noreply@noreply.timhortons.ca>',
          to: ['user@example.com'],
          cc: [],
          subject: 'Thanks for your order',
          snippet: 'Receipt 1',
          hasAttachment: false,
          bodyText: 'Total $2.32',
        },
      ]);

    txMocks.runInboxSearchTransaction.mockImplementation(
      async (_userId: string, fn: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>) =>
        fn({ $queryRaw: queryRaw }),
    );

    const result = await listInboxEmails(
      {
        filters: {
          sender: 'Tim Hortons',
          relativeWindow: 'last_7_days',
          includeDeleted: false,
        },
        options: {
          includeBody: true,
          limit: 20,
          sortBy: 'newest',
          timezone: 'America/Vancouver',
        },
      },
      {
        userId: 'user-1',
      },
    );

    expect(result.matchedCount).toBe(4);
    expect(result.returnedCount).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.items.map((item) => item.messageId)).toEqual([
      'message-4',
      'message-3',
      'message-2',
      'message-1',
    ]);
  });
});
