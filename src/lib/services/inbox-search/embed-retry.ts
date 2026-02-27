import { logger } from '@/lib/logger';
import {
  embedInboxDocumentChunks,
  getInboxEmbeddingConfig,
  logInboxEmbeddingFailure,
  storeInboxChunkEmbeddings,
} from '@/lib/services/inbox-search/embeddings';
import { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';
import type { InboxEmbedRetryJobData } from '@/lib/services/utils/queues';

type RetryEmbedResult =
  | {
      status: 'embedded';
      documentId: string;
      embeddedCount: number;
    }
  | {
      status: 'already_embedded' | 'skipped_missing';
      documentId: string | null;
      embeddedCount: 0;
    };

export async function retryInboxDocumentEmbeddings(
  job: InboxEmbedRetryJobData,
): Promise<RetryEmbedResult> {
  const document = await runInboxSearchTransaction(job.userId, async (tx) =>
    tx.inboxSearchDocument.findFirst({
      where: job.documentId
        ? {
            id: job.documentId,
            userId: job.userId,
          }
        : {
            userId: job.userId,
            mailboxId: job.mailboxId,
            messageId: job.messageId,
          },
      select: {
        id: true,
        subject: true,
        chunks: {
          where: {
            embeddedAt: null,
          },
          select: {
            chunkIndex: true,
            chunkText: true,
          },
          orderBy: {
            chunkIndex: 'asc',
          },
        },
      },
    }),
  );

  if (!document) {
    return {
      status: 'skipped_missing',
      documentId: null,
      embeddedCount: 0,
    };
  }

  const pendingChunks = document.chunks.filter((chunk) => chunk.chunkText.trim().length > 0);
  if (pendingChunks.length === 0) {
    return {
      status: 'already_embedded',
      documentId: document.id,
      embeddedCount: 0,
    };
  }

  try {
    const chunkEmbeddings = await embedInboxDocumentChunks({
      subject: document.subject,
      chunks: pendingChunks,
    });

    await storeInboxChunkEmbeddings({
      userId: job.userId,
      documentId: document.id,
      embeddingModel: getInboxEmbeddingConfig().model,
      records: chunkEmbeddings,
    });

    return {
      status: 'embedded',
      documentId: document.id,
      embeddedCount: chunkEmbeddings.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown embedding error';
    logInboxEmbeddingFailure(message, {
      userId: job.userId,
      mailboxId: job.mailboxId,
      messageId: job.messageId,
      documentId: document.id,
      retry: true,
    });
    logger.warn('[InboxSearchEmbeddings] retry failed', {
      userId: job.userId,
      mailboxId: job.mailboxId,
      messageId: job.messageId,
      documentId: document.id,
      error,
    });
    throw error;
  }
}
