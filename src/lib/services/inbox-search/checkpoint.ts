import { InboxBackfillState, Prisma } from '@prisma/client';
import { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';

export type InboxBackfillPhase = 'seed' | 'backfill';

const checkpointSelect = {
  id: true,
  userId: true,
  mailboxId: true,
  lastHistoryIdIndexed: true,
  backfillState: true,
  lastBackfillCursor: true,
  lastIndexedAt: true,
  lagEstimate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InboxSearchCheckpointSelect;

export type InboxSearchCheckpointRecord = Prisma.InboxSearchCheckpointGetPayload<{
  select: typeof checkpointSelect;
}>;

function phaseToState(phase: InboxBackfillPhase): InboxBackfillState {
  return phase === 'seed' ? InboxBackfillState.SEEDING : InboxBackfillState.BACKFILLING;
}

export function serializeInboxBackfillCursor(
  phase: InboxBackfillPhase,
  pageToken?: string | null,
): string {
  return `${phase}:${pageToken ?? ''}`;
}

export function parseInboxBackfillCursor(
  cursor?: string | null,
): { phase: InboxBackfillPhase; pageToken?: string } | null {
  if (!cursor) {
    return null;
  }

  if (cursor.startsWith('seed:')) {
    const pageToken = cursor.slice('seed:'.length);
    return { phase: 'seed', ...(pageToken ? { pageToken } : {}) };
  }

  if (cursor.startsWith('backfill:')) {
    const pageToken = cursor.slice('backfill:'.length);
    return { phase: 'backfill', ...(pageToken ? { pageToken } : {}) };
  }

  return { phase: 'backfill', pageToken: cursor };
}

export function resolveInboxBackfillResume(
  checkpoint: Pick<InboxSearchCheckpointRecord, 'backfillState' | 'lastBackfillCursor'>,
): { phase: InboxBackfillPhase; pageToken?: string } | null {
  if (checkpoint.backfillState === InboxBackfillState.COMPLETE) {
    return null;
  }

  const parsedCursor = parseInboxBackfillCursor(checkpoint.lastBackfillCursor);
  if (parsedCursor) {
    return parsedCursor;
  }

  if (checkpoint.backfillState === InboxBackfillState.BACKFILLING) {
    return { phase: 'backfill' };
  }

  return { phase: 'seed' };
}

export async function getOrCreateInboxSearchCheckpoint(params: {
  userId: string;
  mailboxId: string;
}): Promise<InboxSearchCheckpointRecord> {
  const { userId, mailboxId } = params;

  return runInboxSearchTransaction(userId, async (tx) =>
    tx.inboxSearchCheckpoint.upsert({
      where: {
        InboxSearchCheckpoint_userId_mailboxId_key: {
          userId,
          mailboxId,
        },
      },
      update: {},
      create: {
        userId,
        mailboxId,
      },
      select: checkpointSelect,
    }),
  );
}

export async function touchInboxSearchRealtimeCheckpoint(params: {
  userId: string;
  mailboxId: string;
  lastIndexedAt?: Date;
  lastHistoryIdIndexed?: string | null;
}): Promise<InboxSearchCheckpointRecord> {
  const { userId, mailboxId, lastIndexedAt = new Date(), lastHistoryIdIndexed } = params;

  return runInboxSearchTransaction(userId, async (tx) =>
    tx.inboxSearchCheckpoint.upsert({
      where: {
        InboxSearchCheckpoint_userId_mailboxId_key: {
          userId,
          mailboxId,
        },
      },
      update: {
        lastIndexedAt,
        ...(lastHistoryIdIndexed ? { lastHistoryIdIndexed } : {}),
      },
      create: {
        userId,
        mailboxId,
        lastIndexedAt,
        ...(lastHistoryIdIndexed ? { lastHistoryIdIndexed } : {}),
      },
      select: checkpointSelect,
    }),
  );
}

export async function saveInboxBackfillProgress(params: {
  userId: string;
  mailboxId: string;
  phase: InboxBackfillPhase;
  pageToken?: string | null;
  lastIndexedAt?: Date | null;
}): Promise<InboxSearchCheckpointRecord> {
  const { userId, mailboxId, phase, pageToken, lastIndexedAt } = params;
  const serializedCursor = serializeInboxBackfillCursor(phase, pageToken);
  const backfillState = phaseToState(phase);

  return runInboxSearchTransaction(userId, async (tx) =>
    tx.inboxSearchCheckpoint.upsert({
      where: {
        InboxSearchCheckpoint_userId_mailboxId_key: {
          userId,
          mailboxId,
        },
      },
      update: {
        backfillState,
        lastBackfillCursor: serializedCursor,
        ...(lastIndexedAt ? { lastIndexedAt } : {}),
      },
      create: {
        userId,
        mailboxId,
        backfillState,
        lastBackfillCursor: serializedCursor,
        ...(lastIndexedAt ? { lastIndexedAt } : {}),
      },
      select: checkpointSelect,
    }),
  );
}

export async function markInboxBackfillPausedAuthRevoked(params: {
  userId: string;
  mailboxId: string;
  phase: InboxBackfillPhase;
  pageToken?: string | null;
  lastIndexedAt?: Date | null;
}): Promise<InboxSearchCheckpointRecord> {
  const { userId, mailboxId, phase, pageToken, lastIndexedAt } = params;

  return runInboxSearchTransaction(userId, async (tx) =>
    tx.inboxSearchCheckpoint.upsert({
      where: {
        InboxSearchCheckpoint_userId_mailboxId_key: {
          userId,
          mailboxId,
        },
      },
      update: {
        backfillState: InboxBackfillState.PAUSED_AUTH_REVOKED,
        lastBackfillCursor: serializeInboxBackfillCursor(phase, pageToken),
        ...(lastIndexedAt ? { lastIndexedAt } : {}),
      },
      create: {
        userId,
        mailboxId,
        backfillState: InboxBackfillState.PAUSED_AUTH_REVOKED,
        lastBackfillCursor: serializeInboxBackfillCursor(phase, pageToken),
        ...(lastIndexedAt ? { lastIndexedAt } : {}),
      },
      select: checkpointSelect,
    }),
  );
}

export async function markInboxBackfillComplete(params: {
  userId: string;
  mailboxId: string;
  lastIndexedAt?: Date | null;
}): Promise<InboxSearchCheckpointRecord> {
  const { userId, mailboxId, lastIndexedAt } = params;

  return runInboxSearchTransaction(userId, async (tx) =>
    tx.inboxSearchCheckpoint.upsert({
      where: {
        InboxSearchCheckpoint_userId_mailboxId_key: {
          userId,
          mailboxId,
        },
      },
      update: {
        backfillState: InboxBackfillState.COMPLETE,
        lastBackfillCursor: null,
        ...(lastIndexedAt ? { lastIndexedAt } : {}),
      },
      create: {
        userId,
        mailboxId,
        backfillState: InboxBackfillState.COMPLETE,
        lastBackfillCursor: null,
        ...(lastIndexedAt ? { lastIndexedAt } : {}),
      },
      select: checkpointSelect,
    }),
  );
}
