import { logger } from '@/lib/logger';
import type { InboxEmbedRetryJobData } from '@/lib/services/utils/queues';

export async function retryInboxDocumentEmbeddings(job: InboxEmbedRetryJobData): Promise<{
  status: 'pending_embeddings_not_implemented';
}> {
  logger.warn('[InboxSearchEmbeddings] retry requested before embedding pipeline is implemented', {
    documentId: job.documentId ?? null,
    mailboxId: job.mailboxId,
    messageId: job.messageId,
    userId: job.userId,
  });

  return { status: 'pending_embeddings_not_implemented' };
}
