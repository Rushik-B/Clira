import { prisma } from '@/lib/prisma';
import { syncAllMailboxLabels, SyncedLabel } from '@/lib/services/labels/syncUserLabels';

/**
 * Unified Read Helpers for Multi-Inbox Support
 *
 * These functions aggregate data across ALL connected mailboxes for a user.
 * Use these for "unified inbox" views where users see combined data.
 *
 * Design principles:
 * - Reads aggregate across mailboxes (unified view)
 * - Results include mailboxId for filtering/grouping in UI
 * - Provider-agnostic design for easy Outlook integration
 */

export type UnifiedLabel = SyncedLabel & {
  mailboxEmail?: string;
};

export type UnifiedThread = {
  id: string;
  userId: string;
  mailboxId: string | null;
  mailboxEmail?: string;
  subject: string | null;
  snippet: string | null;
  gmailThreadId: string | null;
  labelId: string | null;
  labelName?: string;
  emailCount: number;
  latestEmailAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UnifiedEmail = {
  id: string;
  threadId: string;
  mailboxId: string | null;
  mailboxEmail?: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string | null;
  body: string;
  messageId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  isSent: boolean;
  isDraft: boolean;
  createdAt: Date;
  labelId?: string;
  labelName?: string;
};

export interface UnifiedLabelsResult {
  labels: UnifiedLabel[];
  mailboxesProcessed: number;
  removedLabelIds: string[];
}

export interface UnifiedThreadsResult {
  threads: UnifiedThread[];
  total: number;
  mailboxIds: string[];
}

export interface UnifiedEmailsResult {
  emails: UnifiedEmail[];
  total: number;
  mailboxIds: string[];
}

/**
 * Get all labels across ALL connected mailboxes for a user.
 * Syncs with Gmail and returns unified list with mailbox context.
 *
 * Use case: Unified inbox sidebar showing all labels from all accounts.
 */
export async function getUnifiedLabels({
  userId,
  purpose,
  requester,
  includeSystemLabels = false,
  deleteMissing = true,
}: {
  userId: string;
  purpose: string;
  requester: string;
  includeSystemLabels?: boolean;
  deleteMissing?: boolean;
}): Promise<UnifiedLabelsResult> {
  // Get all connected mailboxes for this user
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, provider: 'google', status: 'CONNECTED' },
    select: { id: true, emailAddress: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  const mailboxMap = new Map(mailboxes.map(m => [m.id, m.emailAddress]));

  // Sync labels from all mailboxes
  const result = await syncAllMailboxLabels({
    userId,
    purpose,
    requester,
    includeSystemLabels,
    deleteMissing,
  });

  // Enrich labels with mailbox email
  const enrichedLabels: UnifiedLabel[] = result.labels.map(label => ({
    ...label,
    mailboxEmail: label.mailboxId ? mailboxMap.get(label.mailboxId) : undefined,
  }));

  return {
    labels: enrichedLabels,
    mailboxesProcessed: result.mailboxesProcessed,
    removedLabelIds: result.removedLabelIds,
  };
}

/**
 * Get labels from database without syncing (fast read).
 * Use when you don't need to sync with Gmail.
 */
export async function getUnifiedLabelsFromDb({
  userId,
  includeSystemLabels = false,
}: {
  userId: string;
  includeSystemLabels?: boolean;
}): Promise<UnifiedLabel[]> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, provider: 'google', status: 'CONNECTED' },
    select: { id: true, emailAddress: true },
  });

  const mailboxMap = new Map(mailboxes.map(m => [m.id, m.emailAddress]));

  const labels = await prisma.label.findMany({
    where: {
      userId,
      mailboxId: { not: null },
      ...(includeSystemLabels ? {} : { isSystemLabel: false }),
    },
    orderBy: [
      { mailboxId: 'asc' },
      { isSystemDefault: 'desc' },
      { name: 'asc' },
    ],
  });

  return labels.map(label => ({
    id: label.id,
    userId: label.userId,
    mailboxId: label.mailboxId,
    mailboxEmail: label.mailboxId ? mailboxMap.get(label.mailboxId) : undefined,
    name: label.name,
    color: label.color,
    gmailLabelId: label.gmailLabelId,
    isCustom: label.isCustom,
    isSystemDefault: label.isSystemDefault,
    isSystemLabel: label.isSystemLabel,
    emailCount: label.emailCount,
    metaPrompt: label.metaPrompt,
  }));
}

