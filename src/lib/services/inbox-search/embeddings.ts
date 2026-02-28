import { Prisma } from '@prisma/client';
import { withRetry } from '@/lib/ai/retry';
import { logger } from '@/lib/logger';
import { runInboxSearchTransaction } from '@/lib/services/inbox-search/tx';

const GEMINI_EMBEDDING_MODEL =
  process.env.INBOX_SEARCH_EMBEDDING_MODEL ?? 'gemini-embedding-001';
const GEMINI_EMBEDDING_DIMENSIONS = 768;
const GEMINI_EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`;
const GEMINI_EMBEDDING_MAX_CHARS = 8_000;
const GEMINI_EMBEDDING_BATCH_SIZE = 8;

type InboxEmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

type GeminiEmbeddingResponse = {
  embedding?: {
    values?: number[];
  };
  embeddings?: Array<{
    values?: number[];
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export type InboxChunkEmbeddingRecord = {
  chunkIndex: number;
  embedding: number[];
};

function getGeminiApiKey(): string {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey?.trim()) {
    throw new Error(
      'Gemini API key is required for inbox embeddings (GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY).',
    );
  }

  return apiKey.trim();
}

function normalizeEmbeddingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, GEMINI_EMBEDDING_MAX_CHARS);
}

function assertValidEmbedding(values: number[], textLabel: string): number[] {
  if (values.length !== GEMINI_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid embedding dimension for ${textLabel}: expected ${GEMINI_EMBEDDING_DIMENSIONS}, got ${values.length}`,
    );
  }

  if (!values.every((value) => Number.isFinite(value))) {
    throw new Error(`Embedding for ${textLabel} contains non-finite values.`);
  }

  return values;
}

export function serializeVectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toString()).join(',')}]`;
}

async function requestGeminiEmbedding(params: {
  text: string;
  taskType: InboxEmbeddingTaskType;
  title?: string;
  abortSignal?: AbortSignal;
}): Promise<number[]> {
  const apiKey = getGeminiApiKey();
  const text = normalizeEmbeddingText(params.text);

  if (!text) {
    throw new Error('Cannot embed empty text.');
  }

  return withRetry(
    async () => {
      const response = await fetch(GEMINI_EMBEDDING_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          content: {
            parts: [{ text }],
          },
          taskType: params.taskType,
          ...(params.title ? { title: params.title.slice(0, 256) } : {}),
          outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
        }),
        signal: params.abortSignal,
      });

      const payload = (await response.json().catch(() => ({}))) as GeminiEmbeddingResponse;
      if (!response.ok) {
        const error = new Error(
          payload.error?.message ??
            `Gemini embedding request failed with status ${response.status}`,
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      const values =
        payload.embedding?.values ?? payload.embeddings?.[0]?.values;

      if (!values) {
        throw new Error('Gemini embedding response did not include embedding values.');
      }

      return assertValidEmbedding(values, params.taskType);
    },
    {
      maxAttempts: 3,
      baseDelayMs: 500,
    },
  );
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = [];

  for (let start = 0; start < items.length; start += GEMINI_EMBEDDING_BATCH_SIZE) {
    const batch = items.slice(start, start + GEMINI_EMBEDDING_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((item, index) => mapper(item, start + index)),
    );
    results.push(...batchResults);
  }

  return results;
}

export async function embedInboxQueryText(params: {
  text: string;
  abortSignal?: AbortSignal;
}): Promise<number[]> {
  return requestGeminiEmbedding({
    text: params.text,
    taskType: 'RETRIEVAL_QUERY',
    abortSignal: params.abortSignal,
  });
}

export async function embedInboxDocumentChunks(params: {
  subject: string;
  chunks: Array<{ chunkIndex: number; chunkText: string }>;
  abortSignal?: AbortSignal;
}): Promise<InboxChunkEmbeddingRecord[]> {
  const embeddableChunks = params.chunks.filter((chunk) =>
    normalizeEmbeddingText(chunk.chunkText).length > 0,
  );

  if (embeddableChunks.length === 0) {
    return [];
  }

  return mapWithConcurrency(embeddableChunks, async (chunk) => ({
    chunkIndex: chunk.chunkIndex,
    embedding: await requestGeminiEmbedding({
      text: chunk.chunkText,
      taskType: 'RETRIEVAL_DOCUMENT',
      title: params.subject || undefined,
      abortSignal: params.abortSignal,
    }),
  }));
}

export async function storeInboxChunkEmbeddings(params: {
  userId: string;
  documentId: string;
  embeddingModel?: string;
  embeddedAt?: Date;
  records: InboxChunkEmbeddingRecord[];
}): Promise<void> {
  if (params.records.length === 0) {
    return;
  }

  const embeddingModel = params.embeddingModel ?? GEMINI_EMBEDDING_MODEL;
  const embeddedAt = params.embeddedAt ?? new Date();

  await runInboxSearchTransaction(params.userId, async (tx) => {
    for (const record of params.records) {
      const vectorLiteral = serializeVectorLiteral(record.embedding);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "InboxSearchChunk"
        SET
          "embedding" = ${vectorLiteral}::vector,
          "embeddingModel" = ${embeddingModel},
          "embeddedAt" = ${embeddedAt}
        WHERE
          "documentId" = ${params.documentId}
          AND "chunkIndex" = ${record.chunkIndex}
      `);
    }
  });
}

export function getInboxEmbeddingConfig(): {
  model: string;
  dimensions: number;
} {
  return {
    model: GEMINI_EMBEDDING_MODEL,
    dimensions: GEMINI_EMBEDDING_DIMENSIONS,
  };
}

export function logInboxEmbeddingFailure(message: string, context: Record<string, unknown>) {
  logger.warn('[InboxSearchEmbeddings] embedding request failed', {
    message,
    ...context,
  });
}
