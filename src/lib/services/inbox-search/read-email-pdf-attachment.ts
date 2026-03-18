import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import type { AiTraceContext } from '@/lib/ai/tracing';
import {
  buildInlineBufferProvenance,
  extractContentFromBuffer,
  renderContentExtractionForLegacyText,
} from '@/lib/services/content-ingestion';

type GmailHeader = {
  name?: string | null;
  value?: string | null;
};

type GmailMessagePartBody = {
  attachmentId?: string | null;
  data?: string | null;
  size?: number | null;
};

type GmailMessagePart = {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailHeader[] | null;
  body?: GmailMessagePartBody | null;
  parts?: GmailMessagePart[] | null;
};

type GmailRawMessage = {
  id?: string | null;
  threadId?: string | null;
  internalDate?: string | null;
  payload?: GmailMessagePart | null;
};

type GmailAttachmentApiResponse = {
  data?: string | null;
  size?: number | null;
};

type ResolvedMailbox = {
  mailboxId: string;
  mailboxEmail: string | null;
  resolutionSource:
    | 'explicit_mailbox_id'
    | 'explicit_mailbox_email'
    | 'stored_email'
    | 'inbox_search_document'
    | 'single_connected_mailbox_fallback';
};

type StoredMessageMailboxCandidate = {
  mailboxId: string;
  mailboxEmail: string | null;
};

type InternalPdfAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  inlineData: string | null;
};

export type EmailPdfAttachmentCandidate = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type ReadEmailPdfAttachmentResult =
  | {
      ok: true;
      status: 'ok';
      message: {
        messageId: string;
        threadId: string | null;
        mailboxId: string;
        mailboxEmail: string | null;
        subject: string | null;
        from: string | null;
        sentAt: string | null;
      };
      mailboxResolutionSource: ResolvedMailbox['resolutionSource'];
      attachment: EmailPdfAttachmentCandidate;
      availablePdfAttachments: EmailPdfAttachmentCandidate[];
      extractedText: string;
    }
  | {
      ok: false;
      status:
        | 'invalid_request'
        | 'gmail_unavailable'
        | 'mailbox_resolution_failed'
        | 'message_not_found'
        | 'message_fetch_failed'
        | 'no_pdf_attachments'
        | 'attachment_not_found'
        | 'multiple_pdf_attachments'
        | 'attachment_fetch_failed'
        | 'pdf_extraction_failed';
      message: string;
      retryable: boolean;
      messageContext?: {
        messageId: string;
        threadId?: string | null;
        mailboxId?: string;
        mailboxEmail?: string | null;
        subject?: string | null;
        from?: string | null;
        sentAt?: string | null;
      };
      availableMailboxes?: Array<{
        mailboxId: string;
        mailboxEmail: string | null;
      }>;
      availablePdfAttachments?: EmailPdfAttachmentCandidate[];
    };

type ReadEmailPdfAttachmentArgs = {
  userId: string;
  messageId: string;
  mailboxId?: string;
  mailboxEmail?: string;
  attachmentId?: string;
  attachmentFilename?: string;
  abortSignal?: AbortSignal;
  traceContext?: AiTraceContext;
};

function normalizeFilename(value: string | undefined | null): string {
  return value?.trim() || 'unnamed.pdf';
}

function normalizeBase64Url(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64url');
}

function readErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && Number.isFinite(status)) return status;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number' && Number.isFinite(code)) return code;
  return null;
}

function isRetryableGmailError(error: unknown): boolean {
  const statusCode = readErrorStatusCode(error);
  if (statusCode === 429) return true;
  if (statusCode !== null && statusCode >= 500) return true;

  if (error instanceof Error) {
    return /rate limit|quota|temporar|timeout|econnreset|unavailable/i.test(error.message);
  }

  return false;
}

function isPdfPart(part: GmailMessagePart | null | undefined): boolean {
  if (!part) return false;
  const mimeType = part.mimeType?.trim().toLowerCase();
  const filename = part.filename?.trim().toLowerCase();
  return mimeType === 'application/pdf' || Boolean(filename?.endsWith('.pdf'));
}