/**
 * Get threads across ALL connected mailboxes for a user.
 * Returns unified list with mailbox context for filtering.
 *
 * Use case: Unified inbox view showing threads from all accounts.
 *
 * Note: Thread model has no 'latestEmailAt' field - we compute it from emails.
 * For ordering, we use 'updatedAt' as proxy (updated when emails are added).
 */
export async function getUnifiedThreads({
  userId,
  labelId,
  limit = 50,
  offset = 0,
  orderBy = 'updatedAt',
  order = 'desc',
}: {
  userId: string;
  labelId?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  order?: 'asc' | 'desc';
}): Promise<UnifiedThreadsResult> {
  // Get all connected mailboxes
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, provider: 'google', status: 'CONNECTED' },
    select: { id: true, emailAddress: true },
  });

  const mailboxIds = mailboxes.map(m => m.id);
  const mailboxMap = new Map(mailboxes.map(m => [m.id, m.emailAddress]));

  // Build where clause (Thread has no labelId; filter by mailbox only)
  const where = {
    userId,
    mailboxId: { in: mailboxIds },
  };

  // Get total count
  const total = await prisma.thread.count({ where });

  // Get threads with emails for computing latestEmailAt (Thread has no emailCount/latestEmailAt fields)
  const threads = await prisma.thread.findMany({
    where,
    include: {
      emails: { select: { createdAt: true } },
    },
    orderBy: { [orderBy]: order },
    take: limit,
    skip: offset,
  });

  const unifiedThreads: UnifiedThread[] = threads.map(thread => {
    const emailCount = thread.emails.length;
    const latestEmailAt =
      emailCount > 0
        ? thread.emails.reduce((latest, e) => (e.createdAt > latest ? e.createdAt : latest), thread.emails[0].createdAt)
        : null;
    return {
      id: thread.id,
      userId: thread.userId,
      mailboxId: thread.mailboxId,
      mailboxEmail: thread.mailboxId ? mailboxMap.get(thread.mailboxId) : undefined,
      subject: thread.subject,
      snippet: thread.snippet,
      gmailThreadId: thread.gmailThreadId,
      labelId: null,
      labelName: undefined,
      emailCount,
      latestEmailAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
  });

  return {
    threads: unifiedThreads,
    total,
    mailboxIds,
  };
}

/**
 * Get emails across ALL connected mailboxes for a user.
 * Returns unified list with mailbox context.
 *
 * Use case: Unified search results, analytics, etc.
 */
