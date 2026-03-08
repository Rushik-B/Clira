import { InboxBackfillState } from '@prisma/client';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EmailData } from '@/lib/email/gmail';

const checkpointMocks = vi.hoisted(() => ({
  getOrCreateInboxSearchCheckpoint: vi.fn(),
  saveInboxBackfillProgress: vi.fn(),
  markInboxBackfillPausedAuthRevoked: vi.fn(),
  markInboxBackfillComplete: vi.fn(),
}));

vi.mock('@/lib/services/inbox-search/checkpoint', () => ({
  getOrCreateInboxSearchCheckpoint: checkpointMocks.getOrCreateInboxSearchCheckpoint,
  saveInboxBackfillProgress: checkpointMocks.saveInboxBackfillProgress,
  markInboxBackfillPausedAuthRevoked: checkpointMocks.markInboxBackfillPausedAuthRevoked,
  markInboxBackfillComplete: checkpointMocks.markInboxBackfillComplete,
  resolveInboxBackfillResume: (checkpoint: {
    backfillState: InboxBackfillState;
    lastBackfillCursor: string | null;
  }) => {
    if (checkpoint.backfillState === InboxBackfillState.COMPLETE) {
      return null;
    }

    if (checkpoint.lastBackfillCursor?.startsWith('backfill:')) {
      const pageToken = checkpoint.lastBackfillCursor.slice('backfill:'.length);
      return { phase: 'backfill' as const, ...(pageToken ? { pageToken } : {}) };
    }

    if (checkpoint.lastBackfillCursor?.startsWith('seed:')) {
      const pageToken = checkpoint.lastBackfillCursor.slice('seed:'.length);
      return { phase: 'seed' as const, ...(pageToken ? { pageToken } : {}) };
    }

    if (checkpoint.backfillState === InboxBackfillState.BACKFILLING) {
      return { phase: 'backfill' as const };
    }

    return { phase: 'seed' as const };
  },
}));

const { runInboxMailboxBackfill, INBOX_SEARCH_BACKFILL_QUERY } = await import(
  '@/lib/services/inbox-search/backfill'
);

function makeEmail(partial?: Partial<EmailData>): EmailData {
  return {
    messageId: partial?.messageId ?? 'msg-1',
    from: partial?.from ?? 'sender@example.com',
    to: partial?.to ?? ['user@example.com'],
    cc: partial?.cc ?? [],
    subject: partial?.subject ?? 'Subject',
    body: partial?.body ?? 'Body',
    snippet: partial?.snippet ?? 'Snippet',
    isSent: partial?.isSent ?? false,
    isDraft: partial?.isDraft ?? false,
    date: partial?.date ?? new Date('2026-02-01T00:00:00.000Z'),
    hasAttachments: partial?.hasAttachments ?? false,
    gmailThreadId: partial?.gmailThreadId ?? 'thread-1',
    labelIds: partial?.labelIds,
    gmailCategories: partial?.gmailCategories,
  };
}

describe('runInboxMailboxBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkpointMocks.getOrCreateInboxSearchCheckpoint.mockResolvedValue({
      backfillState: InboxBackfillState.PENDING,
      lastBackfillCursor: null,
      lastIndexedAt: null,
    });
    checkpointMocks.saveInboxBackfillProgress.mockResolvedValue(undefined);
    checkpointMocks.markInboxBackfillPausedAuthRevoked.mockResolvedValue(undefined);
    checkpointMocks.markInboxBackfillComplete.mockResolvedValue(undefined);
  });

  test('pauses checkpoint when Gmail auth is revoked before backfill starts', async () => {
    const createGmailClient = vi.fn().mockResolvedValue({
      gmail: {
        ensureAuthenticated: vi.fn().mockRejectedValue({ status: 401 }),
      },
    });

    const result = await runInboxMailboxBackfill(
      {
        userId: 'user-1',
        mailboxId: 'mailbox-1',
      },
      {
        createGmailClient,
        indexEmail: vi.fn(),
        sleep: vi.fn(),
      },
    );

    expect(result.status).toBe('paused_auth_revoked');
    expect(result.backfillState).toBe(InboxBackfillState.PAUSED_AUTH_REVOKED);
    expect(checkpointMocks.markInboxBackfillPausedAuthRevoked).toHaveBeenCalledWith({
      userId: 'user-1',
      mailboxId: 'mailbox-1',
      phase: 'seed',
      pageToken: null,
      lastIndexedAt: null,
    });
  });

  test('resumes from saved backfill cursor and completes with skipped overlap counted', async () => {
    checkpointMocks.getOrCreateInboxSearchCheckpoint.mockResolvedValue({
      backfillState: InboxBackfillState.BACKFILLING,
      lastBackfillCursor: 'backfill:cursor-2',
      lastIndexedAt: null,
    });

    const searchThreadsPaged = vi.fn().mockResolvedValue({
      threads: [
        {
          threadId: 'thread-1',
          emails: [
            makeEmail({ messageId: 'msg-1' }),
            makeEmail({ messageId: 'msg-2', subject: 'Follow up' }),
          ],
        },
      ],
      nextPageToken: undefined,
    });

    const indexEmail = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'indexed',
        documentId: 'doc-1',
        chunkCount: 1,
        contentHash: 'hash-1',
      })
      .mockResolvedValueOnce({
        status: 'skipped_unchanged',
        documentId: 'doc-2',
        chunkCount: 0,
        contentHash: 'hash-2',
      });

    const result = await runInboxMailboxBackfill(
      {
        userId: 'user-1',
        mailboxId: 'mailbox-1',
      },
      {
        createGmailClient: vi.fn().mockResolvedValue({
          gmail: {
            ensureAuthenticated: vi.fn().mockResolvedValue(undefined),
            searchThreadsPaged,
          },
        }),
        indexEmail,
        sleep: vi.fn(),
      },
    );

    expect(searchThreadsPaged).toHaveBeenCalledWith(INBOX_SEARCH_BACKFILL_QUERY, {
      maxResults: 20,
      pageToken: 'cursor-2',
    });
    expect(result).toMatchObject({
      status: 'complete',
      startedFrom: 'backfill',
      backfillState: InboxBackfillState.COMPLETE,
      pagesProcessed: 1,
      emailsSeen: 2,
      indexedCount: 1,
      skippedCount: 1,
    });
    expect(checkpointMocks.markInboxBackfillComplete).toHaveBeenCalledTimes(1);
  });
});
