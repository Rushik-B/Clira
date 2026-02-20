import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { GmailNotConnectedError } from '@/lib/services/labels/createGmailLabelForUser';

const DEFAULT_LABEL_COLOR = '#4a86e8';

export type SyncedLabel = {
  id: string;
  userId: string;
  mailboxId: string | null;
  name: string;
  color: string | null;
  gmailLabelId: string | null;
  isCustom: boolean;
  isSystemDefault: boolean;
  isSystemLabel: boolean;
  emailCount: number;
  metaPrompt: string | null;
  backgroundColor?: string;
  textColor?: string;
};

export type SyncUserLabelsOptions = {
  userId: string;
  /**
   * Mailbox ID to sync labels for.
   * Required for multi-inbox support. When not provided, falls back to user's
   * primary mailbox (legacy behavior for backward compatibility).
   */
  mailboxId?: string;
  purpose: string;
  requester: string;
  includeSystemLabels?: boolean;
  deleteMissing?: boolean;
};

export type SyncUserLabelsResult = {
  labels: SyncedLabel[];
  removedLabelIds: string[];
  mailboxId: string | null;
};

/**
 * Syncs labels between Gmail and the database for a specific mailbox.
 *
 * Multi-inbox behavior:
 * - When mailboxId is provided: syncs labels for that specific mailbox
 * - When mailboxId is not provided: falls back to user's primary mailbox (legacy)
 *
 * Labels are scoped to mailboxId - the same Gmail label ID can exist in multiple
 * mailboxes without collision.
 */
export async function syncUserLabelsWithGmail({
  userId,
  mailboxId,
  purpose,
  requester,
  includeSystemLabels = false,
  deleteMissing = true,
}: SyncUserLabelsOptions): Promise<SyncUserLabelsResult> {
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

  const gmailResult = await createGmailServiceForUser({
    userId,
    mailboxId: resolvedMailboxId,
    purpose,
    requester,
    includeRefreshToken: true,
    failureMode: 'throw',
  });

  if (!gmailResult) {
    throw new GmailNotConnectedError(requester);
  }

  const gmailService = gmailResult.gmail;

  const gmailLabels = await gmailService.getLabels();
  const userGmailLabels = gmailLabels.filter((label) => label.type === 'user');
  const gmailLabelById = new Map(userGmailLabels.map((label) => [label.id, label]));

  // Build WHERE clause scoped to this mailbox
  const labelWhere: Prisma.LabelWhereInput = includeSystemLabels
    ? { userId, mailboxId: resolvedMailboxId }
    : { userId, mailboxId: resolvedMailboxId, isSystemLabel: false };

  const dbLabels = await prisma.label.findMany({
    where: labelWhere,
    select: {
      id: true,
      userId: true,
      mailboxId: true,
      name: true,
      color: true,
      gmailLabelId: true,
      isCustom: true,
      isSystemDefault: true,
      isSystemLabel: true,
      emailCount: true,
      metaPrompt: true,
    },
  });

  const labelByGmailId = new Map<string, typeof dbLabels[number]>();
  const labelByLowerName = new Map<string, typeof dbLabels[number]>();

  for (const label of dbLabels) {
    if (label.gmailLabelId) {
      labelByGmailId.set(label.gmailLabelId, label);
    } else {
      labelByLowerName.set(label.name.toLowerCase(), label);
    }
  }

  for (const gmailLabel of userGmailLabels) {
    const existing = labelByGmailId.get(gmailLabel.id);
    if (existing) {
      const desiredColor = gmailLabel.backgroundColor ?? existing.color ?? DEFAULT_LABEL_COLOR;
      const updates: Prisma.LabelUpdateInput = {};

      if (existing.name !== gmailLabel.name) {
        updates.name = gmailLabel.name;
      }

      if (existing.color !== desiredColor) {
        updates.color = desiredColor;
      }

      if (Object.keys(updates).length > 0) {
        await prisma.label.update({
          where: { id: existing.id },
          data: updates,
        });
      }

      continue;
    }

    const byName = labelByLowerName.get(gmailLabel.name.toLowerCase());
    const desiredColor = gmailLabel.backgroundColor ?? DEFAULT_LABEL_COLOR;

    if (byName) {
      try {
        const updated = await prisma.label.update({
          where: { id: byName.id },
          data: {
            gmailLabelId: gmailLabel.id,
            color: desiredColor,
          },
          select: {
            id: true,
            userId: true,
            mailboxId: true,
            name: true,
            color: true,
            gmailLabelId: true,
            isCustom: true,
            isSystemDefault: true,
            isSystemLabel: true,
            emailCount: true,
            metaPrompt: true,
          },
        });
        labelByGmailId.set(gmailLabel.id, updated);
      } catch (error: any) {
        if (error?.code === 'P2002') {
          // Unique constraint violation - label already exists for this mailbox
          const existingRecord = await prisma.label.findFirst({
            where: { mailboxId: resolvedMailboxId, gmailLabelId: gmailLabel.id },
            select: {
              id: true,
              userId: true,
              mailboxId: true,
              name: true,
              color: true,
              gmailLabelId: true,
              isCustom: true,
              isSystemDefault: true,
              isSystemLabel: true,
              emailCount: true,
              metaPrompt: true,
            },
          });
          if (existingRecord) {
            labelByGmailId.set(gmailLabel.id, existingRecord);
          }
        } else {
          console.error('[labels.sync] Failed to attach Gmail ID to existing label', {
            userId,
            mailboxId: resolvedMailboxId,
            labelName: gmailLabel.name,
            error,
          });
        }
      }

      continue;
    }

    // Create new label scoped to this mailbox
    try {
      const created = await prisma.label.create({
        data: {
          userId,
          mailboxId: resolvedMailboxId,
          name: gmailLabel.name,
          color: desiredColor,
          gmailLabelId: gmailLabel.id,
          isCustom: true,
          isSystemLabel: false,
        },
        select: {
          id: true,
          userId: true,
          mailboxId: true,
          name: true,
          color: true,
          gmailLabelId: true,
          isCustom: true,
          isSystemDefault: true,
          isSystemLabel: true,
          emailCount: true,
          metaPrompt: true,
        },
      });

      labelByGmailId.set(gmailLabel.id, created);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existingRecord = await prisma.label.findFirst({
          where: { mailboxId: resolvedMailboxId, gmailLabelId: gmailLabel.id },
          select: {
            id: true,
            userId: true,
            mailboxId: true,
            name: true,
            color: true,
            gmailLabelId: true,
            isCustom: true,
            isSystemDefault: true,
            isSystemLabel: true,
            emailCount: true,
            metaPrompt: true,
          },
        });
        if (existingRecord) {
          labelByGmailId.set(gmailLabel.id, existingRecord);
        }
      } else {
        console.error('[labels.sync] Failed to create label from Gmail metadata', {
          userId,
          mailboxId: resolvedMailboxId,
          labelName: gmailLabel.name,
          error,
        });
      }
    }
  }

  const removedLabelIds: string[] = [];

  if (deleteMissing) {
    const gmailIds = new Set(userGmailLabels.map((label) => label.id));
    const orphaned = dbLabels.filter((label) => {
      if (!label.gmailLabelId) {
        return false;
      }

      if (gmailIds.has(label.gmailLabelId)) {
        return false;
      }

      if (label.isSystemDefault || label.isSystemLabel) {
        return false;
      }

      return true;
    });

    if (orphaned.length > 0) {
      const orphanedIds = orphaned.map((label) => label.id);
      await prisma.label.deleteMany({
        where: {
          id: { in: orphanedIds },
        },
      });
      removedLabelIds.push(...orphanedIds);
    }
  }

  const finalLabels = await prisma.label.findMany({
    where: labelWhere,
    select: {
      id: true,
      userId: true,
      mailboxId: true,
      name: true,
      color: true,
      gmailLabelId: true,
      isCustom: true,
      isSystemDefault: true,
      isSystemLabel: true,
      emailCount: true,
      metaPrompt: true,
    },
    orderBy: [
      { isSystemDefault: 'desc' },
      { name: 'asc' },
    ],
  });

  const labels: SyncedLabel[] = finalLabels.map((label) => {
    const gmailLabel = label.gmailLabelId ? gmailLabelById.get(label.gmailLabelId) : undefined;
    return {
      ...label,
      backgroundColor: gmailLabel?.backgroundColor ?? undefined,
      textColor: gmailLabel?.textColor ?? undefined,
    };
  });

  return { labels, removedLabelIds, mailboxId: resolvedMailboxId };
}

