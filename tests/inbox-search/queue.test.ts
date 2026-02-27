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

vi.mock('@/lib/services/utils/queues', () => ({
  inboxIndexQueue: queueMocks.inboxIndexQueue,
  inboxBackfillQueue: queueMocks.inboxBackfillQueue,
  inboxEmbedRetryQueue: queueMocks.inboxEmbedRetryQueue,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks.prisma,
}));

const {
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
});
