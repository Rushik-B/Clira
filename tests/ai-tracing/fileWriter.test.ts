import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getQueuedFileWriter } from '@/lib/ai/tracing/fileWriter';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('ai trace queued file writer', () => {
  it('creates directories and preserves append order', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clira-ai-trace-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'nested', 'trace.jsonl');
    const writer = getQueuedFileWriter(filePath);

    await Promise.all([writer.write('one\n'), writer.write('two\n'), writer.write('three\n')]);

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toBe('one\ntwo\nthree\n');
  });
});
