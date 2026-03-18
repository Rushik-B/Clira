import { beforeEach, describe, expect, test, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  emailFindMany: vi.fn(),
  feedbackUpsert: vi.fn(),
  generatedDraftDeleteMany: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    email: {
      findMany: prismaMocks.emailFindMany,
    },
    feedback: {
      upsert: prismaMocks.feedbackUpsert,
    },
    generatedDraft: {
      deleteMany: prismaMocks.generatedDraftDeleteMany,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
}));

const { reconcileResolvedGeneratedDrafts } = await import(
  '@/lib/services/queue/reconcileResolvedGeneratedDrafts'
);

describe('reconcileResolvedGeneratedDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.generatedDraftDeleteMany.mockResolvedValue({ count: 1 });
    prismaMocks.feedbackUpsert.mockResolvedValue(undefined);
  });

  test('cleans stale drafts in-thread and preserves already-handled feedback rows', async () => {
    const resolvedAt = new Date('2026-03-14T10:00:00.000Z');

    prismaMocks.emailFindMany.mockResolvedValue([
      {
        id: 'email-1',
        threadId: 'thread-1',
        mailboxId: 'mailbox-1',
        gmailThreadId: 'gmail-thread-1',
        createdAt: new Date('2026-03-14T09:00:00.000Z'),
        feedback: null,
        generatedDraft: {
          id: 'generated-1',
          gmailDraftId: 'draft-1',
        },
      },
      {
        id: 'email-2',
        threadId: 'thread-1',
        mailboxId: 'mailbox-1',
        gmailThreadId: 'gmail-thread-1',
        createdAt: new Date('2026-03-14T09:30:00.000Z'),
        feedback: { id: 'feedback-2' },
        generatedDraft: {
          id: 'generated-2',
          gmailDraftId: 'draft-2',
        },
      },
    ]);

    const gmail = {
      deleteDraft: vi.fn().mockResolvedValue(undefined),
    };

    const result = await reconcileResolvedGeneratedDrafts({
      userId: 'user-1',
      mailboxId: 'mailbox-1',
      threadId: 'thread-1',
      gmailThreadId: 'gmail-thread-1',
      resolvedAt,
      sentMessageId: 'sent-1',
      source: 'queue-approve',
      gmail,
    });

    expect(prismaMocks.emailFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        threadId: 'thread-1',
        mailboxId: 'mailbox-1',
        isSent: false,
        createdAt: { lte: resolvedAt },
      }),
    }));
    expect(prismaMocks.feedbackUpsert).toHaveBeenCalledTimes(1);
    expect(prismaMocks.feedbackUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { emailId: 'email-1' },
      create: expect.objectContaining({
        userId: 'user-1',
        action: 'ACCEPTED',
        editDelta: expect.objectContaining({
          source: 'queue-approve',
          reconciled: true,
          sentMessageId: 'sent-1',
          resolvedAt: resolvedAt.toISOString(),
        }),
      }),
    }));
    expect(gmail.deleteDraft).toHaveBeenCalledTimes(2);
    expect(gmail.deleteDraft).toHaveBeenNthCalledWith(1, 'draft-1');
    expect(gmail.deleteDraft).toHaveBeenNthCalledWith(2, 'draft-2');
    expect(prismaMocks.generatedDraftDeleteMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      candidateCount: 2,
      feedbackUpserts: 1,
      cleanedDraftCount: 2,
      retainedDraftCount: 0,
    });
  });

  test('treats Gmail draft delete 404 as already clean and removes the local pointer', async () => {
    prismaMocks.emailFindMany.mockResolvedValue([
      {
        id: 'email-404',
        threadId: 'thread-404',
        mailboxId: 'mailbox-1',
        gmailThreadId: 'gmail-thread-404',
        createdAt: new Date('2026-03-14T08:00:00.000Z'),
        feedback: null,
        generatedDraft: {
          id: 'generated-404',
          gmailDraftId: 'draft-404',
        },
      },
    ]);

    const gmail = {
      deleteDraft: vi.fn().mockRejectedValue({ code: 404 }),
    };

    const result = await reconcileResolvedGeneratedDrafts({
      userId: 'user-1',
      mailboxId: 'mailbox-1',
      gmailThreadId: 'gmail-thread-404',
      resolvedAt: new Date('2026-03-14T10:00:00.000Z'),
      sentMessageId: 'sent-404',
      source: 'queue-get-live-gmail',
      gmail,
    });

    expect(prismaMocks.feedbackUpsert).toHaveBeenCalledTimes(1);
    expect(prismaMocks.generatedDraftDeleteMany).toHaveBeenCalledWith({
      where: { id: 'generated-404' },
    });
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(result).toEqual({
      candidateCount: 1,
      feedbackUpserts: 1,
      cleanedDraftCount: 1,
      retainedDraftCount: 0,
    });
  });

  test('keeps the generated draft pointer for retry on auth or transient cleanup failures', async () => {
    prismaMocks.emailFindMany.mockResolvedValue([
      {
        id: 'email-retry',
        threadId: 'thread-retry',
        mailboxId: 'mailbox-1',
        gmailThreadId: 'gmail-thread-retry',
        createdAt: new Date('2026-03-14T08:30:00.000Z'),
        feedback: null,
        generatedDraft: {
          id: 'generated-retry',
          gmailDraftId: 'draft-retry',
        },
      },
    ]);

    const gmail = {
      deleteDraft: vi.fn().mockRejectedValue({ status: 503 }),
    };

    const result = await reconcileResolvedGeneratedDrafts({
      userId: 'user-1',
      mailboxId: 'mailbox-1',
      gmailThreadId: 'gmail-thread-retry',
      resolvedAt: new Date('2026-03-14T10:00:00.000Z'),
      sentMessageId: 'sent-retry',
      source: 'gmail-push-external-send',
      gmail,
    });

    expect(prismaMocks.feedbackUpsert).toHaveBeenCalledTimes(1);
    expect(prismaMocks.generatedDraftDeleteMany).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      '[stale-draft-reconciler] Draft cleanup degraded',
      expect.objectContaining({
        userId: 'user-1',
        mailboxId: 'mailbox-1',
        emailId: 'email-retry',
        gmailDraftId: 'draft-retry',
        source: 'gmail-push-external-send',
        failureClass: 'retryable',
        status: 503,
      }),
    );
    expect(result).toEqual({
      candidateCount: 1,
      feedbackUpserts: 1,
      cleanedDraftCount: 0,
      retainedDraftCount: 1,
    });
  });
});
