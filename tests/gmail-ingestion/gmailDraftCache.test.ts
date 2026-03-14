import { beforeEach, describe, expect, test, vi } from 'vitest';

const gmailMocks = vi.hoisted(() => ({
  draftsGet: vi.fn(),
  draftsSend: vi.fn(),
  draftsDelete: vi.fn(),
  draftsUpdate: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class OAuth2Mock {
        credentials: Record<string, unknown> = {};

        constructor(..._args: unknown[]) {}

        setCredentials(credentials: Record<string, unknown>) {
          this.credentials = credentials;
        }

        async refreshAccessToken() {
          return { credentials: {} };
        }
      },
    },
    gmail: () => ({
      users: {
        getProfile: gmailMocks.getProfile,
        drafts: {
          get: gmailMocks.draftsGet,
          send: gmailMocks.draftsSend,
          delete: gmailMocks.draftsDelete,
          update: gmailMocks.draftsUpdate,
        },
      },
    }),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthAccount: {
      updateMany: vi.fn(),
    },
  },
}));

const { GmailService } = await import('@/lib/email/gmail');

function encodeBody(body: string): string {
  return Buffer.from(body, 'utf-8').toString('base64');
}

function buildDraftResponse(draftId: string, messageId: string, threadId: string, body: string) {
  return {
    data: {
      id: draftId,
      message: {
        id: messageId,
        threadId,
        snippet: body,
        labelIds: [],
        payload: {
          headers: [
            { name: 'From', value: 'Sender <sender@example.com>' },
            { name: 'To', value: 'user@example.com' },
            { name: 'Subject', value: 'Re: Queue item' },
            { name: 'Date', value: 'Sat, 14 Mar 2026 10:00:00 +0000' },
          ],
          body: {
            data: encodeBody(body),
          },
        },
      },
    },
  };
}

describe('GmailService draft cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gmailMocks.getProfile.mockResolvedValue({ data: {} });
  });

  test('evicts cached drafts after sendDraft so a later getDraft misses cache', async () => {
    gmailMocks.draftsGet
      .mockResolvedValueOnce(buildDraftResponse('draft-send', 'message-send', 'thread-send', 'Body before send'))
      .mockRejectedValueOnce({ code: 404 });
    gmailMocks.draftsSend.mockResolvedValue({
      data: {
        id: 'sent-1',
        threadId: 'thread-send',
      },
    });

    const gmail = new GmailService('token', 'refresh', 'user-send', 'mailbox-1');

    const cached = await gmail.getDraft('draft-send');
    const cachedAgain = await gmail.getDraft('draft-send');

    expect(cached?.body).toContain('Body before send');
    expect(cachedAgain?.body).toContain('Body before send');
    expect(gmailMocks.draftsGet).toHaveBeenCalledTimes(1);

    await gmail.sendDraft('draft-send');

    const missingAfterSend = await gmail.getDraft('draft-send');
    expect(missingAfterSend).toBeNull();
    expect(gmailMocks.draftsGet).toHaveBeenCalledTimes(2);
  });

  test('evicts cached drafts after deleteDraft, including 404 deletes', async () => {
    gmailMocks.draftsGet
      .mockResolvedValueOnce(buildDraftResponse('draft-delete', 'message-delete', 'thread-delete', 'Body before delete'))
      .mockRejectedValueOnce({ code: 404 });
    gmailMocks.draftsDelete.mockRejectedValue({ code: 404 });

    const gmail = new GmailService('token', 'refresh', 'user-delete', 'mailbox-1');

    const cached = await gmail.getDraft('draft-delete');
    const cachedAgain = await gmail.getDraft('draft-delete');

    expect(cached?.body).toContain('Body before delete');
    expect(cachedAgain?.body).toContain('Body before delete');
    expect(gmailMocks.draftsGet).toHaveBeenCalledTimes(1);

    await expect(gmail.deleteDraft('draft-delete')).rejects.toEqual({ code: 404 });

    const missingAfterDelete = await gmail.getDraft('draft-delete');
    expect(missingAfterDelete).toBeNull();
    expect(gmailMocks.draftsGet).toHaveBeenCalledTimes(2);
  });
});
