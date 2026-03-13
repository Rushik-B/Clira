import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';

export type QueuedFileWriter = {
  filePath: string;
  write: (line: string) => Promise<void>;
  flush: () => Promise<void>;
};

const writers = new Map<string, QueuedFileWriter>();

export function getQueuedFileWriter(filePath: string): QueuedFileWriter {
  const existing = writers.get(filePath);
  if (existing) {
    return existing;
  }

  const dir = path.dirname(filePath);
  const ready = fs.mkdir(dir, { recursive: true }).catch((err) => {
    logger.warn('[ai-tracing] Failed to create trace dir', { dir, error: err instanceof Error ? err.message : String(err) });
    return undefined;
  });
  let queue = Promise.resolve();

  const writer: QueuedFileWriter = {
    filePath,
    write: async (line: string) => {
      queue = queue
        .then(() => ready)
        .then(() => fs.appendFile(filePath, line, 'utf8'))
        .catch((err) => {
          logger.warn('[ai-tracing] Failed to write trace', { filePath, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        });
      await queue;
    },
    flush: async () => {
      await queue;
    },
  };

  writers.set(filePath, writer);
  return writer;
}

export async function releaseQueuedFileWriter(filePath: string): Promise<void> {
  const writer = writers.get(filePath);
  if (!writer) {
    return;
  }

  await writer.flush();

  if (writers.get(filePath) === writer) {
    writers.delete(filePath);
  }
}