/**
 * Syncs labels for ALL connected mailboxes belonging to a user.
 * Returns a unified list of labels from all mailboxes with mailbox context.
 *
 * Useful for unified inbox views where labels from all mailboxes need to be displayed.
 */
export async function syncAllMailboxLabels({
  userId,
  purpose,
  requester,
  includeSystemLabels = false,
  deleteMissing = true,
}: Omit<SyncUserLabelsOptions, 'mailboxId'>): Promise<{
  labels: SyncedLabel[];
  removedLabelIds: string[];
  mailboxesProcessed: number;
}> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, provider: 'google', status: 'CONNECTED' },
    select: { id: true, emailAddress: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  const allLabels: SyncedLabel[] = [];
  const allRemovedIds: string[] = [];
  let successfulMailboxes = 0;
  let firstError: unknown = null;

  for (const mailbox of mailboxes) {
    try {
      const result = await syncUserLabelsWithGmail({
        userId,
        mailboxId: mailbox.id,
        purpose,
        requester,
        includeSystemLabels,
        deleteMissing,
      });
      allLabels.push(...result.labels);
      allRemovedIds.push(...result.removedLabelIds);
      successfulMailboxes += 1;
    } catch (error) {
      console.error(`[labels.syncAll] Failed to sync labels for mailbox ${mailbox.emailAddress}:`, error);
      firstError = firstError ?? error;
      // Continue with other mailboxes
    }
  }

  if (mailboxes.length > 0 && successfulMailboxes === 0) {
    if (firstError instanceof Error) {
      throw firstError;
    }
    throw new Error('Failed to sync labels for all connected mailboxes');
  }

  return {
    labels: allLabels,
    removedLabelIds: allRemovedIds,
    mailboxesProcessed: mailboxes.length,
  };
}