function collectPdfAttachments(
  part: GmailMessagePart | null | undefined,
  attachments: InternalPdfAttachment[],
): void {
  if (!part) return;

  if (isPdfPart(part)) {
    const attachmentId = part.body?.attachmentId?.trim();
    const inlineData = part.body?.data?.trim() ?? null;
    const syntheticId = attachmentId || `inline:${part.partId ?? attachments.length + 1}`;
    attachments.push({
      attachmentId: syntheticId,
      filename: normalizeFilename(part.filename),
      mimeType: part.mimeType?.trim() || 'application/pdf',
      sizeBytes: typeof part.body?.size === 'number' ? part.body.size : null,
      inlineData,
    });
  }

  for (const child of part.parts ?? []) {
    collectPdfAttachments(child, attachments);
  }
}

function toPublicAttachment(
  attachment: InternalPdfAttachment,
): EmailPdfAttachmentCandidate {
  return {
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}

function getHeaderValue(headers: GmailHeader[] | null | undefined, name: string): string | null {
  const normalized = name.trim().toLowerCase();
  for (const header of headers ?? []) {
    if (header?.name?.trim().toLowerCase() === normalized) {
      return header.value?.trim() || null;
    }
  }
  return null;
}

async function resolveMailboxForMessage(
  params: Pick<ReadEmailPdfAttachmentArgs, 'userId' | 'messageId' | 'mailboxId' | 'mailboxEmail'>,
): Promise<
  | { ok: true; mailbox: ResolvedMailbox }
  | {
      ok: false;
      result: Extract<ReadEmailPdfAttachmentResult, { ok: false }>;
    }
> {
  if (params.mailboxId) {
    const mailbox = await prisma.mailbox.findFirst({
      where: {
        id: params.mailboxId,
        userId: params.userId,
      },
      select: {
        id: true,
        emailAddress: true,
      },
    });

    if (!mailbox) {
      return {
        ok: false,
        result: {
          ok: false,
          status: 'mailbox_resolution_failed',
          message: 'Mailbox not found for this user.',
          retryable: false,
          messageContext: {
            messageId: params.messageId,
            mailboxId: params.mailboxId,
          },
        },
      };
    }

    return {
      ok: true,
      mailbox: {
        mailboxId: mailbox.id,
        mailboxEmail: mailbox.emailAddress,
        resolutionSource: 'explicit_mailbox_id',
      },
    };
  }

  if (params.mailboxEmail) {
    const mailbox = await prisma.mailbox.findFirst({
      where: {
        userId: params.userId,
        emailAddress: params.mailboxEmail.trim().toLowerCase(),
      },
      select: {
        id: true,
        emailAddress: true,
      },
    });

    if (!mailbox) {
      return {
        ok: false,
        result: {
          ok: false,
          status: 'mailbox_resolution_failed',
          message: 'Mailbox email not found for this user.',
          retryable: false,
          messageContext: {
            messageId: params.messageId,
            mailboxEmail: params.mailboxEmail.trim().toLowerCase(),
          },
        },
      };
    }

    return {
      ok: true,
      mailbox: {
        mailboxId: mailbox.id,
        mailboxEmail: mailbox.emailAddress,
        resolutionSource: 'explicit_mailbox_email',
      },
    };
  }

  const storedEmailMatches = await prisma.email.findMany({
    where: {
      messageId: params.messageId,
      thread: {
        userId: params.userId,
      },
      mailboxId: {
        not: null,
      },
    },
    select: {
      mailboxId: true,
      mailbox: {
        select: {
          emailAddress: true,
        },
      },
    },
    take: 5,
  });

  const storedMailboxCandidates = dedupeMailboxCandidates(
    storedEmailMatches.flatMap((match) => {
      if (typeof match.mailboxId !== 'string' || match.mailboxId.length === 0) {
        return [];
      }

      return [{
        mailboxId: match.mailboxId,
        mailboxEmail: match.mailbox?.emailAddress ?? null,
      }];
    }),
  );

  if (storedMailboxCandidates.length === 1) {
    return {
      ok: true,
      mailbox: {
        ...storedMailboxCandidates[0]!,
        resolutionSource: 'stored_email',
      },
    };
  }

  if (storedMailboxCandidates.length > 1) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'mailbox_resolution_failed',
        message: 'This message ID exists in multiple mailboxes. Call the tool again with mailboxId or mailboxEmail.',
        retryable: false,
        messageContext: {
          messageId: params.messageId,
        },
        availableMailboxes: storedMailboxCandidates,
      },
    };
  }

  const inboxSearchMatches = await prisma.inboxSearchDocument.findMany({
    where: {
      userId: params.userId,
      messageId: params.messageId,
    },
    select: {
      mailboxId: true,
      mailbox: {
        select: {
          emailAddress: true,
        },
      },
    },
    take: 5,
  });

  const inboxMailboxCandidates = dedupeMailboxCandidates(
    inboxSearchMatches.flatMap((match) => {
      if (typeof match.mailboxId !== 'string' || match.mailboxId.length === 0) {
        return [];
      }

      return [{
        mailboxId: match.mailboxId,
        mailboxEmail: match.mailbox.emailAddress,
      }];
    }),
  );

  if (inboxMailboxCandidates.length === 1) {
    return {
      ok: true,
      mailbox: {
        ...inboxMailboxCandidates[0]!,
        resolutionSource: 'inbox_search_document',
      },
    };
  }

  if (inboxMailboxCandidates.length > 1) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'mailbox_resolution_failed',
        message: 'This message ID exists in multiple indexed mailboxes. Call the tool again with mailboxId or mailboxEmail.',
        retryable: false,
        messageContext: {
          messageId: params.messageId,
        },
        availableMailboxes: inboxMailboxCandidates,
      },
    };
  }

  const connectedMailboxes = await prisma.mailbox.findMany({
    where: {
      userId: params.userId,
      status: 'CONNECTED',
    },
    select: {
      id: true,
      emailAddress: true,
    },
    take: 2,
  });

  if (connectedMailboxes.length === 1) {
    return {
      ok: true,
      mailbox: {
        mailboxId: connectedMailboxes[0]!.id,
        mailboxEmail: connectedMailboxes[0]!.emailAddress,
        resolutionSource: 'single_connected_mailbox_fallback',
      },
    };
  }

  return {
    ok: false,
    result: {
      ok: false,
      status: 'mailbox_resolution_failed',
      message: 'Could not determine which mailbox owns this message. Locate the email first, then call again with mailboxId or mailboxEmail.',
      retryable: false,
      messageContext: {
        messageId: params.messageId,
      },
      availableMailboxes: connectedMailboxes.map((mailbox) => ({
        mailboxId: mailbox.id,
        mailboxEmail: mailbox.emailAddress,
      })),
    },
  };
}

