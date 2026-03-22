import { beforeEach, describe, expect, test, vi } from 'vitest';

const llmMocks = vi.hoisted(() => ({
  callTextWithMessages: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  flash: vi.fn(),
}));

vi.mock('@/lib/ai/callLlm', () => ({
  callTextWithMessages: llmMocks.callTextWithMessages,
}));

vi.mock('@/lib/ai/models', () => ({
  getGoogleThinkingProviderOptions: () => undefined,
  models: {
    flash: modelMocks.flash,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { extractContentFromBuffer } = await import('@/lib/services/content-ingestion');

describe('content-ingestion pdf extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.flash.mockReturnValue('gemini-pdf-extractor');
  });

  test('requests faithful raw transcription instead of a summary', async () => {
    llmMocks.callTextWithMessages.mockResolvedValue({
      text: 'Invoice #123\nTotal Due: $400\nTerms: Net 30\n',
    });

    const result = await extractContentFromBuffer({
      buffer: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      channelLabel: 'Telegram',
      filename: 'invoice.pdf',
      userCaption: 'Pull out the amount due',
    });

    expect(result.extractedText).toBe('Invoice #123\nTotal Due: $400\nTerms: Net 30');
    expect(llmMocks.callTextWithMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-pdf-extractor',
        op: 'document.extract-pdf',
        messages: [
          expect.objectContaining({
            role: 'user',
            content: [
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining(
                  'Transcribe the PDF into faithful plain text for downstream processing.',
                ),
              }),
              expect.objectContaining({
                type: 'file',
                mediaType: 'application/pdf',
              }),
            ],
          }),
        ],
      }),
    );

    const prompt =
      llmMocks.callTextWithMessages.mock.calls[0]?.[0]?.messages?.[0]?.content?.[0]?.text ?? '';

    expect(prompt).toContain('Do not summarize, interpret, rewrite, or omit details');
    expect(prompt).toContain('Return only the transcription.');
    expect(prompt).not.toContain('Format your output as:');
    expect(prompt).not.toContain('SUMMARY:');
    expect(prompt).not.toContain('KEY DETAILS:');
    expect(prompt).not.toContain('EXTRACTED TEXT:');
    expect(prompt).not.toContain('UNCERTAINTIES:');
  });
});
