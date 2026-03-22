import { InboxBackfillState } from '@prisma/client';
import type { EmailData } from '@/lib/email/gmail';
import { logger } from '@/lib/logger';
import {
  getOrCreateInboxSearchCheckpoint,
  markInboxBackfillComplete,
  markInboxBackfillPausedAuthRevoked,
  resolveInboxBackfillResume,
  saveInboxBackfillProgress,
  type InboxBackfillPhase,
} from '@/lib/services/inbox-search/checkpoint';
import {
  buildInboxSearchInputFromParsedEmail,
  repairStoredEmailFromParsedEmail,
} from '@/lib/services/inbox-search/ingestion';
import { indexInboxSearchEmail } from '@/lib/services/inbox-search/indexer';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';

type GmailBackfillClient = {
  ensureAuthenticated: () => Promise<void>;
  searchThreadsPaged: (
    query: string,
    options?: { maxResults?: number; pageToken?: string },
  ) => Promise<{ threads: Array<{ threadId: string; emails: EmailData[] }>; nextPageToken?: string }>;
};

type BackfillDependencies = {
  createGmailClient?: typeof createGmailServiceForUser;
  indexEmail?: typeof indexInboxSearchEmail;
  sleep?: (ms: number) => Promise<void>;
};

export const INBOX_SEARCH_SEED_QUERY = 'newer_than:30d -in:spam -in:trash';
export const INBOX_SEARCH_BACKFILL_QUERY = 'newer_than:180d -in:spam -in:trash';
export const INBOX_SEARCH_BACKFILL_PAGE_SIZE = 20;
export const INBOX_SEARCH_BACKFILL_PAGE_DELAY_MS = 5_000;
const BACKFILL_MAX_PAGES = 500;
const RATE_LIMIT_BASE_DELAY_MS = 30_000;
const RATE_LIMIT_MAX_RETRIES = 5;

type BackfillPhaseResult = {
  status: 'phase_complete' | 'paused_auth_revoked';
  phase: InboxBackfillPhase;
  pagesProcessed: number;
  emailsSeen: number;
  indexedCount: number;
  skippedCount: number;
};

export type InboxMailboxBackfillResult = {
  status: 'complete' | 'paused_auth_revoked';
  startedFrom: InboxBackfillPhase;
  pagesProcessed: number;
  emailsSeen: number;
  indexedCount: number;
  skippedCount: number;
  backfillState: InboxBackfillState;
};

function extractHttpStatus(error: unknown): number | null {
  if (error == null || typeof error !== 'object') return null;
  const obj = error as Record<string, unknown>;
  if (typeof obj.status === 'number') return obj.status;
  if (typeof obj.code === 'number') return obj.code;
  if (typeof obj.response === 'object' && obj.response != null) {
    const resp = obj.response as Record<string, unknown>;
    if (typeof resp.status === 'number') return resp.status;
  }
  if (Array.isArray(obj.errors)) {
    for (const inner of obj.errors) {
      if (typeof inner === 'object' && inner != null && typeof (inner as Record<string, unknown>).code === 'number') {
        return (inner as Record<string, unknown>).code as number;
      }
    }
  }
  return null;
}

export function isGmailAuthRevokedError(error: unknown): boolean {
  return extractHttpStatus(error) === 401;
}

export function isGmailRateLimitError(error: unknown): boolean {
  return extractHttpStatus(error) === 429;
}

export function isInboxSearchRepairAuthOrOwnershipError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') {
    return false;
  }

  const record = error as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.toLowerCase() : '';
  const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';

  return (
    name.includes('forbidden') ||
    name.includes('unauthorized') ||
    name.includes('ownership') ||
    code.includes('forbidden') ||
    code.includes('unauthorized') ||
    code.includes('ownership') ||
    message.includes('another user') ||
    message.includes("another user's thread") ||
    message.includes('does not belong to user') ||
    message.includes('ownership mismatch') ||
    message.includes('forbidden') ||
    message.includes('unauthorized')
  );
}

