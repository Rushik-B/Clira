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
import { buildInboxSearchInputFromParsedEmail } from '@/lib/services/inbox-search/ingestion';
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

export function isGmailAuthRevokedError(error: unknown): boolean {
  const candidate = error as
    | { code?: number; status?: number; response?: { status?: number } }
    | undefined;

  return (
    candidate?.status === 401 ||
    candidate?.code === 401 ||
    candidate?.response?.status === 401
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

  while (true) {
    let page;

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

      throw error;
    }

    pagesProcessed += 1;

    for (const thread of page.threads) {
      for (const email of thread.emails) {
        emailsSeen += 1;

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
