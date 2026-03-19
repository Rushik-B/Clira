import { beforeEach, describe, expect, test, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  emailFindMany: vi.fn(),
  inboxSearchDocumentFindMany: vi.fn(),
  mailboxFindFirst: vi.fn(),
  mailboxFindMany: vi.fn(),
}));

const gmailMocks = vi.hoisted(() => ({
  createGmailServiceForUser: vi.fn(),
}));

const contentIngestionMocks = vi.hoisted(() => ({
  extractContentFromBuffer: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    email: {
      findMany: prismaMocks.emailFindMany,
    },
    inboxSearchDocument: {
      findMany: prismaMocks.inboxSearchDocumentFindMany,
    },
    mailbox: {
      findFirst: prismaMocks.mailboxFindFirst,
      findMany: prismaMocks.mailboxFindMany,
    },
  },
}));

vi.mock('@/lib/security/getUserGmailCredentials', () => ({
  createGmailServiceForUser: gmailMocks.createGmailServiceForUser,
}));

vi.mock('@/lib/services/content-ingestion', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/content-ingestion')>(
    '@/lib/services/content-ingestion',
  );

  return {
    ...actual,
    extractContentFromBuffer: contentIngestionMocks.extractContentFromBuffer,
  };
});

import { extractContentFromBuffer } from '@/lib/services/content-ingestion';
import { readEmailAttachmentContent } from '@/lib/services/inbox-search/read-email-attachment-content';

function createExtractionResult(params: {
  extractedText: string;
  mediaFamily: 'pdf' | 'text' | 'office_doc' | 'spreadsheet';
  filename: string;
  mimeType: string;
  attachmentId: string;
}) {
  return {
    status: 'ok' as const,
    mediaFamily: params.mediaFamily,
    extractedText: params.extractedText,
    images: [],
    structuredData: null,
    degradationNotes: [],
    attribution: {
      filename: params.filename,
      mimeType: params.mimeType,
      sniffedMimeType: params.mimeType,
      sha256: 'sha-1',
      provenance: {
        sourceLabel: 'Gmail email attachment',
        sourceKind: 'gmail_attachment',
        channel: 'gmail',
        conversationId: null,
        runId: null,
        messageId: 'message-1',
        attachmentId: params.attachmentId,
        originUri: null,
      },
    },
    tokenCost: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
    extractionDurationMs: 12,
    cacheKey: 'cache-key',
    cacheStatus: 'miss' as const,
    handlerVersion: 'handler-v1',
    budget: {
      scopeKey: null,
      maxExtractions: 5,
      attemptsUsed: 1,
      totalTokens: 15,
      totalDurationMs: 12,
    },
    metadata: {
      sizeBytes: 2048,
      declaredMimeType: params.mimeType,
      pageCountEstimate: null,
      audioDurationSeconds: null,
    },
  };
}

function createGmailContext(params: {
  filename: string;
  mimeType: string;
  attachmentId?: string;
  attachmentData?: string;
  extraParts?: Array<Record<string, unknown>>;
}) {
  const attachmentId = params.attachmentId ?? 'att-1';
  const messagesGet = vi.fn().mockResolvedValue({
    data: {
      id: 'message-1',
      threadId: 'thread-1',
      internalDate: '1710000000000',
      payload: {
        headers: [
          { name: 'Subject', value: 'Attachment included' },
          { name: 'From', value: 'Alice <alice@example.com>' },
        ],
        parts: [
          {
            partId: '1',
            mimeType: params.mimeType,
            filename: params.filename,
            body: {
              attachmentId,
              size: 2048,
            },
          },
          ...(params.extraParts ?? []),
        ],
      },
    },
  });
  const attachmentsGet = vi.fn().mockResolvedValue({
    data: {
      data: params.attachmentData ?? Buffer.from(`${params.filename}-bytes`).toString('base64url'),
    },
  });

  return {
    gmail: {
      ensureAuthenticated: vi.fn().mockResolvedValue(undefined),
      getNativeGmailClient: vi.fn(() => ({
        users: {
          messages: {
            get: messagesGet,
            attachments: {
              get: attachmentsGet,
            },
          },
        },
      })),
    },
    __attachmentsGet: attachmentsGet,
  };
}