async function runBackfillPhase(params: {
  userId: string;
  mailboxId: string;
  gmail: GmailBackfillClient;
  phase: InboxBackfillPhase;
  pageToken?: string;
  indexEmail: typeof indexInboxSearchEmail;
  sleep: (ms: number) => Promise<void>;
}): Promise<BackfillPhaseResult> {
  const { userId, mailboxId, gmail, phase, indexEmail, sleep } = params;
  const query = phase === 'seed' ? INBOX_SEARCH_SEED_QUERY : INBOX_SEARCH_BACKFILL_QUERY;
  let pageToken = params.pageToken;
  let pagesProcessed = 0;
  let emailsSeen = 0;
  let indexedCount = 0;
  let skippedCount = 0;

  await saveInboxBackfillProgress({
    userId,
    mailboxId,
    phase,
    pageToken: pageToken ?? null,
  });

  while (pagesProcessed < BACKFILL_MAX_PAGES) {
    let page: Awaited<ReturnType<GmailBackfillClient['searchThreadsPaged']>> | null = null;

    try {
      page = await gmail.searchThreadsPaged(query, {
        maxResults: INBOX_SEARCH_BACKFILL_PAGE_SIZE,
        ...(pageToken ? { pageToken } : {}),
      });
    } catch (error) {
      if (isGmailAuthRevokedError(error)) {
        await markInboxBackfillPausedAuthRevoked({
          userId,
          mailboxId,
          phase,
          pageToken: pageToken ?? null,
          lastIndexedAt: new Date(),
        });

        return {
          status: 'paused_auth_revoked',
          phase,
          pagesProcessed,
          emailsSeen,
          indexedCount,
          skippedCount,
        };
      }

      if (isGmailRateLimitError(error)) {
        let retried = false;
        for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
          const backoffMs = RATE_LIMIT_BASE_DELAY_MS * attempt;
          logger.warn('[InboxSearchBackfill] Gmail rate-limited (429), backing off', {
            userId,
            mailboxId,
            phase,
            attempt,
            backoffMs,
          });
          await sleep(backoffMs);
          try {
            page = await gmail.searchThreadsPaged(query, {
              maxResults: INBOX_SEARCH_BACKFILL_PAGE_SIZE,
              ...(pageToken ? { pageToken } : {}),
            });
            retried = true;
            break;
          } catch (retryError) {
            if (!isGmailRateLimitError(retryError)) {
              throw retryError;
            }
          }
        }
        if (!retried) {
          throw new Error(
            `Gmail rate limit (429) persisted after ${RATE_LIMIT_MAX_RETRIES} retries for mailbox ${mailboxId}`,
          );
        }
      } else {
        throw error;
      }
    }

    if (!page) {
      throw new Error(
        `Inbox backfill failed to fetch a Gmail page for mailbox ${mailboxId}.`,
      );
    }

    pagesProcessed += 1;

    for (const thread of page.threads) {
      for (const email of thread.emails) {
        emailsSeen += 1;

        try {
          await repairStoredEmailFromParsedEmail({
            userId,
            mailboxId,
            email,
          });
        } catch (error) {
          if (isInboxSearchRepairAuthOrOwnershipError(error)) {
            throw error;
          }

          logger.warn('[InboxSearchBackfill] failed to repair stored email body before indexing', {
            userId,
            mailboxId,
            messageId: email.messageId,
            error,
          });
        }

        const result = await indexEmail(
          buildInboxSearchInputFromParsedEmail({
            userId,
            mailboxId,
            threadId: thread.threadId,
            email,
          }),
        );

        if (result.status === 'indexed') {
          indexedCount += 1;
        } else {
          skippedCount += 1;
        }
      }
    }

    const lastIndexedAt = new Date();

    if (!page.nextPageToken) {
      if (phase === 'seed') {
        await saveInboxBackfillProgress({
          userId,
          mailboxId,
          phase: 'backfill',
          pageToken: null,
          lastIndexedAt,
        });
      } else {
        await markInboxBackfillComplete({
          userId,
          mailboxId,
          lastIndexedAt,
        });
      }

      return {
        status: 'phase_complete',
        phase,
        pagesProcessed,
        emailsSeen,
        indexedCount,
        skippedCount,
      };
    }

    pageToken = page.nextPageToken;
    await saveInboxBackfillProgress({
      userId,
      mailboxId,
      phase,
      pageToken,
      lastIndexedAt,
    });

    await sleep(INBOX_SEARCH_BACKFILL_PAGE_DELAY_MS);
  }

  logger.warn('[InboxSearchBackfill] hit max-pages safety limit', {
    userId,
    mailboxId,
    phase,
    maxPages: BACKFILL_MAX_PAGES,
    pagesProcessed,
  });
  throw new Error(
    `Backfill exceeded max page limit (${BACKFILL_MAX_PAGES}) for mailbox ${mailboxId} phase ${phase}`,
  );
}

