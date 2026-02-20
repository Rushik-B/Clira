import { prisma } from '@/lib/prisma'
import type { Mailbox } from '@prisma/client'

export type MailboxWithStatus = Pick<
  Mailbox,
  | 'id'
  | 'userId'
  | 'provider'
  | 'providerAccountId'
  | 'emailAddress'
  | 'displayName'
  | 'isPrimary'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
>

type GetMailboxesForUserOptions = {
  userId: string
  /** Filter by status. If not provided, returns all mailboxes. */
  status?: 'CONNECTED' | 'NEEDS_RECONNECT' | 'ERROR' | 'DISABLED'
  /** Filter by provider. If not provided, returns all providers. */
  provider?: 'google' | 'microsoft'
}

/**
 * Fetches all mailboxes for a given user.
 *
 * @param options - Configuration for fetching mailboxes
 * @returns Array of mailboxes sorted by isPrimary (primary first), then createdAt
 *
 * @example
 * // Get all mailboxes
 * const mailboxes = await getMailboxesForUser({ userId: 'user-123' })
 *
 * @example
 * // Get only connected Gmail mailboxes
 * const gmailMailboxes = await getMailboxesForUser({
 *   userId: 'user-123',
 *   status: 'CONNECTED',
 *   provider: 'google',
 * })
 */
export async function getMailboxesForUser({
  userId,
  status,
  provider,
}: GetMailboxesForUserOptions): Promise<MailboxWithStatus[]> {
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      userId,
      ...(status && { status }),
      ...(provider && { provider }),
    },
    select: {
      id: true,
      userId: true,
      provider: true,
      providerAccountId: true,
      emailAddress: true,
      displayName: true,
      isPrimary: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [
      { isPrimary: 'desc' }, // Primary mailbox first
      { createdAt: 'asc' },  // Then by creation order
    ],
  })

  return mailboxes
}

/**
 * Gets the count of mailboxes for a user.
 * Useful for determining if user has multiple mailboxes connected.
 */
export async function getMailboxCountForUser(userId: string): Promise<number> {
  return prisma.mailbox.count({
    where: { userId },
  })
}

/**
 * Checks if user has any mailboxes that need reconnection.
 */
export async function hasMailboxesNeedingReconnect(userId: string): Promise<boolean> {
  const count = await prisma.mailbox.count({
    where: {
      userId,
      status: 'NEEDS_RECONNECT',
    },
  })
  return count > 0
}
