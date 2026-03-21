import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProgressEmitter } from '@/lib/ai/progressEmitter';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';

function buildProgressContext(params?: {
  canEmitProgress?: () => boolean;
  includeSendMessage?: boolean;
  includeWebProgress?: boolean;
}) {
  const sentTexts: string[] = [];
  const persistedMessages: Array<{
    content: string;
    metadata: Record<string, unknown>;
    externalId?: string;
  }> = [];
  const emittedEvents: Array<Record<string, unknown>> = [];

  const context: ProgressUpdateContext = {
    channel: 'whatsapp',
    requestId: 'req-progress',
    conversationId: 'conv-progress',
    canEmitProgress: params?.canEmitProgress,
    sendMessage: params?.includeSendMessage === false
      ? undefined
      : async (text) => {
          sentTexts.push(text);
          return { externalId: `msg-${sentTexts.length}` };
        },
    emitWebProgress: params?.includeWebProgress
      ? async (event) => {
          emittedEvents.push(event as unknown as Record<string, unknown>);
        }
      : undefined,
    persistMessage: async ({ content, metadata, externalId }) => {
      persistedMessages.push({
        content,
        metadata: metadata as unknown as Record<string, unknown>,
        externalId,
      });
    },
  };

  return {
    context,
    sentTexts,
    persistedMessages,
    emittedEvents,
  };
}

function createEmitter(
  context: ProgressUpdateContext,
  config?: ConstructorParameters<typeof ProgressEmitter>[1],
) {
  return new ProgressEmitter(context, {
    maxEmissions: 3,
    minIntervalMs: 0,
    longTaskBonusAfterMs: 60_000,
    maxTextLength: 200,
    harnessFirstDelayMs: 0,
    harnessMinToolCalls: 0,
    ...config,
  });
}

