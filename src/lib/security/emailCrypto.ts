/**
 * Email content (subject, body, from, to, cc, snippet) is stored as plaintext
 * in the database. This is safe for self-hosted deployments where the database
 * runs locally and email data never leaves the user's machine.
 *
 * OAuth tokens are still encrypted — see src/lib/encryption.ts.
 *
 * These functions are kept as no-ops for API compatibility with callers.
 */

export type EmailRecord = {
  id: string
  threadId: string
  subject: string
  body: string
  from: string
  to: string[]
  cc: string[]
  snippet?: string | null
  thread?: { id: string; userId: string; subject: string; snippet?: string | null }
  [key: string]: unknown
}

export type ThreadRecord = {
  id: string
  userId: string
  subject: string
  snippet?: string | null
  [key: string]: unknown
}

export async function encryptEmailContent(_params: { userId: string; data: Record<string, unknown> }): Promise<Record<string, unknown>> {
  return {}
}

export async function encryptThreadContent(_params: { userId: string; data: Record<string, unknown> }): Promise<Record<string, unknown>> {
  return {}
}

export async function decryptEmailContent<T extends EmailRecord>(
  { email }: { email: T; userId?: string },
  _opts?: { skipWriteBack?: boolean }
): Promise<T> {
  return email
}

export async function decryptThreadContent<T extends ThreadRecord>(
  { thread }: { thread: T; userId?: string },
  _opts?: { skipWriteBack?: boolean }
): Promise<T> {
  return thread
}

export async function decryptEmails<T extends EmailRecord>(
  emails: T[],
  _userId?: string,
  _opts?: { skipWriteBack?: boolean; concurrency?: number }
): Promise<T[]> {
  return emails
}