describe('readEmailAttachmentContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMocks.emailFindMany.mockResolvedValue([
      {
        mailboxId: 'mailbox-1',
        mailbox: {
          emailAddress: 'user@example.com',
        },
      },
    ]);
    prismaMocks.inboxSearchDocumentFindMany.mockResolvedValue([]);
    prismaMocks.mailboxFindFirst.mockResolvedValue({
      id: 'mailbox-1',
      emailAddress: 'user@example.com',
    });
    prismaMocks.mailboxFindMany.mockResolvedValue([
      {
        id: 'mailbox-1',
        emailAddress: 'user@example.com',
      },
    ]);
  });

  test.each([
    {
      kind: 'docx',
      filename: 'syllabus.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      mediaFamily: 'office_doc' as const,
      extractedText: 'Office hours are Friday.',
    },
    {
      kind: 'xlsx',
      filename: 'grades.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      mediaFamily: 'spreadsheet' as const,
      extractedText: 'Sheet 1:\nStudent,Score\nAva,98',
    },
    {
      kind: 'csv',
      filename: 'totals.csv',
      mimeType: 'text/csv',
      mediaFamily: 'spreadsheet' as const,
      extractedText: 'month,total\nmarch,400',
    },
    {
      kind: 'txt',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      mediaFamily: 'text' as const,
      extractedText: 'Bring passport to the appointment.',
    },
    {
      kind: 'txt',
      filename: 'invite.ics',
      mimeType: 'text/calendar',
      mediaFamily: 'text' as const,
      extractedText: 'BEGIN:VCALENDAR\nURL:https://meet.google.com/abc-defg-hij\nEND:VCALENDAR',
    },
  ])('extracts a supported $kind email attachment', async ({ kind, filename, mimeType, mediaFamily, extractedText }) => {
    const gmailContext = createGmailContext({
      filename,
      mimeType,
    });
    gmailMocks.createGmailServiceForUser.mockResolvedValue(gmailContext);
    contentIngestionMocks.extractContentFromBuffer.mockResolvedValue(
      createExtractionResult({
        extractedText,
        mediaFamily,
        filename,
        mimeType,
        attachmentId: 'att-1',
      }),
    );

    const result = await readEmailAttachmentContent({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(gmailMocks.createGmailServiceForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'executive-agent:read-email-attachment-content',
        requester: 'executiveAgent.read_email_attachment_content',
      }),
    );
    expect(extractContentFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType,
        filename,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'ok',
      attachment: {
        attachmentId: 'att-1',
        filename,
        mimeType,
        kind,
      },
      availableAttachments: [
        expect.objectContaining({
          filename,
          kind,
        }),
      ],
      extractedText,
      contentRefs: [
        expect.objectContaining({
          displayName: filename,
          mimeHint: mimeType,
        }),
      ],
    });
  });

  test('returns a disambiguation result when an email has multiple supported attachments', async () => {
    const gmailContext = createGmailContext({
      filename: 'grades.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extraParts: [
        {
          partId: '2',
          mimeType: 'text/plain',
          filename: 'notes.txt',
          body: {
            attachmentId: 'att-2',
            size: 128,
          },
        },
      ],
    });
    gmailMocks.createGmailServiceForUser.mockResolvedValue(gmailContext);

    const result = await readEmailAttachmentContent({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(extractContentFromBuffer).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      status: 'multiple_supported_attachments',
      message: 'This email has multiple supported attachments. Call again with attachmentId or attachmentFilename.',
      retryable: false,
      messageContext: {
        messageId: 'message-1',
        threadId: 'thread-1',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        subject: 'Attachment included',
        from: 'Alice <alice@example.com>',
        sentAt: '2024-03-09T16:00:00.000Z',
      },
      availableAttachments: [
        {
          attachmentId: 'att-1',
          filename: 'grades.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 2048,
          kind: 'xlsx',
        },
        {
          attachmentId: 'att-2',
          filename: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 128,
          kind: 'txt',
        },
      ],
    });
  });
});
