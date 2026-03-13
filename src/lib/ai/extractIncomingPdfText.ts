/**
 * Extracts reliable plain-text context from an incoming PDF for assistant workflows.
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
  const caption = options?.userCaption?.trim();

  return [
    `The user sent a PDF in ${channelLabel}.`,
    filename ? `Filename: ${filename}` : null,
    caption
      ? [
          'The user also included this caption with the PDF.',
          'Treat the caption as part of the request context, but do not invent facts that are not supported by the PDF.',
          '',
          `Caption: ${caption}`,
        ].join('\n')
      : null,
    'Extract the PDF into a reliable plain-text summary for an executive assistant workflow.',
    '',
    'Requirements:',
    '1) Preserve factual accuracy. If a detail is missing or ambiguous, say so explicitly.',
    '2) Capture the document type and its main purpose.',
    '3) Extract important structured details such as names, dates, times, totals, line items, addresses, contact details, action items, and deadlines when present.',
    '4) Transcribe important wording directly when it matters, especially for headings, requests, instructions, or numeric values.',
    '5) If the PDF appears to be scanned or partially unreadable, clearly note uncertainty.',
    '6) Output plain text only.',
    '',
    'Format your output as:',
    '- SUMMARY: <2-4 concise sentences>',
    '- KEY DETAILS:',
    '  - ...',
    '- EXTRACTED TEXT:',
    '  - ... (or "None confidently extracted")',
    '- UNCERTAINTIES:',
    '  - ... (or "None")',
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
