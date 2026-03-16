import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AiTraceContext } from '@/lib/ai/tracing';

const llmMocks = vi.hoisted(() => ({
  callTextWithMessages: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  flash: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/ai/callLlm', () => ({
  callTextWithMessages: llmMocks.callTextWithMessages,
}));

vi.mock('@/lib/ai/models', () => ({
  models: {
    flash: modelMocks.flash,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: loggerMocks.info,
    warn: loggerMocks.warn,
  },
}));

import {
  extractContentFromBuffer,
  resetContentIngestionStateForTests,
} from '@/lib/services/content-ingestion';

function createTraceContext(overrides?: Partial<AiTraceContext>): AiTraceContext {
  return {
    enabled: true,
    captureMode: 'off',
    runId: overrides?.runId ?? 'run-1',
    pipeline: overrides?.pipeline ?? 'executive-agent',
    userId: overrides?.userId ?? 'user-1',
    channel: overrides?.channel ?? 'telegram',
    conversationId: overrides?.conversationId ?? 'conversation-1',
    emailId: null,
    mailboxId: null,
    externalMessageId: null,
    label: null,
    artifactPath: null,
    spanId: undefined,
    parentSpanId: undefined,
    rootStartedAtMs: undefined,
  };
}

function createPdfBuffer(seed: string): Buffer {
  return Buffer.from(`%PDF-1.4\n${seed}\n1 0 obj\n<<>>\nendobj\n`);
}

function createDocxLikeBuffer(): Buffer {
  const filenameBuffer = Buffer.from('word/document.xml', 'utf8');
  const contentBuffer = Buffer.from('<w:document />', 'utf8');
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(contentBuffer.length, 18);
  header.writeUInt32LE(contentBuffer.length, 22);
  header.writeUInt16LE(filenameBuffer.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, filenameBuffer, contentBuffer]);
}

describe('content-ingestion service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContentIngestionStateForTests();
    modelMocks.flash.mockReturnValue('gemini-content-handler');
    llmMocks.callTextWithMessages.mockResolvedValue({
      text: 'Extracted content',
      usage: {
        inputTokens: 9,
        outputTokens: 4,
        totalTokens: 13,
      },
    });
  });

  test('uses sniffed mime type when the declared mime is wrong', async () => {
    const result = await extractContentFromBuffer({
      buffer: createPdfBuffer('mismatch'),
      mimeType: 'application/octet-stream',
      filename: 'invoice.bin',
      traceContext: createTraceContext(),
      channelLabel: 'Telegram',
    });

    expect(result.status).toBe('ok');
    expect(result.attribution.mimeType).toBe('application/pdf');
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      '[contentIngestion] mime mismatch; using sniffed mime type',
      expect.objectContaining({
        declaredMimeType: 'application/octet-stream',
        sniffedMimeType: 'application/pdf',
      }),
    );
  });

  test('returns a degraded result before any LLM call when the pdf exceeds the size limit', async () => {
    const result = await extractContentFromBuffer({
      buffer: Buffer.concat([
        Buffer.from('%PDF-1.4\n'),
        Buffer.alloc(10 * 1024 * 1024 + 1, 0),
      ]),
      mimeType: 'application/pdf',
      traceContext: createTraceContext(),
    });

    expect(result.status).toBe('degraded');
    expect(result.degradationNotes[0]?.code).toBe('size_limit_exceeded');
    expect(llmMocks.callTextWithMessages).not.toHaveBeenCalled();
  });

  test('reuses a cached extraction across runs in the same conversation', async () => {
    const first = await extractContentFromBuffer({
      buffer: createPdfBuffer('cache'),
      mimeType: 'application/pdf',
      traceContext: createTraceContext({ runId: 'run-1', conversationId: 'conversation-1' }),
    });

    const second = await extractContentFromBuffer({
      buffer: createPdfBuffer('cache'),
      mimeType: 'application/octet-stream',
      traceContext: createTraceContext({ runId: 'run-2', conversationId: 'conversation-1' }),
    });

    expect(first.cacheStatus).toBe('miss');
    expect(second.cacheStatus).toBe('hit');
    expect(second.extractedText).toBe('Extracted content');
    expect(llmMocks.callTextWithMessages).toHaveBeenCalledTimes(1);
  });

  test('enforces the per-run extraction budget for llm-backed handlers', async () => {
    for (let index = 0; index < 5; index += 1) {
      const result = await extractContentFromBuffer({
        buffer: createPdfBuffer(`budget-${index}`),
        mimeType: 'application/pdf',
        traceContext: createTraceContext({ runId: 'budget-run', conversationId: 'conversation-2' }),
      });

      expect(result.status).toBe('ok');
    }

    const overBudget = await extractContentFromBuffer({
      buffer: createPdfBuffer('budget-6'),
      mimeType: 'application/pdf',
      traceContext: createTraceContext({ runId: 'budget-run', conversationId: 'conversation-2' }),
    });

    expect(overBudget.status).toBe('degraded');
    expect(overBudget.degradationNotes[0]?.code).toBe('extraction_budget_exceeded');
    expect(overBudget.cacheStatus).toBe('miss');
    expect(llmMocks.callTextWithMessages).toHaveBeenCalledTimes(5);
  });

  test('routes html through the deterministic html handler', async () => {
    const result = await extractContentFromBuffer({
      buffer: Buffer.from('<h1>Invoice</h1><p>Total due: $400</p>'),
      mimeType: 'text/html',
      traceContext: createTraceContext(),
    });

    expect(result.status).toBe('ok');
    expect(result.mediaFamily).toBe('html');
    expect(result.extractedText).toContain('Invoice');
    expect(result.extractedText).toContain('Total due: $400');
    expect(llmMocks.callTextWithMessages).not.toHaveBeenCalled();
  });

  test('returns an explicit degraded result for unsupported office documents', async () => {
    const result = await extractContentFromBuffer({
      buffer: createDocxLikeBuffer(),
      mimeType: 'application/octet-stream',
      filename: 'report.docx',
      traceContext: createTraceContext(),
    });

    expect(result.status).toBe('degraded');
    expect(result.mediaFamily).toBe('office_doc');
    expect(result.degradationNotes[0]?.code).toBe('unsupported_media_family');
    expect(llmMocks.callTextWithMessages).not.toHaveBeenCalled();
  });
});
