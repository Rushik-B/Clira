import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn();
const generateObjectMock = vi.fn();
const withAiTraceSpanMock = vi.fn();

vi.mock('ai', () => ({
  generateText: generateTextMock,
  generateObject: generateObjectMock,
  Output: { object: vi.fn((value) => value) },
  stepCountIs: vi.fn(() => vi.fn()),
}));

vi.mock('@prisma/client', async () => {
  const actual = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
  return {
    ...actual,
    AiTraceSpanKind: {
      LLM: 'LLM',
    },
  };
});

vi.mock('@/lib/ai/tracing', () => ({
  withAiTraceSpan: withAiTraceSpanMock,
}));

describe('callLlm tracing wrappers', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    generateObjectMock.mockReset();
    withAiTraceSpanMock.mockReset();
    withAiTraceSpanMock.mockImplementation(async (_context, _input, fn) => {
      const response = await fn(undefined);
      return response.result;
    });
  });

  it('wraps text calls in an llm trace span', async () => {
    generateTextMock.mockResolvedValue({
      text: 'hello',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      response: { modelId: 'gemini-test' },
    });

    const { callText } = await import('@/lib/ai/callLlm');
    const result = await callText({
      model: 'test-model',
      prompt: 'hi',
      traceContext: {
        enabled: true,
        captureMode: 'full',
        runId: 'run-1',
        pipeline: 'test',
        userId: 'user-1',
      },
    });

    expect(result.text).toBe('hello');
    expect(withAiTraceSpanMock).toHaveBeenCalledTimes(1);
    expect(withAiTraceSpanMock.mock.calls[0][1]).toMatchObject({
      kind: 'LLM',
      name: 'text',
    });
  });

  it('wraps object calls in an llm trace span', async () => {
    generateObjectMock.mockResolvedValue({
      object: { ok: true },
      usage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 },
      response: { modelId: 'gemini-test' },
    });

    const { callObject } = await import('@/lib/ai/callLlm');
    const result = await callObject({
      model: 'test-model',
      prompt: 'hi',
      schema: { type: 'object' },
      traceContext: {
        enabled: true,
        captureMode: 'full',
        runId: 'run-2',
        pipeline: 'test',
        userId: 'user-1',
      },
    });

    expect(result.object).toEqual({ ok: true });
    expect(withAiTraceSpanMock).toHaveBeenCalledTimes(1);
    expect(withAiTraceSpanMock.mock.calls[0][1]).toMatchObject({
      kind: 'LLM',
      name: 'object',
    });
  });
});
