import { prisma } from '@/lib/prisma'
import type { Mailbox } from '@prisma/client'

export type PrimaryMailbox = Pick<
  Mailbox,
  | 'id'
  | 'userId'
  | 'provider'
  | 'providerAccountId'
  | 'emailAddress'
  | 'displayName'
  | 'isPrimary'
  | 'status'
  | 'gmailHistoryId'
  | 'gmailWatchExpiration'
  | 'gmailWatchResourceId'
  | 'createdAt'
  | 'updatedAt'
>

type GetPrimaryMailboxOptions = {
  userId: string
  /** If true, throws an error when no primary mailbox is found. Default: false */
  throwIfNotFound?: boolean
}

/**
 * Gets the primary mailbox for a user.
 *
 * The primary mailbox is the one marked with isPrimary=true.
 * For users who connected before multi-inbox, this is their original Gmail account.
 * For new users, this is the first mailbox they connected.
 *
 * @param options - Configuration for fetching the primary mailbox
 * @returns The primary mailbox, or null if not found (unless throwIfNotFound is true)
 *
 * @example
 * // Get primary mailbox (may be null)
 * const mailbox = await getPrimaryMailbox({ userId: 'user-123' })
 * if (mailbox) {
 *   console.log(`Primary email: ${mailbox.emailAddress}`)
 * }
 *
 * @example
 * // Get primary mailbox with error on missing
 * const mailbox = await getPrimaryMailbox({
 *   userId: 'user-123',
 *   throwIfNotFound: true,
 * })
 * // Guaranteed non-null here
 */
export async function getPrimaryMailbox({
  userId,
  throwIfNotFound = false,
}: GetPrimaryMailboxOptions): Promise<PrimaryMailbox | null> {
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      userId,
      isPrimary: true,
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
      gmailHistoryId: true,
      gmailWatchExpiration: true,
      gmailWatchResourceId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!mailbox && throwIfNotFound) {
    throw new Error(`No primary mailbox found for user ${userId}`)
  }

  return mailbox
}

/**
 * Gets the primary mailbox ID for a user.
 * Convenience function when you only need the ID for a query.
 *
 * @param userId - The user's ID
 * @returns The primary mailbox ID, or null if not found
 */
export async function getPrimaryMailboxId(userId: string): Promise<string | null> {
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      userId,
      isPrimary: true,
    },
    select: {
      id: true,
    },
  })

  return mailbox?.id ?? null
}

/**
 * Gets a mailbox by its ID, verifying it belongs to the user.
 * Use this when you have a mailboxId and need to verify ownership.
 *
 * @param userId - The user's ID
 * @param mailboxId - The mailbox ID to fetch
 * @returns The mailbox if found and owned by user, null otherwise
 */
export async function getMailboxById(
  userId: string,
  mailboxId: string
): Promise<PrimaryMailbox | null> {
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      id: mailboxId,
      userId, // Ensures user owns this mailbox
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
      gmailHistoryId: true,
      gmailWatchExpiration: true,
      gmailWatchResourceId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return mailbox
}

/**
 * Finds a mailbox by email address for a user.
 * Useful for routing push notifications or matching "from" addresses.
 *
 * @param userId - The user's ID
 * @param emailAddress - The email address to find
 * @returns The mailbox if found, null otherwise
 */
export async function getMailboxByEmailAddress(
  userId: string,
  emailAddress: string
): Promise<PrimaryMailbox | null> {
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      userId,
      emailAddress: emailAddress.toLowerCase(),
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
      gmailHistoryId: true,
      gmailWatchExpiration: true,
      gmailWatchResourceId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return mailbox
}
