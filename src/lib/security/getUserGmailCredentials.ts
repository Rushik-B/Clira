import { CredentialKind } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { decryptToken } from '@/lib/encryption'
import { GmailService } from '@/lib/email/gmail'

type CredentialRequest = {
  userId: string
  /**
   * Optional mailbox ID for multi-inbox support.
   * When provided, fetches credentials for the specific mailbox.
   * When not provided, falls back to the first Google OAuth account (legacy behavior).
   *
   * NOTE: For new code, always provide mailboxId when available.
   * This parameter will become required after multi-inbox migration is complete.
   */
  mailboxId?: string
  purpose: string
  requester: string
  includeRefreshToken?: boolean
  failureMode?: 'return-null' | 'throw'
}

export type GmailCredentials = {
  accessToken: string
  refreshToken?: string | null
  /** The mailbox ID these credentials belong to (if known) */
  mailboxId?: string | null
}

export class OAuthTokenDecryptionError extends Error {
  readonly userId: string
  readonly mailboxId: string | null
  readonly accountId: string
  readonly requester: string

  constructor(options: {
    userId: string
    mailboxId: string | null
    accountId: string
    requester: string
  }) {
    super('OAuth token decryption failed. The stored token could not be decrypted — check EMAIL_ENCRYPT_SECRET and EMAIL_ENCRYPT_SALT.')
    this.name = 'OAuthTokenDecryptionError'
    this.userId = options.userId
    this.mailboxId = options.mailboxId
    this.accountId = options.accountId
    this.requester = options.requester
  }
}

function buildTokenAuditType(includeRefresh: boolean, hasRefresh: boolean): CredentialKind {
  if (includeRefresh && hasRefresh) {
    return CredentialKind.BOTH
  }
  return CredentialKind.ACCESS_TOKEN
}

export async function getUserGmailCredentials({
  userId,
  mailboxId,
  purpose,
  requester,
  includeRefreshToken = true,
  failureMode = 'return-null',
}: CredentialRequest): Promise<GmailCredentials | null> {
  const account = mailboxId
    ? await prisma.oAuthAccount.findFirst({
        where: { userId, provider: 'google', mailboxId },
        select: { id: true, mailboxId: true, accessToken: true, refreshToken: true },
      })
    : await prisma.oAuthAccount.findFirst({
        where: { userId, provider: 'google' },
        select: { id: true, mailboxId: true, accessToken: true, refreshToken: true },
      })

  if (!account) {
    return null
  }

  const accessToken = account.accessToken ? decryptToken(account.accessToken) : null

  if (!accessToken) {
    if (failureMode === 'throw') {
      throw new OAuthTokenDecryptionError({
        userId,
        mailboxId: account.mailboxId ?? null,
        accountId: account.id,
        requester,
      })
    }
    return null
  }

  const refreshToken = includeRefreshToken && account.refreshToken
    ? decryptToken(account.refreshToken)
    : null

  const tokenType = buildTokenAuditType(includeRefreshToken, Boolean(refreshToken))

  try {
    await prisma.tokenAccessAudit.create({
      data: {
        userId,
        tokenType,
        purpose,
        requester,
        metadata: {
          accountId: account.id,
          mailboxId: account.mailboxId,
        },
      },
    })
  } catch (error) {
    console.error('Failed to record token access audit', error)
  }

  return {
    accessToken,
    refreshToken,
    mailboxId: account.mailboxId,
  }
}

export async function createGmailServiceForUser(
  options: CredentialRequest
): Promise<{ gmail: GmailService; credentials: GmailCredentials } | null> {
  const credentials = await getUserGmailCredentials(options)
  if (!credentials) {
    return null
  }

  const gmail = new GmailService(
    credentials.accessToken,
    credentials.refreshToken || undefined,
    options.userId,
    options.mailboxId ?? credentials.mailboxId ?? null
  )

  return { gmail, credentials }
}
