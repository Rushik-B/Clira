/**
 * Extracts faithful plain-text content from an incoming PDF for assistant workflows.
 * The PDF bytes are used only for this single request and are not persisted.
 */

import { callTextWithMessages } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import type { AiTraceContext } from '@/lib/ai/tracing';

function buildPdfExtractionPrompt(options?: {
  channelLabel?: string;
  filename?: string | null;
  userCaption?: string | null;
}): string {
  const channelLabel = options?.channelLabel?.trim() || 'a messaging chat';
  const filename = options?.filename?.trim();

  return [
    `The user sent a PDF in ${channelLabel}.`,
    filename ? `Filename: ${filename}` : null,
    'Transcribe the PDF into faithful plain text for downstream processing.',
    '',
    'Requirements:',
    '1) Preserve the original wording and document order as closely as possible.',
    '2) Include all readable text from the PDF, including headings, paragraphs, labels, tables, line items, totals, footers, and repeated boilerplate when present.',
    '3) Use plain text only. You may use line breaks, indentation, and simple bullet markers only when needed to mirror the document structure.',
    '4) Do not summarize, interpret, rewrite, or omit details just because they seem unimportant.',
    '5) Do not add sections such as summary, key details, extracted text, uncertainties, or commentary.',
    '6) If any portion is unreadable or uncertain, insert a short inline marker such as [unreadable] or [unclear] at that spot and continue.',
    '',
    'Return only the transcription.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function extractIncomingPdfText(
  pdfBuffer: Buffer,
  mimeType: string,
  options?: {
    abortSignal?: AbortSignal;
    traceContext?: AiTraceContext;
    channelLabel?: string;
    filename?: string | null;
    userCaption?: string | null;
  },
): Promise<string> {
  const model = models.flash();
  const start = Date.now();

  try {
    const { text } = await callTextWithMessages({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: buildPdfExtractionPrompt(options) },
            {
              type: 'file' as const,
              data: pdfBuffer,
              mediaType: mimeType,
            },
          ],
        },
      ],
      abortSignal: options?.abortSignal,
      traceContext: options?.traceContext,
      op: 'document.extract-pdf',
      concurrency: { key: 'document.extract-pdf', maxConcurrency: 2 },
      retry: { maxAttempts: 2, baseDelayMs: 400 },
    });

    logger.info(
      `[extractIncomingPdfText] done in ${Date.now() - start}ms length=${pdfBuffer.length} mime=${mimeType}`,
    );

    return text?.trim() ?? '';
  } catch (err) {
    logger.warn(
      `[extractIncomingPdfText] failed in ${Date.now() - start}ms: ${err instanceof Error ? err.message : err}`,
    );
    throw err;
  }
}
