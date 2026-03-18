import type { GmailService } from '@/lib/email/gmail';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

type ReconcileSource =
  | 'queue-approve'
  | 'queue-edit'
  | 'queue-get-live-gmail'
  | 'gmail-push-external-send';

type ReconcileResolvedGeneratedDraftsInput = {
  userId: string;
  mailboxId: string;
  resolvedAt: Date;
  source: ReconcileSource;
  gmail: Pick<GmailService, 'deleteDraft'>;
  threadId?: string | null;
  gmailThreadId?: string | null;
  sentMessageId?: string | null;
};

type ReconcileResolvedGeneratedDraftsResult = {
  candidateCount: number;
  feedbackUpserts: number;
  cleanedDraftCount: number;
  retainedDraftCount: number;
};

type CandidateDraftRecord = {
  id: string;
  threadId: string;
  mailboxId: string | null;
  gmailThreadId: string | null;
  createdAt: Date;
  feedback: { id: string } | null;
  generatedDraft: {
    id: string;
    gmailDraftId: string;
  } | null;
};

function getDeleteDraftStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };

  const values = [candidate.status, candidate.code, candidate.response?.status];
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function isRetryableDeleteFailure(status: number | null): boolean {
  return status === 401
    || status === 403
    || status === 408
    || status === 409
    || status === 425
    || status === 429
    || (status !== null && status >= 500);
}

function buildReconciliationEditDelta(input: {
  source: ReconcileSource;
  resolvedAt: Date;
  sentMessageId?: string | null;
}): {
  external: true;
  sentVia: 'gmail_client';
  source: ReconcileSource;
  resolvedAt: string;
  sentMessageId?: string;
  reconciled: true;
} {
  const editDelta: {
    external: true;
    sentVia: 'gmail_client';
    source: ReconcileSource;
    resolvedAt: string;
    sentMessageId?: string;
    reconciled: true;
  } = {
    external: true,
    sentVia: 'gmail_client',
    source: input.source,
    resolvedAt: input.resolvedAt.toISOString(),
    reconciled: true,
  };

  if (input.sentMessageId) {
    editDelta.sentMessageId = input.sentMessageId;
  }

  return editDelta;
}

async function markDraftResolved(candidate: CandidateDraftRecord, input: ReconcileResolvedGeneratedDraftsInput): Promise<boolean> {
  if (!candidate.generatedDraft) {
    return false;
  }

  if (!candidate.feedback) {
    await prisma.feedback.upsert({
      where: { emailId: candidate.id },
      update: {
        action: 'ACCEPTED',
        editDelta: buildReconciliationEditDelta(input),
      },
      create: {
        userId: input.userId,
        emailId: candidate.id,
        action: 'ACCEPTED',
        editDelta: buildReconciliationEditDelta(input),
      },
    });
    return true;
  }

  return false;
}

async function removeGeneratedDraftPointer(generatedDraftId: string): Promise<void> {
  await prisma.generatedDraft.deleteMany({
    where: { id: generatedDraftId },
  });
}

export async function reconcileResolvedGeneratedDrafts(
  input: ReconcileResolvedGeneratedDraftsInput,
): Promise<ReconcileResolvedGeneratedDraftsResult> {
  if (!input.threadId && !input.gmailThreadId) {
    throw new Error('reconcileResolvedGeneratedDrafts requires threadId or gmailThreadId');
  }

  const candidates = await prisma.email.findMany({
    where: {
      thread: {
        userId: input.userId,
      },
      mailboxId: input.mailboxId,
      isSent: false,
      createdAt: {
        lte: input.resolvedAt,
      },
      generatedDraft: {
        isNot: null,
      },
      ...(input.threadId
        ? { threadId: input.threadId }
        : { gmailThreadId: input.gmailThreadId! }),
    },
    select: {
      id: true,
      threadId: true,
      mailboxId: true,
      gmailThreadId: true,
      createdAt: true,
      feedback: {
        select: {
          id: true,
        },
      },
      generatedDraft: {
        select: {
          id: true,
          gmailDraftId: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  let feedbackUpserts = 0;
  let cleanedDraftCount = 0;
  let retainedDraftCount = 0;

  for (const candidate of candidates) {
    if (!candidate.generatedDraft) {
      continue;
    }

    feedbackUpserts += Number(await markDraftResolved(candidate, input));

    try {
      await input.gmail.deleteDraft(candidate.generatedDraft.gmailDraftId);
      await removeGeneratedDraftPointer(candidate.generatedDraft.id);
      cleanedDraftCount += 1;
    } catch (error) {
      const status = getDeleteDraftStatus(error);

      if (status === 404) {
        await removeGeneratedDraftPointer(candidate.generatedDraft.id);
        cleanedDraftCount += 1;
        continue;
      }

      retainedDraftCount += 1;

      logger.warn('[stale-draft-reconciler] Draft cleanup degraded', {
        userId: input.userId,
        mailboxId: input.mailboxId,
        threadId: candidate.threadId,
        gmailThreadId: candidate.gmailThreadId,
        emailId: candidate.id,
        gmailDraftId: candidate.generatedDraft.gmailDraftId,
        generatedDraftId: candidate.generatedDraft.id,
        resolvedAt: input.resolvedAt.toISOString(),
        sentMessageId: input.sentMessageId ?? null,
        source: input.source,
        failureClass: isRetryableDeleteFailure(status) ? 'retryable' : 'unexpected',
        status,
      });
    }
  }

  return {
    candidateCount: candidates.length,
    feedbackUpserts,
    cleanedDraftCount,
    retainedDraftCount,
  };
}
