import { prisma } from '@/lib/prisma'
import { QueueItem } from '@/types'
import { decryptEmails } from '@/lib/security/emailCrypto'

/**
 * Fetch the base set of queue-eligible emails for a user.
 * These are emails that are:
 *  - owned by the user (via thread.userId)
 *  - not sent (incoming)
 *  - have no feedback yet
 *  - have a generated reply
 *  - NOT already replied to in Gmail (thread doesn't have sent emails after this email)
 * Optional extraWhere allows additional constraints (e.g., messageId IN ...).
 */
export async function getBaseQueueEmails(
  userId: string,
  options?: { extraWhere?: Record<string, unknown>; limit?: number; offset?: number }
) {
  const { extraWhere, limit, offset } = options || {};
  const where = {
    ...(extraWhere || {}),
    thread: { userId },
    isSent: false,
    feedback: null,
    generatedDraft: { isNot: null },
  } as any

  let emails = await prisma.email.findMany({
    where,
    include: {
      generatedDraft: true,
      thread: true,
      mailbox: {
        select: {
          id: true,
          emailAddress: true,
          provider: true,
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: typeof limit === 'number' ? Math.max(0, Math.min(50, limit)) : undefined,
    skip: typeof offset === 'number' ? Math.max(0, offset) : undefined,
  })

  // Decrypt without DB write-backs to keep API fast; perform any normalization asynchronously elsewhere
  emails = await decryptEmails(emails, userId, { skipWriteBack: true, concurrency: 4 })

  // Filter out emails that have been replied to externally (in Gmail)
  if (emails.length > 0) {
    // Get unique thread IDs
    const threadIds = [...new Set(emails.map(email => email.threadId))]
    
    // Find the latest sent email in each thread
    const lastSentEmails = await prisma.email.groupBy({
      by: ['threadId'],
      _max: { createdAt: true },
      where: {
        threadId: { in: threadIds },
        isSent: true,
      },
    })
    
    // Create a map of threadId -> last sent timestamp
    const lastSentMap = new Map(
      lastSentEmails.map(result => [result.threadId, result._max.createdAt])
    )
    
    // Filter out emails where a sent reply exists after the email's timestamp
    const filteredEmails = emails.filter(email => {
      const lastSentTime = lastSentMap.get(email.threadId)
      if (!lastSentTime) return true // No sent emails in thread, keep it
      
      // Keep only if this email was received AFTER the last sent email
      // (meaning it's a new email that hasn't been replied to yet)
      const keepEmail = email.createdAt >= lastSentTime
      
      if (!keepEmail) {
        console.log(`📧 Filtering out already-replied email: ${email.id} from ${email.from} (replied at ${lastSentTime})`)
      }
      
      return keepEmail
    })
    
    console.log(`📧 Queue filter: ${emails.length} emails → ${filteredEmails.length} after removing already-replied`)
    
    // Use the filtered emails for the rest of the processing
    emails.splice(0, emails.length, ...filteredEmails)
  }

  // Fetch labels for all emails in a single query
  if (emails.length > 0) {
    const messageIds = emails.map(email => email.messageId);
    const emailSorts = await prisma.emailSort.findMany({
      where: {
        gmailMessageId: { in: messageIds },
        userId: where.thread?.userId || '',
      },
      include: {
        label: {
          select: {
            id: true,
            name: true,
            color: true,
            gmailLabelId: true,
          }
        }
      },
    });

    // Group sorts by messageId for easy lookup
    const sortsByMessageId = emailSorts.reduce((acc, sort) => {
      if (!acc[sort.gmailMessageId]) {
        acc[sort.gmailMessageId] = [];
      }
      acc[sort.gmailMessageId].push(sort);
      return acc;
    }, {} as Record<string, typeof emailSorts>);

    // Attach labels to emails
    emails.forEach(email => {
      const sorts = sortsByMessageId[email.messageId] || [];
      (email as any).emailSorts = sorts;
    });
  }

  return emails
}

/**
 * Map emails with generated replies to QueueItem format.
 * Filters out any entries with empty or null drafts (safety check).
 */
export function mapEmailsToQueueItems(
  emails: any[],
  draftsByEmail: Map<string, { body: string; cc: string[]; subject: string; draftId: string }>
): QueueItem[] {
  return emails
    .map((email: any) => {
      const record = draftsByEmail.get(email.id)
      if (!record) {
        return null
      }

      const trimmed = typeof record.body === 'string' ? record.body.trim() : ''
      if (trimmed.length === 0) {
        return null
      }

      const preview = trimmed.substring(0, 150) + (trimmed.length > 150 ? '...' : '')

      return {
        id: email.id,
        actionSummary: `Reply to: ${email.subject}`,
        contextSummary: (email.snippet && typeof email.snippet === 'string' && email.snippet.trim().length > 0)
          ? email.snippet.trim()
          : `From: ${email.from}`,
        status: 'needs-attention',
        confidence: email.generatedDraft?.confidenceScore ?? 0,
        draftPreview: preview,
        fullDraft: trimmed,
        metadata: {
          emailId: email.id,
          from: email.from,
          subject: email.subject,
          body: email.body,
          receivedAt: email.createdAt.toISOString(),
          mailboxId: email.mailboxId || email.mailbox?.id,
          mailboxEmail: email.mailbox?.emailAddress,
          mailboxProvider: email.mailbox?.provider,
          mailboxDisplayName: email.mailbox?.displayName,
          gmailDraftId: email.generatedDraft?.gmailDraftId,
          ccRecipients: record.cc,
          labels: email.emailSorts?.map((sort: any) => ({
            id: sort.label.id,
            name: sort.label.name,
            color: sort.label.color || '#6B7280',
            gmailLabelId: sort.label.gmailLabelId || undefined,
          })) || [],
        },
      } satisfies QueueItem
    })
    .filter((item) => item !== null) as QueueItem[]
}


/**
 * Fetch emails that are currently in processing (reply generation started but not yet persisted).
 * These power the greyed-out placeholders that should persist across reloads until ready/fail.
 */
export async function getProcessingEmails(
  userId: string,
  extraWhere?: Record<string, unknown>
) {
  const where = {
    ...(extraWhere || {}),
    thread: { userId },
    isSent: false,
    feedback: null,
    generatedDraft: null,
    isProcessing: true,
  } as any

  let emails = await prisma.email.findMany({
    where,
    include: {
      generatedDraft: true,
      thread: true,
      mailbox: {
        select: {
          id: true,
          emailAddress: true,
          provider: true,
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  emails = await decryptEmails(emails, userId)

  // Fetch labels for all emails in a single query (same strategy as base queue)
  if (emails.length > 0) {
    const messageIds = emails.map(email => email.messageId);
    const emailSorts = await prisma.emailSort.findMany({
      where: {
        gmailMessageId: { in: messageIds },
        userId: where.thread?.userId || '',
      },
      include: {
        label: {
          select: {
            id: true,
            name: true,
            color: true,
            gmailLabelId: true,
          }
        }
      },
    });

    const sortsByMessageId = emailSorts.reduce((acc, sort) => {
      if (!acc[sort.gmailMessageId]) {
        acc[sort.gmailMessageId] = [];
      }
      acc[sort.gmailMessageId].push(sort);
      return acc;
    }, {} as Record<string, typeof emailSorts>);

    emails.forEach(email => {
      const sorts = sortsByMessageId[email.messageId] || [];
      (email as any).emailSorts = sorts;
    });
  }

  return emails
}

/**
 * Map processing emails to placeholder QueueItem format.
 * These items have confidence 0, empty fullDraft, and a draftPreview indicating generation.
 */
export function mapEmailsToProcessingPlaceholders(emails: any[]): QueueItem[] {
  return emails.map((email: any) => {
    return {
      id: email.id,
      actionSummary: `Reply to: ${email.subject}`,
      contextSummary: (email.snippet && typeof email.snippet === 'string' && email.snippet.trim().length > 0)
        ? email.snippet.trim()
        : `From: ${email.from}`,
      status: 'needs-attention',
      confidence: 0,
      draftPreview: 'Generating reply…',
      fullDraft: '',
      metadata: {
        emailId: email.id,
        from: email.from,
        subject: email.subject,
        body: email.body,
        receivedAt: email.createdAt.toISOString(),
        mailboxId: email.mailboxId || email.mailbox?.id,
        mailboxEmail: email.mailbox?.emailAddress,
        mailboxProvider: email.mailbox?.provider,
        mailboxDisplayName: email.mailbox?.displayName,
        // Signal processing state to the client so it can render greyed-out state after reload
        isProcessing: true,
        labels: email.emailSorts?.map((sort: any) => ({
          id: sort.label.id,
          name: sort.label.name,
          color: sort.label.color || '#6B7280',
          gmailLabelId: sort.label.gmailLabelId || undefined,
        })) || [],
      },
    } satisfies QueueItem
  })
}
