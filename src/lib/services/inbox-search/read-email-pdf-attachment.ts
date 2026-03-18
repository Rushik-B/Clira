import type { ContentReference } from '@/lib/services/content-ingestion';
import {
  readEmailAttachmentContent,
  type EmailAttachmentContentCandidate,
  type ReadEmailAttachmentContentArgs,
  type ReadEmailAttachmentContentResult,
} from '@/lib/services/inbox-search/read-email-attachment-content';

export type EmailPdfAttachmentCandidate = Omit<EmailAttachmentContentCandidate, 'kind'>;

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
      mailboxResolutionSource:
        | 'explicit_mailbox_id'
        | 'explicit_mailbox_email'
        | 'stored_email'
        | 'inbox_search_document'
        | 'single_connected_mailbox_fallback';
      attachment: EmailPdfAttachmentCandidate;
      availablePdfAttachments: EmailPdfAttachmentCandidate[];
      extractedText: string;
      contentRefs: ContentReference[];
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

export type ReadEmailPdfAttachmentArgs = Omit<
  ReadEmailAttachmentContentArgs,
  'supportedKinds' | 'toolPurpose' | 'requester'
>;

function toPdfAttachmentCandidate(
  attachment: EmailAttachmentContentCandidate,
): EmailPdfAttachmentCandidate {
  return {
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}

function mapFailureStatus(
  status: Extract<ReadEmailAttachmentContentResult, { ok: false }>['status'],
): Extract<ReadEmailPdfAttachmentResult, { ok: false }>['status'] {
  switch (status) {
    case 'no_supported_attachments':
      return 'no_pdf_attachments';
    case 'multiple_supported_attachments':
      return 'multiple_pdf_attachments';
    case 'attachment_extraction_failed':
      return 'pdf_extraction_failed';
    default:
      return status;
  }
}

function mapFailureMessage(params: {
  result: Extract<ReadEmailAttachmentContentResult, { ok: false }>;
  args: ReadEmailPdfAttachmentArgs;
}): string {
  switch (params.result.status) {
    case 'no_supported_attachments':
      return 'This email does not have any PDF attachments.';
    case 'multiple_supported_attachments':
      if (params.args.attachmentFilename?.trim()) {
        return 'Multiple PDF attachments match that filename. Call again with attachmentId or a more specific attachmentFilename.';
      }
      return 'This email has multiple PDF attachments. Call again with attachmentId or attachmentFilename.';
    case 'attachment_extraction_failed':
      return 'The PDF was fetched, but extraction failed.';
    default:
      return params.result.message;
  }
}

export async function readEmailPdfAttachment(
  params: ReadEmailPdfAttachmentArgs,
): Promise<ReadEmailPdfAttachmentResult> {
  const result = await readEmailAttachmentContent({
    ...params,
    supportedKinds: ['pdf'],
    toolPurpose: 'executive-agent:read-email-pdf-attachment',
    requester: 'executiveAgent.read_email_pdf_attachment',
  });

  if (result.ok) {
    const { availableAttachments, ...rest } = result;
    return {
      ...rest,
      attachment: toPdfAttachmentCandidate(result.attachment),
      availablePdfAttachments: availableAttachments.map(toPdfAttachmentCandidate),
    };
  }

  const { availableAttachments, ...rest } = result;
  return {
    ...rest,
    status: mapFailureStatus(result.status),
    message: mapFailureMessage({
      result,
      args: params,
    }),
    availablePdfAttachments: availableAttachments?.map(toPdfAttachmentCandidate),
  };
}
