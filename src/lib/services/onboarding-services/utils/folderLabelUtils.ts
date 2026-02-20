import { prisma } from '../../../prisma';

/**
 * Fetch all user folders (excluding Gmail system labels), ordered by defaults first.
 * Mirrors previous DefaultFoldersService.getAllUserFolders logic.
 *
 * @deprecated Use getAllMailboxFolders for multi-inbox support
 */
export async function getAllUserFolders(userId: string) {
  return await prisma.label.findMany({
    where: {
      userId: userId,
      isSystemLabel: false
    },
    orderBy: [
      { isSystemDefault: 'desc' },
      { name: 'asc' }
    ]
  });
}

/**
 * Fetch all folders for a specific mailbox (excluding system labels).
 * Multi-inbox aware: scopes to specific mailbox for proper label isolation.
 *
 * @param userId - User ID
 * @param mailboxId - Mailbox ID (required for proper multi-inbox scoping)
 */
export async function getAllMailboxFolders(userId: string, mailboxId: string) {
  return await prisma.label.findMany({
    where: {
      userId,
      mailboxId,
      isSystemLabel: false
    },
    orderBy: [
      { isSystemDefault: 'desc' },
      { name: 'asc' }
    ]
  });
}

/**
 * Fetch all folders across ALL connected mailboxes for a user.
 * Useful for unified inbox views where folders from all mailboxes are needed.
 *
 * @param userId - User ID
 * @returns Labels grouped by mailbox (includes mailboxId in each label)
 */
export async function getAllUserFoldersAcrossMailboxes(userId: string) {
  return await prisma.label.findMany({
    where: {
      userId,
      isSystemLabel: false,
      mailboxId: { not: null }
    },
    orderBy: [
      { mailboxId: 'asc' },
      { isSystemDefault: 'desc' },
      { name: 'asc' }
    ]
  });
}

/**
 * Resolve the "Review" fallback label for a user.
 * Mirrors previous DefaultFoldersService.getReviewFolder logic.
 *
 * @deprecated Use getMailboxReviewFolder for multi-inbox support
 */
export async function getReviewFolder(userId: string) {
  return await prisma.label.findFirst({
    where: {
      userId: userId,
      name: 'Review',
      isSystemDefault: true
    }
  });
}

/**
 * Resolve the "Review" fallback label for a specific mailbox.
 * Multi-inbox aware: scopes to specific mailbox.
 *
 * @param userId - User ID
 * @param mailboxId - Mailbox ID (required for proper multi-inbox scoping)
 */
export async function getMailboxReviewFolder(userId: string, mailboxId: string) {
  return await prisma.label.findFirst({
    where: {
      userId,
      mailboxId,
      name: 'Review',
      isSystemDefault: true
    }
  });
}

/**
 * Update folder email count and last batch sort time.
 * Mirrors previous DefaultFoldersService.updateFolderEmailCount logic.
 */
export async function updateFolderEmailCount(folderId: string, newCount: number): Promise<void> {
  await prisma.label.update({
    where: { id: folderId },
    data: {
      emailCount: newCount,
      lastBatchSort: new Date()
    }
  });
}