describe('ProgressEmitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('delivers and persists a basic progress update', async () => {
    const { context, sentTexts, persistedMessages, emittedEvents } = buildProgressContext({
      includeWebProgress: true,
    });
    const emitter = createEmitter(context);

    const result = await emitter.emit({
      text: 'Still on it',
      kind: 'ack',
      source: 'model',
    });

    expect(result).toMatchObject({
      sent: true,
      persisted: true,
      sequence: 1,
      requestId: 'req-progress',
      channel: 'whatsapp',
    });
    expect(sentTexts).toEqual(['Still on it']);
    expect(persistedMessages).toHaveLength(1);
    expect(persistedMessages[0]?.metadata).toMatchObject({
      type: 'progress',
      kind: 'ack',
      sequence: 1,
      requestId: 'req-progress',
      channel: 'whatsapp',
    });
    expect(emittedEvents).toEqual([
      {
        id: 'req-progress-1',
        text: 'Still on it',
        kind: 'ack',
        sequence: 1,
        requestId: 'req-progress',
        channel: 'whatsapp',
      },
    ]);
  });

  test('enforces shared quota', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context, { maxEmissions: 3 });

    await emitter.emit({ text: 'First', kind: 'ack', source: 'model' });
    vi.advanceTimersByTime(1);
    await emitter.emit({ text: 'Second', kind: 'ack', source: 'model' });
    vi.advanceTimersByTime(1);
    await emitter.emit({ text: 'Third', kind: 'ack', source: 'model' });
    vi.advanceTimersByTime(1);

    const fourth = await emitter.emit({
      text: 'Fourth',
      kind: 'ack',
      source: 'model',
    });

    expect(fourth.sent).toBe(false);
    expect(fourth.droppedReason).toBe('quota');
  });

  test('rate limits rapid emissions', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context, { minIntervalMs: 5_000 });

    await emitter.emit({ text: 'First', kind: 'ack', source: 'model' });
    const second = await emitter.emit({
      text: 'Second',
      kind: 'ack',
      source: 'model',
    });

    expect(second.sent).toBe(false);
    expect(second.droppedReason).toBe('rate_limit');
  });

  test('deduplicates repeated text across emissions', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context);

    await emitter.emit({ text: 'Reading that now', kind: 'ack', source: 'model' });
    vi.advanceTimersByTime(1);
    const duplicate = await emitter.emit({
      text: 'reading that now',
      kind: 'ack',
      source: 'model',
    });

    expect(duplicate.sent).toBe(false);
    expect(duplicate.droppedReason).toBe('duplicate');
  });

  test('suppresses emissions while burst stability is false', async () => {
    const { context, sentTexts, persistedMessages } = buildProgressContext({
      canEmitProgress: () => false,
    });
    const emitter = createEmitter(context);

    const result = await emitter.emit({
      text: 'Checking now',
      kind: 'ack',
      source: 'model',
    });

    expect(result.sent).toBe(false);
    expect(result.droppedReason).toBe('unstable_burst');
    expect(sentTexts).toEqual([]);
    expect(persistedMessages).toEqual([]);
  });

  test('holds harness emissions until the first delay window passes', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context, {
      harnessFirstDelayMs: 4_500,
      harnessMinToolCalls: 0,
    });

    const result = await emitter.emit({
      text: 'Searching your inbox...',
      kind: 'long_task',
      source: 'harness',
    });

    expect(result.sent).toBe(false);
    expect(result.droppedReason).toBe('harness_delay');
  });

  test('lets the model emit before harness-only gates open', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context, {
      harnessFirstDelayMs: 4_500,
      harnessMinToolCalls: 1,
    });

    const result = await emitter.emit({
      text: 'Reading the latest thread',
      kind: 'ack',
      source: 'model',
    });

    expect(result.sent).toBe(true);
    expect(result.droppedReason).toBeUndefined();
  });

  test('shares quota across harness and model emissions', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context, {
      maxEmissions: 1,
      harnessFirstDelayMs: 0,
      harnessMinToolCalls: 0,
    });

    const harness = await emitter.emit({
      text: 'Checking your calendar...',
      kind: 'long_task',
      source: 'harness',
    });
    vi.advanceTimersByTime(1);
    const model = await emitter.emit({
      text: 'Found the event, pulling the latest details',
      kind: 'ack',
      source: 'model',
    });

    expect(harness.sent).toBe(true);
    expect(model.sent).toBe(false);
    expect(model.droppedReason).toBe('quota');
  });

  test('tracks completed tool calls and ignores deferred or progress-tool results', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context, {
      harnessFirstDelayMs: 0,
      harnessMinToolCalls: 1,
    });

    const before = await emitter.emit({
      text: 'Checking your inbox...',
      kind: 'long_task',
      source: 'harness',
    });
    emitter.noteToolCallCompleted('send_progress_update', { sent: true });
    emitter.noteToolCallCompleted('search_inbox_context', { status: 'deferred' });
    emitter.noteToolCallCompleted('search_inbox_context', {
      ok: false,
      error: 'tool_budget_exceeded',
    });
    emitter.noteToolCallCompleted('search_inbox_context', { ok: true });
    const after = await emitter.emit({
      text: 'Checking your inbox...',
      kind: 'long_task',
      source: 'harness',
    });

    expect(before.sent).toBe(false);
    expect(before.droppedReason).toBe('insufficient_tool_calls');
    expect(after.sent).toBe(true);
    expect(emitter.state()).toMatchObject({
      sentCount: 1,
      toolCallsCompleted: 1,
    });
  });

  test('updates lastSentAt after a successful emission', async () => {
    const { context } = buildProgressContext();
    const emitter = createEmitter(context);

    vi.advanceTimersByTime(1_234);
    await emitter.emit({
      text: 'Still working through it',
      kind: 'ack',
      source: 'model',
    });

    expect(emitter.getLastSentAt()).toBe(Date.now());
  });

  test('default cadence only allows a third update on genuinely long runs', async () => {
    const { context } = buildProgressContext();
    const emitter = new ProgressEmitter(context);

    emitter.noteToolCallCompleted('search_inbox_context', { ok: true });

    vi.advanceTimersByTime(8_000);
    const first = await emitter.emit({
      text: 'checking your inbox now',
      kind: 'long_task',
      source: 'harness',
    });

    vi.advanceTimersByTime(12_000);
    const second = await emitter.emit({
      text: 'still checking your inbox',
      kind: 'long_task',
      source: 'harness',
    });

    vi.advanceTimersByTime(12_000);
    const thirdTooSoon = await emitter.emit({
      text: 'still on this, going through your inbox',
      kind: 'long_task',
      source: 'harness',
    });

    vi.advanceTimersByTime(13_000);
    const thirdLongRun = await emitter.emit({
      text: 'taking a bit, still going through your inbox',
      kind: 'long_task',
      source: 'harness',
    });

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(true);
    expect(thirdTooSoon.sent).toBe(false);
    expect(thirdTooSoon.droppedReason).toBe('quota');
    expect(thirdLongRun.sent).toBe(true);
  });
});
