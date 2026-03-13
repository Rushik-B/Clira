import { z } from 'zod';

export const readEmailPdfAttachmentArgsSchema = z.object({
  messageId: z.string().trim().min(1).describe('Gmail message ID of the email that contains the PDF attachment.'),
  mailboxId: z.string().trim().min(1).optional().describe('Optional mailbox ID when the message belongs to a specific connected inbox.'),
  mailboxEmail: z.string().trim().email().optional().describe('Optional mailbox email when the message belongs to a specific connected inbox.'),
  attachmentId: z.string().trim().min(1).optional().describe('Optional PDF attachment ID returned by a previous read_email_pdf_attachment call when the email has multiple PDFs.'),
  attachmentFilename: z.string().trim().min(1).max(255).optional().describe('Optional PDF filename to target. Exact filename is preferred; a unique substring also works.'),
});

export const readEmailPdfAttachmentProviderSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: {
      type: 'string',
      description: 'Gmail message ID of the email that contains the PDF attachment.',
    },
    mailboxId: {
      type: 'string',
      description: 'Optional mailbox ID when the message belongs to a specific connected inbox.',
    },
    mailboxEmail: {
      type: 'string',
      description: 'Optional mailbox email when the message belongs to a specific connected inbox.',
    },
    attachmentId: {
      type: 'string',
      description: 'Optional PDF attachment ID returned by a previous read_email_pdf_attachment call.',
    },
    attachmentFilename: {
      type: 'string',
      description: 'Optional PDF filename to target. Exact filename is preferred; a unique substring also works.',
    },
  },
  required: ['messageId'],
} as const;

export type ReadEmailPdfAttachmentArgs = z.infer<typeof readEmailPdfAttachmentArgsSchema>;

export function normalizeReadEmailPdfAttachmentArgs(
  args: ReadEmailPdfAttachmentArgs,
): ReadEmailPdfAttachmentArgs {
  const parsed = readEmailPdfAttachmentArgsSchema.parse(args);

  return {
    messageId: parsed.messageId.trim(),
    mailboxId: parsed.mailboxId?.trim(),
    mailboxEmail: parsed.mailboxEmail?.trim().toLowerCase(),
    attachmentId: parsed.attachmentId?.trim(),
    attachmentFilename: parsed.attachmentFilename?.trim(),
  };
}
