import fs from 'node:fs/promises';
import path from 'node:path';

export type QueuedFileWriter = {
  filePath: string;
  write: (line: string) => Promise<void>;
};

const writers = new Map<string, QueuedFileWriter>();

export function getQueuedFileWriter(filePath: string): QueuedFileWriter {
  const existing = writers.get(filePath);
  if (existing) {
    return existing;
  }

  const dir = path.dirname(filePath);
  const ready = fs.mkdir(dir, { recursive: true }).catch(() => undefined);
  let queue = Promise.resolve();

  const writer: QueuedFileWriter = {
    filePath,
    write: async (line: string) => {
      queue = queue
        .then(() => ready)
        .then(() => fs.appendFile(filePath, line, 'utf8'))
        .catch(() => undefined);
      await queue;
    },
  };

  writers.set(filePath, writer);
  return writer;
}
