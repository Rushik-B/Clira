import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { normalizeGmailLabelColor } from '@/lib/gmail/labelColors';

export class GmailNotConnectedError extends Error {
  constructor(requester: string) {
    super('Gmail account is not connected');
    this.name = 'GmailNotConnectedError';
    this.cause = { requester };
  }
}

type CreateLabelInput = {
  userId: string;
  /**
   * Mailbox ID to create label for.
   * Required for multi-inbox support. When not provided, falls back to user's
   * primary mailbox (legacy behavior for backward compatibility).
   */
  mailboxId?: string;
  name: string;
  color?: string | null;
  labelListVisibility?: string;
  messageListVisibility?: string;
  purpose: string;
  requester: string;
};

export type GmailLabelCreationResult = {
  gmailLabelId: string;
  backgroundColor: string;
  textColor: string;
  mailboxId: string;
};

/**
 * Creates a label in Gmail for a specific mailbox.
 *
 * Multi-inbox behavior:
 * - When mailboxId is provided: creates label using that mailbox's credentials
 * - When mailboxId is not provided: falls back to user's primary mailbox (legacy)
 *
 * Also validates that the user owns the specified mailbox before creating.
 */
export async function createGmailLabelForUser({
  userId,
  mailboxId,
  name,
  color,
  labelListVisibility = 'labelShow',
  messageListVisibility = 'show',
  purpose,
  requester,
}: CreateLabelInput): Promise<GmailLabelCreationResult> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error('Label name is required');
  }

  // Resolve mailboxId if not provided (legacy fallback to primary mailbox)
  let resolvedMailboxId = mailboxId;
  if (!resolvedMailboxId) {
    const primaryMailbox = await prisma.mailbox.findFirst({
      where: { userId, provider: 'google', status: 'CONNECTED' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    resolvedMailboxId = primaryMailbox?.id;
  }

  if (!resolvedMailboxId) {
    throw new GmailNotConnectedError(requester);
  }

  // Validate user owns the mailbox
  const mailbox = await prisma.mailbox.findFirst({
    where: { id: resolvedMailboxId, userId },
    select: { id: true, emailAddress: true },
  });

  if (!mailbox) {
    throw new Error('Mailbox not found or access denied');
  }

  const { backgroundColor, textColor } = normalizeGmailLabelColor(color);

  const gmailResult = await createGmailServiceForUser({
    userId,
    mailboxId: resolvedMailboxId,
    purpose,
    requester,
    includeRefreshToken: true,
  });

  if (!gmailResult) {
    throw new GmailNotConnectedError(requester);
  }

  try {
    const gmailLabelId = await gmailResult.gmail.createLabel(
      normalizedName,
      labelListVisibility,
      messageListVisibility,
      backgroundColor,
      textColor
    );

    return { gmailLabelId, backgroundColor, textColor, mailboxId: resolvedMailboxId };
  } catch (error: any) {
    const status = error?.status ?? error?.code ?? error?.response?.status;
    const message: string = String(error?.message ?? '');

    const isDuplicateName =
      status === 409 ||
      message.toLowerCase().includes('exists') ||
      message.toLowerCase().includes('duplicate');

    if (isDuplicateName) {
      try {
        const labels = await gmailResult.gmail.getLabels();
        const existing = labels.find((label) => label.name.toLowerCase() === normalizedName.toLowerCase());
        if (existing?.id) {
          console.warn(
            `[gmail] Label "${normalizedName}" already exists in mailbox ${mailbox.emailAddress}, reusing existing label (${existing.id}).`
          );
          return {
            gmailLabelId: existing.id,
            backgroundColor: existing.backgroundColor ?? backgroundColor,
            textColor: existing.textColor ?? textColor,
            mailboxId: resolvedMailboxId,
          };
        }
      } catch (lookupError) {
        console.error('[gmail] Failed to look up existing label after duplicate error:', lookupError);
      }
    }

    throw error;
  }
}