function dedupeMailboxCandidates(
  candidates: StoredMessageMailboxCandidate[],
): StoredMessageMailboxCandidate[] {
  const unique = new Map<string, StoredMessageMailboxCandidate>();
  for (const candidate of candidates) {
    unique.set(candidate.mailboxId, candidate);
  }
  return [...unique.values()];
}

function selectAttachment(params: {
  attachments: InternalPdfAttachment[];
  attachmentId?: string;
  attachmentFilename?: string;
}):
  | { ok: true; attachment: InternalPdfAttachment }
  | {
      ok: false;
      result: Extract<ReadEmailPdfAttachmentResult, { ok: false }>;
    } {
  const { attachments } = params;
  const publicAttachments = attachments.map(toPublicAttachment);

  if (attachments.length === 0) {
    return {
      ok: false,
      result: {
        ok: false,
        status: 'no_pdf_attachments',
        message: 'This email does not have any PDF attachments.',
        retryable: false,
        availablePdfAttachments: [],
      },
    };
  }

  if (params.attachmentId) {
    const match = attachments.find((attachment) => attachment.attachmentId === params.attachmentId);
    if (!match) {
      return {
        ok: false,
        result: {
          ok: false,
          status: 'attachment_not_found',
          message: 'The requested PDF attachmentId was not found on this email.',
          retryable: false,
          availablePdfAttachments: publicAttachments,
        },
      };
    }
    return { ok: true, attachment: match };
  }

  const requestedFilename = params.attachmentFilename?.trim();
  if (requestedFilename) {
    const exactCaseSensitive = attachments.filter(
      (attachment) => attachment.filename === requestedFilename,
    );
    if (exactCaseSensitive.length === 1) {
      return { ok: true, attachment: exactCaseSensitive[0]! };
    }

    const normalizedRequested = requestedFilename.toLowerCase();
    const exactCaseInsensitive = attachments.filter(
      (attachment) => attachment.filename.toLowerCase() === normalizedRequested,
    );
    if (exactCaseInsensitive.length === 1) {
      return { ok: true, attachment: exactCaseInsensitive[0]! };
    }

    const substringMatches = attachments.filter((attachment) =>
      attachment.filename.toLowerCase().includes(normalizedRequested),
    );
    if (substringMatches.length === 1) {
      return { ok: true, attachment: substringMatches[0]! };
    }

    return {
      ok: false,
      result: {
        ok: false,
        status: substringMatches.length > 1 ? 'multiple_pdf_attachments' : 'attachment_not_found',
        message:
          substringMatches.length > 1
            ? 'Multiple PDF attachments match that filename. Call again with attachmentId or a more specific attachmentFilename.'
            : 'No PDF attachment matched that filename on this email.',
        retryable: false,
        availablePdfAttachments: publicAttachments,
      },
    };
  }

  if (attachments.length === 1) {
    return { ok: true, attachment: attachments[0]! };
  }

  return {
    ok: false,
    result: {
      ok: false,
      status: 'multiple_pdf_attachments',
      message: 'This email has multiple PDF attachments. Call again with attachmentId or attachmentFilename.',
      retryable: false,
      availablePdfAttachments: publicAttachments,
    },
  };
}

