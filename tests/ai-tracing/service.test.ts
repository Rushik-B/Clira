import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getQueuedFileWriter } from '@/lib/ai/tracing/fileWriter';
import { appendAiTraceNote, createAiTraceRoot, finalizeAiTraceRun } from '@/lib/ai/tracing';

const tempDirs: string[] = [];
const originalTraceDir = process.env.CLIRA_AI_TRACE_DIR;
const originalTraceEnabled = process.env.CLIRA_AI_TRACE_ENABLED;
const originalTraceCapture = process.env.CLIRA_AI_TRACE_CAPTURE;

afterEach(async () => {
  if (originalTraceDir === undefined) {
    delete process.env.CLIRA_AI_TRACE_DIR;
  } else {
    process.env.CLIRA_AI_TRACE_DIR = originalTraceDir;
  }

  if (originalTraceEnabled === undefined) {
    delete process.env.CLIRA_AI_TRACE_ENABLED;
  } else {
    process.env.CLIRA_AI_TRACE_ENABLED = originalTraceEnabled;
  }

  if (originalTraceCapture === undefined) {
    delete process.env.CLIRA_AI_TRACE_CAPTURE;
  } else {
    process.env.CLIRA_AI_TRACE_CAPTURE = originalTraceCapture;
  }

  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('ai tracing service', () => {
  it('clears run sequence counters after finalize', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clira-ai-trace-service-'));
    tempDirs.push(dir);
    process.env.CLIRA_AI_TRACE_DIR = dir;
    process.env.CLIRA_AI_TRACE_ENABLED = 'true';
    process.env.CLIRA_AI_TRACE_CAPTURE = 'summary';

    const runId = 'reused-run-id';

    const firstContext = await createAiTraceRoot({
      runId,
      pipeline: 'test',
      userId: 'user-1',
    });
    const firstWriter = getQueuedFileWriter(firstContext.artifactPath!);
    await appendAiTraceNote(firstContext, 'first-note', { ok: true });
    await finalizeAiTraceRun(firstContext, { status: 'OK' });
    const reopenedWriter = getQueuedFileWriter(firstContext.artifactPath!);
    expect(reopenedWriter).not.toBe(firstWriter);

    const secondContext = await createAiTraceRoot({
      runId,
      pipeline: 'test',
      userId: 'user-1',
    });
    await appendAiTraceNote(secondContext, 'second-note', { ok: true });
    await finalizeAiTraceRun(secondContext, { status: 'OK' });

    const artifactPath = secondContext.artifactPath;
    expect(artifactPath).toBeTruthy();

    const lines = (await fs.readFile(artifactPath!, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const noteEvents = lines.filter((line) => line.event === 'note');
    expect(noteEvents).toHaveLength(2);
    expect(noteEvents[0]?.seq).toBe(1);
    expect(noteEvents[1]?.seq).toBe(1);
  });
});