export async function runInboxMailboxBackfill(
  params: {
    userId: string;
    mailboxId: string;
  },
  deps: BackfillDependencies = {},
): Promise<InboxMailboxBackfillResult> {
  const { userId, mailboxId } = params;
  const createGmailClient = deps.createGmailClient ?? createGmailServiceForUser;
  const indexEmail = deps.indexEmail ?? indexInboxSearchEmail;
  const sleep =
    deps.sleep ??
    (async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  const checkpoint = await getOrCreateInboxSearchCheckpoint({ userId, mailboxId });
  if (checkpoint.backfillState === InboxBackfillState.COMPLETE) {
    return {
      status: 'complete',
      startedFrom: 'backfill',
      pagesProcessed: 0,
      emailsSeen: 0,
      indexedCount: 0,
      skippedCount: 0,
      backfillState: InboxBackfillState.COMPLETE,
    };
  }

  const resumePoint = resolveInboxBackfillResume(checkpoint) ?? { phase: 'seed' as const };

  const gmailContext = await createGmailClient({
    userId,
    mailboxId,
    purpose: `inbox-search:backfill:${resumePoint.phase}`,
    requester: 'inbox-search.runInboxMailboxBackfill',
  });

  if (!gmailContext) {
    await markInboxBackfillPausedAuthRevoked({
      userId,
      mailboxId,
      phase: resumePoint.phase,
      pageToken: resumePoint.pageToken ?? null,
      lastIndexedAt: checkpoint.lastIndexedAt ?? null,
    });

    return {
      status: 'paused_auth_revoked',
      startedFrom: resumePoint.phase,
      pagesProcessed: 0,
      emailsSeen: 0,
      indexedCount: 0,
      skippedCount: 0,
      backfillState: InboxBackfillState.PAUSED_AUTH_REVOKED,
    };
  }

  try {
    await gmailContext.gmail.ensureAuthenticated();
  } catch (error) {
    if (isGmailAuthRevokedError(error)) {
      await markInboxBackfillPausedAuthRevoked({
        userId,
        mailboxId,
        phase: resumePoint.phase,
        pageToken: resumePoint.pageToken ?? null,
        lastIndexedAt: checkpoint.lastIndexedAt ?? null,
      });

      return {
        status: 'paused_auth_revoked',
        startedFrom: resumePoint.phase,
        pagesProcessed: 0,
        emailsSeen: 0,
        indexedCount: 0,
        skippedCount: 0,
        backfillState: InboxBackfillState.PAUSED_AUTH_REVOKED,
      };
    }

    throw error;
  }

  const phases: Array<{ phase: InboxBackfillPhase; pageToken?: string }> =
    resumePoint.phase === 'backfill'
      ? [{ phase: 'backfill', pageToken: resumePoint.pageToken }]
      : [
          { phase: 'seed', pageToken: resumePoint.pageToken },
          { phase: 'backfill' },
        ];

  let pagesProcessed = 0;
  let emailsSeen = 0;
  let indexedCount = 0;
  let skippedCount = 0;

  for (const phaseConfig of phases) {
    logger.info('[InboxSearchBackfill] starting phase', {
      userId,
      mailboxId,
      phase: phaseConfig.phase,
      pageToken: phaseConfig.pageToken ?? null,
    });

    const result = await runBackfillPhase({
      userId,
      mailboxId,
      gmail: gmailContext.gmail,
      phase: phaseConfig.phase,
      pageToken: phaseConfig.pageToken,
      indexEmail,
      sleep,
    });

    pagesProcessed += result.pagesProcessed;
    emailsSeen += result.emailsSeen;
    indexedCount += result.indexedCount;
    skippedCount += result.skippedCount;

    if (result.status === 'paused_auth_revoked') {
      return {
        status: 'paused_auth_revoked',
        startedFrom: resumePoint.phase,
        pagesProcessed,
        emailsSeen,
        indexedCount,
        skippedCount,
        backfillState: InboxBackfillState.PAUSED_AUTH_REVOKED,
      };
    }
  }

  return {
    status: 'complete',
    startedFrom: resumePoint.phase,
    pagesProcessed,
    emailsSeen,
    indexedCount,
    skippedCount,
    backfillState: InboxBackfillState.COMPLETE,
  };
}