export async function getUnifiedEmails({
  userId,
  threadId,
  labelId,
  isSent,
  limit = 50,
  offset = 0,
  orderBy = 'createdAt',
  order = 'desc',
}: {
  userId: string;
  threadId?: string;
  labelId?: string;
  isSent?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt';
  order?: 'asc' | 'desc';
}): Promise<UnifiedEmailsResult> {
  // Get all connected mailboxes
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, provider: 'google', status: 'CONNECTED' },
    select: { id: true, emailAddress: true },
  });

  const mailboxIds = mailboxes.map(m => m.id);
  const mailboxMap = new Map(mailboxes.map(m => [m.id, m.emailAddress]));

  // Build where clause - emails are accessed via thread (Thread has no labelId)
  const threadWhere = {
    userId,
    mailboxId: { in: mailboxIds },
  };

  const emailWhere = {
    thread: threadWhere,
    ...(threadId ? { threadId } : {}),
    ...(typeof isSent === 'boolean' ? { isSent } : {}),
  };

  // Get total count
  const total = await prisma.email.count({ where: emailWhere });

  // Get emails with thread (Thread has no label relation)
  const emails = await prisma.email.findMany({
    where: emailWhere,
    include: {
      thread: {
        select: {
          mailboxId: true,
        },
      },
    },
    orderBy: { [orderBy]: order },
    take: limit,
    skip: offset,
  });

  const unifiedEmails: UnifiedEmail[] = emails.map(email => ({
    id: email.id,
    threadId: email.threadId,
    mailboxId: email.thread.mailboxId,
    mailboxEmail: email.thread.mailboxId ? mailboxMap.get(email.thread.mailboxId) : undefined,
    from: email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    snippet: email.snippet,
    body: email.body,
    messageId: email.messageId,
    gmailMessageId: email.messageId,
    gmailThreadId: email.gmailThreadId,
    isSent: email.isSent,
    isDraft: email.isDraft,
    createdAt: email.createdAt,
    labelId: undefined,
    labelName: undefined,
  }));

  return {
    emails: unifiedEmails,
    total,
    mailboxIds,
  };
}

/**
 * Get queue emails (unprocessed) across ALL connected mailboxes.
 * For the unified queue view.
 */
export async function getUnifiedQueueEmails({
  userId,
  limit = 50,
  offset = 0,
}: {
  userId: string;
  limit?: number;
  offset?: number;
}): Promise<{
  emails: UnifiedEmail[];
  total: number;
  mailboxIds: string[];
}> {
  // Get all connected mailboxes
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId, provider: 'google', status: 'CONNECTED' },
    select: { id: true, emailAddress: true },
  });

  const mailboxIds = mailboxes.map(m => m.id);
  const mailboxMap = new Map(mailboxes.map(m => [m.id, m.emailAddress]));

  // Queue emails: not sent, not draft, no feedback yet
  const where = {
    isSent: false,
    isDraft: false,
    feedback: null,
    thread: {
      userId,
      mailboxId: { in: mailboxIds },
    },
  };

  const total = await prisma.email.count({ where });

  const emails = await prisma.email.findMany({
    where,
    include: {
      thread: {
        select: {
          mailboxId: true,
        },
      },
      generatedDraft: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const unifiedEmails: UnifiedEmail[] = emails.map(email => ({
    id: email.id,
    threadId: email.threadId,
    mailboxId: email.thread.mailboxId,
    mailboxEmail: email.thread.mailboxId ? mailboxMap.get(email.thread.mailboxId) : undefined,
    from: email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    snippet: email.snippet,
    body: email.body,
    messageId: email.messageId,
    gmailMessageId: email.messageId,
    gmailThreadId: email.gmailThreadId,
    isSent: email.isSent,
    isDraft: email.isDraft,
    createdAt: email.createdAt,
    labelId: undefined,
    labelName: undefined,
  }));

  return {
    emails: unifiedEmails,
    total,
    mailboxIds,
  };
}

/**
 * Group unified labels by mailbox for UI display.
 * Useful for showing labels organized by account.
 */
export function groupLabelsByMailbox(labels: UnifiedLabel[]): Map<string, UnifiedLabel[]> {
  const grouped = new Map<string, UnifiedLabel[]>();

  for (const label of labels) {
    const key = label.mailboxId || 'unknown';
    const existing = grouped.get(key) || [];
    existing.push(label);
    grouped.set(key, existing);
  }

  return grouped;
}

/**
 * Group unified threads by mailbox for UI display.
 */
export function groupThreadsByMailbox(threads: UnifiedThread[]): Map<string, UnifiedThread[]> {
  const grouped = new Map<string, UnifiedThread[]>();

  for (const thread of threads) {
    const key = thread.mailboxId || 'unknown';
    const existing = grouped.get(key) || [];
    existing.push(thread);
    grouped.set(key, existing);
  }

  return grouped;
}