function buildMessageContext(
  params: {
    messageId: string;
    mailbox: ResolvedMailbox;
    rawMessage: GmailRawMessage;
  },
) {
  const headers = params.rawMessage.payload?.headers ?? [];
  const internalDate = params.rawMessage.internalDate
    ? Number.parseInt(params.rawMessage.internalDate, 10)
    : Number.NaN;

  return {
    messageId: params.messageId,
    threadId: params.rawMessage.threadId ?? null,
    mailboxId: params.mailbox.mailboxId,
    mailboxEmail: params.mailbox.mailboxEmail,
    subject: getHeaderValue(headers, 'Subject'),
    from: getHeaderValue(headers, 'From'),
    sentAt: Number.isFinite(internalDate) ? new Date(internalDate).toISOString() : null,
  };
}

export async function readEmailPdfAttachment(
  params: ReadEmailPdfAttachmentArgs,
): Promise<ReadEmailPdfAttachmentResult> {
  const mailboxResolution = await resolveMailboxForMessage(params);
  if (!mailboxResolution.ok) {
    logger.info('[readEmailPdfAttachment] mailbox resolution failed', {
      userId: params.userId,
      messageId: params.messageId,
      status: mailboxResolution.result.status,
    });
    return mailboxResolution.result;
  }

  const mailbox = mailboxResolution.mailbox;
  const gmailContext = await createGmailServiceForUser({
    userId: params.userId,
    mailboxId: mailbox.mailboxId,
    purpose: 'executive-agent:read-email-pdf-attachment',
    requester: 'executiveAgent.read_email_pdf_attachment',
  });

  if (!gmailContext) {
    logger.warn('[readEmailPdfAttachment] gmail unavailable', {
      userId: params.userId,
      mailboxId: mailbox.mailboxId,
      messageId: params.messageId,
    });
    return {
      ok: false,
      status: 'gmail_unavailable',
      message: 'Gmail credentials are not available for this mailbox.',
      retryable: false,
      messageContext: {
        messageId: params.messageId,
        mailboxId: mailbox.mailboxId,
        mailboxEmail: mailbox.mailboxEmail,
      },
    };
  }

  try {
    await gmailContext.gmail.ensureAuthenticated();
    const gmailClient = gmailContext.gmail.getNativeGmailClient();
    const messageResponse = await gmailClient.users.messages.get({
      userId: 'me',
      id: params.messageId,
      format: 'full',
    });

    const rawMessage = (messageResponse.data ?? null) as GmailRawMessage | null;
    if (!rawMessage?.id || !rawMessage.payload) {
      logger.info('[readEmailPdfAttachment] message not found or empty payload', {
        userId: params.userId,
        mailboxId: mailbox.mailboxId,
        messageId: params.messageId,
      });
      return {
        ok: false,
        status: 'message_not_found',
        message: 'The email message could not be found in Gmail.',
        retryable: false,
        messageContext: {
          messageId: params.messageId,
          mailboxId: mailbox.mailboxId,
          mailboxEmail: mailbox.mailboxEmail,
        },
      };
    }

    const attachments: InternalPdfAttachment[] = [];
    collectPdfAttachments(rawMessage.payload, attachments);
    const selection = selectAttachment({
      attachments,
      attachmentId: params.attachmentId,
      attachmentFilename: params.attachmentFilename,
    });
    const messageContext = buildMessageContext({
      messageId: params.messageId,
      mailbox,
      rawMessage,
    });

    if (!selection.ok) {
      logger.info('[readEmailPdfAttachment] attachment selection failed', {
        userId: params.userId,
        mailboxId: mailbox.mailboxId,
        messageId: params.messageId,
        status: selection.result.status,
        attachmentCount: attachments.length,
      });
      return {
        ...selection.result,
        messageContext,
      };
    }

    const selectedAttachment = selection.attachment;
    let pdfBuffer: Buffer;

    if (selectedAttachment.inlineData) {
      pdfBuffer = normalizeBase64Url(selectedAttachment.inlineData);
    } else {
      try {
        const attachmentResponse = await gmailClient.users.messages.attachments.get({
          userId: 'me',
          messageId: params.messageId,
          id: selectedAttachment.attachmentId,
        });
        const attachmentData = (attachmentResponse.data ?? null) as GmailAttachmentApiResponse | null;
        if (!attachmentData?.data) {
          logger.warn('[readEmailPdfAttachment] attachment fetch missing data', {
            userId: params.userId,
            mailboxId: mailbox.mailboxId,
            messageId: params.messageId,
            attachmentId: selectedAttachment.attachmentId,
          });
          return {
            ok: false,
            status: 'attachment_fetch_failed',
            message: 'Gmail returned the PDF attachment without any content.',
            retryable: true,
            messageContext,
            availablePdfAttachments: attachments.map(toPublicAttachment),
          };
        }

        pdfBuffer = normalizeBase64Url(attachmentData.data);
      } catch (error) {
        logger.warn('[readEmailPdfAttachment] attachment fetch failed', {
          userId: params.userId,
          mailboxId: mailbox.mailboxId,
          messageId: params.messageId,
          attachmentId: selectedAttachment.attachmentId,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          ok: false,
          status: 'attachment_fetch_failed',
          message: 'Failed to download the PDF attachment from Gmail.',
          retryable: true,
          messageContext,
          availablePdfAttachments: attachments.map(toPublicAttachment),
        };
      }
    }

    try {
      const extraction = await extractContentFromBuffer({
        buffer: pdfBuffer,
        mimeType: selectedAttachment.mimeType,
        abortSignal: params.abortSignal,
        traceContext: params.traceContext,
        channelLabel: 'Gmail email attachment',
        filename: selectedAttachment.filename,
        provenance: buildInlineBufferProvenance({
          sourceLabel: 'Gmail email attachment',
          sourceKind: 'gmail_attachment',
          channel: 'gmail',
          conversationId: params.traceContext?.conversationId ?? null,
          runId: params.traceContext?.runId ?? null,
          messageId: params.messageId,
          attachmentId: selectedAttachment.attachmentId,
        }),
      });
      const extractedText = renderContentExtractionForLegacyText(extraction);

      logger.info('[readEmailPdfAttachment] extracted pdf attachment', {
        userId: params.userId,
        mailboxId: mailbox.mailboxId,
        messageId: params.messageId,
        attachmentId: selectedAttachment.attachmentId,
        filename: selectedAttachment.filename,
        pdfCount: attachments.length,
        extractionStatus: extraction.status,
        degradationCodes: extraction.degradationNotes.map((note) => note.code),
      });

      return {
        ok: true,
        status: 'ok',
        message: messageContext,
        mailboxResolutionSource: mailbox.resolutionSource,
        attachment: toPublicAttachment(selectedAttachment),
        availablePdfAttachments: attachments.map(toPublicAttachment),
        extractedText,
      };
    } catch (error) {
      logger.warn('[readEmailPdfAttachment] pdf extraction failed', {
        userId: params.userId,
        mailboxId: mailbox.mailboxId,
        messageId: params.messageId,
        attachmentId: selectedAttachment.attachmentId,
        filename: selectedAttachment.filename,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        status: 'pdf_extraction_failed',
        message: 'The PDF was fetched, but extraction failed.',
        retryable: true,
        messageContext,
        availablePdfAttachments: attachments.map(toPublicAttachment),
      };
    }
  } catch (error) {
    const retryable = isRetryableGmailError(error);
    const statusCode = readErrorStatusCode(error);
    logger.warn('[readEmailPdfAttachment] message fetch failed', {
      userId: params.userId,
      mailboxId: mailbox.mailboxId,
      messageId: params.messageId,
      retryable,
      statusCode,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      status: statusCode === 404 ? 'message_not_found' : 'message_fetch_failed',
      message:
        statusCode === 404
          ? 'The email message could not be found in Gmail.'
          : 'Failed to fetch the email message from Gmail.',
      retryable,
      messageContext: {
        messageId: params.messageId,
        mailboxId: mailbox.mailboxId,
        mailboxEmail: mailbox.mailboxEmail,
      },
    };
  }
}
