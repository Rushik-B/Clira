import { beforeEach, describe, expect, test, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
  inboxIndexQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
  },
  inboxBackfillQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
  },
  inboxEmbedRetryQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
  },
}));

const prismaMocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    mailbox: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const txMocks = vi.hoisted(() => ({
  runInboxSearchTransaction: vi.fn(),
}));

vi.mock('@/lib/services/utils/queues', () => ({
  inboxIndexQueue: queueMocks.inboxIndexQueue,
  inboxBackfillQueue: queueMocks.inboxBackfillQueue,
  inboxEmbedRetryQueue: queueMocks.inboxEmbedRetryQueue,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks.prisma,
}));

vi.mock('@/lib/services/inbox-search/tx', () => ({
  runInboxSearchTransaction: txMocks.runInboxSearchTransaction,
}));

const {
  enqueueInboxEmbeddingBackfillSweep,
  enqueueInboxEmbeddingBackfillSweepPage,
  enqueueInboxBackfillForConnectedMailboxes,
  enqueueInboxBackfillForMailboxIfReady,
} = await import('@/lib/services/inbox-search/queue');

describe('inbox-search queue helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    queueMocks.inboxBackfillQueue.getJob.mockResolvedValue(null);
    queueMocks.inboxBackfillQueue.add.mockImplementation(async (_name: string, _data: unknown, options: { jobId: string }) => ({
      id: options.jobId,
    }));
    queueMocks.inboxEmbedRetryQueue.getJob.mockResolvedValue(null);
    queueMocks.inboxEmbedRetryQueue.add.mockImplementation(async (_name: string, _data: unknown, options: { jobId: string }) => ({
      id: options.jobId,
    }));
    txMocks.runInboxSearchTransaction.mockImplementation(async (_userId: string, fn: (tx: { $queryRaw: () => Promise<unknown> }) => Promise<unknown>) =>
      fn({
        $queryRaw: async () => [],
      }),
    );

    prismaMocks.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      masterPromptGenerated: true,
    });
    prismaMocks.prisma.mailbox.findMany.mockResolvedValue([
      { id: 'mailbox-1' },
      { id: 'mailbox-2' },
    ]);
    prismaMocks.prisma.mailbox.findUnique.mockResolvedValue({
      id: 'mailbox-1',
      userId: 'user-1',
      status: 'CONNECTED',
    });
  });

  test('enqueues one backfill job per connected mailbox after master prompt generation', async () => {
    const result = await enqueueInboxBackfillForConnectedMailboxes('user-1');

    expect(result).toEqual({
      enqueuedCount: 2,
      mailboxIds: ['mailbox-1', 'mailbox-2'],
    });
    expect(queueMocks.inboxBackfillQueue.add).toHaveBeenCalledTimes(2);
    expect(queueMocks.inboxBackfillQueue.add).toHaveBeenNthCalledWith(
      1,
      'backfill-mailbox',
      {
        userId: 'user-1',
        mailboxId: 'mailbox-1',
      },
      expect.objectContaining({
        jobId: 'inbox-backfill:mailbox-1',
      }),
    );
  });

  test('skips mailbox enqueue when onboarding master prompt is not ready', async () => {
    prismaMocks.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      masterPromptGenerated: false,
    });

    const result = await enqueueInboxBackfillForMailboxIfReady({
      userId: 'user-1',
      mailboxId: 'mailbox-1',
    });

    expect(result).toEqual({
      enqueued: false,
      skippedReason: 'master-prompt-not-generated',
    });
    expect(queueMocks.inboxBackfillQueue.add).not.toHaveBeenCalled();
  });

  test('sweeps missing chunk embeddings and enqueues retry jobs in stable pages', async () => {
    txMocks.runInboxSearchTransaction.mockImplementationOnce(
      async (
        _userId: string,
        fn: (tx: { $queryRaw: () => Promise<unknown> }) => Promise<unknown>,
      ) =>
        fn({
          $queryRaw: async () => [
            {
              documentId: 'doc-1',
              mailboxId: 'mailbox-1',
              messageId: 'msg-1',
            },
            {
              documentId: 'doc-2',
              mailboxId: 'mailbox-1',
              messageId: 'msg-2',
            },
          ],
        }),
    );

    const result = await enqueueInboxEmbeddingBackfillSweepPage({
      userId: 'user-1',
      mailboxId: 'mailbox-1',
      pageSize: 2,
    });

    expect(result).toEqual({
      scannedDocuments: 2,
      enqueuedCount: 2,
      nextAfterDocumentId: 'doc-2',
      hasMore: true,
    });
    expect(queueMocks.inboxEmbedRetryQueue.add).toHaveBeenNthCalledWith(
      1,
      'retry-document-embedding',
      {
        userId: 'user-1',
        mailboxId: 'mailbox-1',
        messageId: 'msg-1',
        documentId: 'doc-1',
      },
      expect.objectContaining({
        jobId: 'inbox-embed-retry:doc-1',
      }),
    );
  });

  test('returns resumable sweep metadata when max pages cap is reached', async () => {
    txMocks.runInboxSearchTransaction
      .mockImplementationOnce(
        async (
          _userId: string,
          fn: (tx: { $queryRaw: () => Promise<unknown> }) => Promise<unknown>,
        ) =>
          fn({
            $queryRaw: async () => [
              {
                documentId: 'doc-1',
                mailboxId: 'mailbox-1',
                messageId: 'msg-1',
              },
            ],
          }),
      )
      .mockImplementationOnce(
        async (
          _userId: string,
          fn: (tx: { $queryRaw: () => Promise<unknown> }) => Promise<unknown>,
        ) =>
          fn({
            $queryRaw: async () => [
              {
                documentId: 'doc-2',
                mailboxId: 'mailbox-1',
                messageId: 'msg-2',
              },
            ],
          }),
      );

    const result = await enqueueInboxEmbeddingBackfillSweep({
      userId: 'user-1',
      mailboxId: 'mailbox-1',
      pageSize: 1,
      maxPages: 2,
    });

    expect(result).toEqual({
      scannedDocuments: 2,
      enqueuedCount: 2,
      hasRemaining: true,
      nextAfterDocumentId: 'doc-2',
    });
  });
});
