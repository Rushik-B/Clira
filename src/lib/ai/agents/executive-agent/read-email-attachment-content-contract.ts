import { z } from 'zod';

export const readEmailAttachmentContentArgsSchema = z.object({
  messageId: z.string().trim().min(1).describe('Gmail message ID of the email that contains the attachment.'),
  mailboxId: z.string().trim().min(1).optional().describe('Optional mailbox ID when the message belongs to a specific connected inbox.'),
  mailboxEmail: z.string().trim().email().optional().describe('Optional mailbox email when the message belongs to a specific connected inbox.'),
  attachmentId: z.string().trim().min(1).optional().describe('Optional attachment ID returned by a previous read_email_attachment_content call when the email has multiple supported attachments.'),
  attachmentFilename: z.string().trim().min(1).max(255).optional().describe('Optional attachment filename to target. Exact filename is preferred; a unique substring also works.'),
});

export const readEmailAttachmentContentProviderSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: {
      type: 'string',
      description: 'Gmail message ID of the email that contains the attachment.',
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
      description: 'Optional attachment ID returned by a previous read_email_attachment_content call.',
    },
    attachmentFilename: {
      type: 'string',
      description: 'Optional attachment filename to target. Exact filename is preferred; a unique substring also works.',
    },
  },
  required: ['messageId'],
} as const;

export type ReadEmailAttachmentContentArgs = z.infer<typeof readEmailAttachmentContentArgsSchema>;

export function normalizeReadEmailAttachmentContentArgs(
  args: ReadEmailAttachmentContentArgs,
): ReadEmailAttachmentContentArgs {
  const parsed = readEmailAttachmentContentArgsSchema.parse(args);

  return {
    messageId: parsed.messageId.trim(),
    mailboxId: parsed.mailboxId?.trim(),
    mailboxEmail: parsed.mailboxEmail?.trim().toLowerCase(),
    attachmentId: parsed.attachmentId?.trim(),
    attachmentFilename: parsed.attachmentFilename?.trim(),
  };
}
