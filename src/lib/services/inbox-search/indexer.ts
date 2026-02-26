import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { buildInboxChunks, DEFAULT_CHUNK_OVERLAP_TOKENS, DEFAULT_CHUNK_SIZE_TOKENS } from '@/lib/services/inbox-search/chunker';
import { computeInboxContentHash } from '@/lib/services/inbox-search/content-hash';
import { prepareInboxBodyText } from '@/lib/services/inbox-search/text-prep';
import type { InboxSearchIndexInput, InboxSearchIndexResult } from '@/lib/services/inbox-search/types';

export type InboxSearchIndexerOptions = {
  shouldIndex?: (email: InboxSearchIndexInput) => boolean;
  chunkSizeTokens?: number;
  overlapTokens?: number;
};

const shouldIndexByDefault = (_email: InboxSearchIndexInput): boolean => true;

export async function indexInboxSearchEmail(
  email: InboxSearchIndexInput,
  options: InboxSearchIndexerOptions = {},
): Promise<InboxSearchIndexResult> {
  const contentHash = computeInboxContentHash(email.body);
  const shouldIndex = options.shouldIndex ?? shouldIndexByDefault;

  if (!shouldIndex(email)) {
    return {
      status: 'skipped_filtered',
      documentId: null,
      chunkCount: 0,
      contentHash,
    };
  }

  const indexedAt = new Date();
  const result = await prisma.$transaction(async (tx): Promise<InboxSearchIndexResult> => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${email.userId}, true)`;

    const existing = await tx.inboxSearchDocument.findUnique({
      where: {
        InboxSearchDocument_mailboxId_messageId_key: {
          mailboxId: email.mailboxId,
          messageId: email.messageId,
        },
      },
      select: {
        id: true,
        contentHash: true,
      },
    });

    if (existing && existing.contentHash === contentHash) {
      return {
        status: 'skipped_unchanged',
        documentId: existing.id,
        chunkCount: 0,
        contentHash,
      };
    }

    const bodyText = prepareInboxBodyText(email.body);
    const chunks = buildInboxChunks({
      bodyText,
      chunkSizeTokens: options.chunkSizeTokens ?? DEFAULT_CHUNK_SIZE_TOKENS,
      overlapTokens: options.overlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS,
    });

    const document = await tx.inboxSearchDocument.upsert({
      where: {
        InboxSearchDocument_mailboxId_messageId_key: {
          mailboxId: email.mailboxId,
          messageId: email.messageId,
        },
      },
      create: {
        userId: email.userId,
        mailboxId: email.mailboxId,
        threadId: email.threadId,
        messageId: email.messageId,
        from: email.from,
        to: email.to,
        cc: email.cc ?? [],
        subject: email.subject,
        snippet: email.snippet ?? null,
        bodyText,
        sentAt: email.sentAt,
        hasAttachment: email.hasAttachment,
        contentHash,
        indexedAt,
        isDeleted: false,
      },
      update: {
        userId: email.userId,
        mailboxId: email.mailboxId,
        threadId: email.threadId,
        from: email.from,
        to: email.to,
        cc: email.cc ?? [],
        subject: email.subject,
        snippet: email.snippet ?? null,
        bodyText,
        sentAt: email.sentAt,
        hasAttachment: email.hasAttachment,
        contentHash,
        indexedAt,
        isDeleted: false,
      },
      select: { id: true },
    });

    await tx.inboxSearchChunk.deleteMany({
      where: { documentId: document.id },
    });

    if (chunks.length > 0) {
      await tx.inboxSearchChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId: document.id,
          chunkIndex: chunk.chunkIndex,
          chunkText: chunk.chunkText,
          tokenCount: chunk.tokenCount,
        })),
      });
    }

    return {
      status: 'indexed',
      documentId: document.id,
      chunkCount: chunks.length,
      contentHash,
    };
  });

  if (result.status !== 'indexed') {
    return result;
  }

  logger.info('[InboxSearchIndexer] indexed email', {
    mailboxId: email.mailboxId,
    messageId: email.messageId,
    documentId: result.documentId,
    chunkCount: result.chunkCount,
  });

  return result;
}
