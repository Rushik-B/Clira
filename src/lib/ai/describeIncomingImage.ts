/**
 * Describes an incoming WhatsApp image in depth using Gemini.
 * Used for WhatsApp image messages: download → describe → pass description to Executive Agent.
 * No image is stored; the buffer is used only for this single request.
 */

import { callTextWithMessages } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import type { AiTraceContext } from '@/lib/ai/tracing';

const IMAGE_DESCRIPTION_PROMPT = `The user sent an image in WhatsApp.

Provide a thorough, reliable description for an executive assistant workflow.

Requirements:
1) Describe all visible details that could matter for productivity tasks (documents, whiteboards, screens, receipts, handwritten notes, schedules, charts, business cards, product labels, signs, etc).
2) Transcribe any legible text exactly when possible.
3) If text is partially legible, include best-effort reconstruction and clearly mark uncertain fragments.
4) Capture structure (sections, headings, bullet points, totals, dates, names, contact details).
5) Mention relevant visual context (who/what/where, objects, actions, layout) without over-guessing.
6) If image quality limits certainty, explicitly note uncertainty.
7) Output plain text only.

Format your output as:
- SUMMARY: <2-4 concise sentences>
- DETAILED OBSERVATIONS:
  - ...
- EXTRACTED TEXT:
  - ... (or "None clearly legible")
- UNCERTAINTIES:
  - ... (or "None")`;

export async function describeIncomingImage(
  imageBuffer: Buffer,
  mimeType: string,
  options?: { abortSignal?: AbortSignal; traceContext?: AiTraceContext },
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
            { type: 'text' as const, text: IMAGE_DESCRIPTION_PROMPT },
            {
              type: 'file' as const,
              data: imageBuffer,
              mediaType: mimeType,
            },
          ],
        },
      ],
      abortSignal: options?.abortSignal,
      traceContext: options?.traceContext,
      op: 'messaging.describe-image',
      concurrency: { key: 'messaging.describe-image', maxConcurrency: 2 },
      retry: { maxAttempts: 2, baseDelayMs: 400 },
    });

    logger.info(
      `[describeIncomingImage] done in ${Date.now() - start}ms length=${imageBuffer.length} mime=${mimeType}`,
    );

    return text?.trim() ?? '';
  } catch (err) {
    logger.warn(
      `[describeIncomingImage] failed in ${Date.now() - start}ms: ${err instanceof Error ? err.message : err}`,
    );
    throw err;
  }
}
