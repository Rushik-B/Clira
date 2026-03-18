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

import { readEmailPdfAttachment } from '@/lib/services/inbox-search/read-email-pdf-attachment';
import { extractContentFromBuffer } from '@/lib/services/content-ingestion';

function createExtractionResult(extractedText: string) {
  return {
    status: 'ok' as const,
    mediaFamily: 'pdf' as const,
    extractedText,
    images: [],
    structuredData: null,
    degradationNotes: [],
    attribution: {
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sniffedMimeType: 'application/pdf',
      sha256: 'sha-1',
      provenance: {
        sourceLabel: 'Gmail email attachment',
        sourceKind: 'gmail_attachment',
        channel: 'gmail',
        conversationId: null,
        runId: null,
        messageId: 'message-1',
        attachmentId: 'att-1',
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
    handlerVersion: 'pdf-v1',
    budget: {
      scopeKey: null,
      maxExtractions: 5,
      attemptsUsed: 1,
      totalTokens: 15,
      totalDurationMs: 12,
    },
    metadata: {
      sizeBytes: 2048,
      declaredMimeType: 'application/pdf',
      pageCountEstimate: 1,
      audioDurationSeconds: null,
    },
  };
}

function createGmailContext(options?: {
  rawMessage?: Record<string, unknown>;
  attachmentData?: string;
}) {
  const messagesGet = vi.fn().mockResolvedValue({
    data: options?.rawMessage ?? {
      id: 'message-1',
      threadId: 'thread-1',
      internalDate: '1710000000000',
      payload: {
        headers: [
          { name: 'Subject', value: 'Invoice attached' },
          { name: 'From', value: 'Alice <alice@example.com>' },
        ],
        parts: [
          {
            partId: '1',
            mimeType: 'application/pdf',
            filename: 'invoice.pdf',
            body: {
              attachmentId: 'att-1',
              size: 2048,
            },
          },
        ],
      },
    },
  });
  const attachmentsGet = vi.fn().mockResolvedValue({
    data: {
      data: options?.attachmentData ?? Buffer.from('pdf-bytes').toString('base64url'),
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
    __messagesGet: messagesGet,
    __attachmentsGet: attachmentsGet,
  };
}

describe('readEmailPdfAttachment', () => {
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
    contentIngestionMocks.extractContentFromBuffer.mockResolvedValue(
      createExtractionResult(
        [
          'Invoice for March',
          'Account: ACME Co.',
          'Total due: $400',
        ].join('\n'),
      ),
    );
  });

  test('resolves the mailbox from the stored email and extracts a single PDF attachment', async () => {
    const gmailContext = createGmailContext();
    gmailMocks.createGmailServiceForUser.mockResolvedValue(gmailContext);

    const result = await readEmailPdfAttachment({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(gmailMocks.createGmailServiceForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        mailboxId: 'mailbox-1',
        purpose: 'executive-agent:read-email-pdf-attachment',
      }),
    );
    expect(extractContentFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('pdf-bytes'),
        mimeType: 'application/pdf',
        channelLabel: 'Gmail email attachment',
        filename: 'invoice.pdf',
        provenance: expect.objectContaining({
          sourceLabel: 'Gmail email attachment',
          sourceKind: 'gmail_attachment',
          channel: 'gmail',
          messageId: 'message-1',
          attachmentId: 'att-1',
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      status: 'ok',
      message: {
        messageId: 'message-1',
        threadId: 'thread-1',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        subject: 'Invoice attached',
        from: 'Alice <alice@example.com>',
        sentAt: '2024-03-09T16:00:00.000Z',
      },
      mailboxResolutionSource: 'stored_email',
      attachment: {
        attachmentId: 'att-1',
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
      availablePdfAttachments: [
        {
          attachmentId: 'att-1',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        },
      ],
      extractedText: 'Invoice for March\nAccount: ACME Co.\nTotal due: $400',
      contentRefs: [
        expect.objectContaining({
          sourceKind: 'stored_content',
          displayName: 'invoice.pdf',
          mimeHint: 'application/pdf',
          trustClass: 'trusted_internal',
        }),
      ],
    });
  });

  test('surfaces degraded extraction notes through the shared ingestion renderer', async () => {
    const gmailContext = createGmailContext();
    gmailMocks.createGmailServiceForUser.mockResolvedValue(gmailContext);
    contentIngestionMocks.extractContentFromBuffer.mockResolvedValueOnce({
      ...createExtractionResult(''),
      status: 'degraded',
      degradationNotes: [
        {
          code: 'size_limit_exceeded',
          message: 'Extraction skipped because this pdf exceeds the 10 MB limit.',
        },
      ],
    });

    const result = await readEmailPdfAttachment({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'ok',
      extractedText:
        '[Content extraction degraded] Extraction skipped because this pdf exceeds the 10 MB limit.',
    });
  });

  test('returns an explicit disambiguation result when the email has multiple PDF attachments', async () => {
    const gmailContext = createGmailContext({
      rawMessage: {
        id: 'message-1',
        threadId: 'thread-1',
        internalDate: '1710000000000',
        payload: {
          headers: [
            { name: 'Subject', value: 'Two PDFs attached' },
            { name: 'From', value: 'Alice <alice@example.com>' },
          ],
          parts: [
            {
              partId: '1',
              mimeType: 'application/pdf',
              filename: 'invoice.pdf',
              body: {
                attachmentId: 'att-1',
                size: 2048,
              },
            },
            {
              partId: '2',
              mimeType: 'application/pdf',
              filename: 'statement.pdf',
              body: {
                attachmentId: 'att-2',
                size: 4096,
              },
            },
          ],
        },
      },
    });
    gmailMocks.createGmailServiceForUser.mockResolvedValue(gmailContext);

    const result = await readEmailPdfAttachment({
      userId: 'user-1',
      messageId: 'message-1',
    });

    expect(extractContentFromBuffer).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      status: 'multiple_pdf_attachments',
      message: 'This email has multiple PDF attachments. Call again with attachmentId or attachmentFilename.',
      retryable: false,
      messageContext: {
        messageId: 'message-1',
        threadId: 'thread-1',
        mailboxId: 'mailbox-1',
        mailboxEmail: 'user@example.com',
        subject: 'Two PDFs attached',
        from: 'Alice <alice@example.com>',
        sentAt: '2024-03-09T16:00:00.000Z',
      },
      availablePdfAttachments: [
        {
          attachmentId: 'att-1',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        },
        {
          attachmentId: 'att-2',
          filename: 'statement.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
        },
      ],
    });
  });

  test('supports deterministic attachment selection by filename', async () => {
    const gmailContext = createGmailContext({
      rawMessage: {
        id: 'message-1',
        threadId: 'thread-1',
        internalDate: '1710000000000',
        payload: {
          headers: [
            { name: 'Subject', value: 'Two PDFs attached' },
            { name: 'From', value: 'Alice <alice@example.com>' },
          ],
          parts: [
            {
              partId: '1',
              mimeType: 'application/pdf',
              filename: 'invoice.pdf',
              body: {
                attachmentId: 'att-1',
                size: 2048,
              },
            },
            {
              partId: '2',
              mimeType: 'application/pdf',
              filename: 'statement.pdf',
              body: {
                attachmentId: 'att-2',
                size: 4096,
              },
            },
          ],
        },
      },
    });
    gmailMocks.createGmailServiceForUser.mockResolvedValue(gmailContext);

    const result = await readEmailPdfAttachment({
      userId: 'user-1',
      messageId: 'message-1',
      attachmentFilename: 'statement.pdf',
    });

    expect(gmailContext.__attachmentsGet).toHaveBeenCalledWith({
      userId: 'me',
      messageId: 'message-1',
      id: 'att-2',
    });
    expect(result).toMatchObject({
      ok: true,
      status: 'ok',
      attachment: {
        attachmentId: 'att-2',
        filename: 'statement.pdf',
      },
    });
  });
});
