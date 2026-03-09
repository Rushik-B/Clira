/**
 * Transcribes a voice memo (audio buffer) to text using Gemini.
 * Used for WhatsApp voice messages: download → transcribe → pass transcript to Executive Agent.
 * No audio is stored; the buffer is used only for this single request.
 */

import { callTextWithMessages } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import type { AiTraceContext } from '@/lib/ai/tracing';

const TRANSCRIPT_PROMPT =
  'The user sent this voice memo. Transcribe exactly what they said. Reply with only the transcription, no preamble or labels.';

/**
 * Transcribes an in-memory audio buffer to text using Gemini 3.0 Flash.
 *
 * @param audioBuffer - Raw audio bytes (e.g. OGG from WhatsApp)
 * @param mimeType - MIME type (e.g. audio/ogg, audio/mp3)
 * @param options - Optional abort signal to cancel when run is superseded
 * @returns The transcript text
 */
export async function transcribeVoiceMemo(
  audioBuffer: Buffer,
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
            { type: 'text' as const, text: TRANSCRIPT_PROMPT },
            {
              type: 'file' as const,
              data: audioBuffer,
              mediaType: mimeType,
            },
          ],
        },
      ],
      abortSignal: options?.abortSignal,
      traceContext: options?.traceContext,
      op: 'messaging.transcribe-voice',
      concurrency: { key: 'messaging.transcribe-voice', maxConcurrency: 2 },
      retry: { maxAttempts: 2, baseDelayMs: 400 },
    });
    logger.info(
      `[transcribeVoiceMemo] done in ${Date.now() - start}ms length=${audioBuffer.length} mime=${mimeType}`,
    );
    return text?.trim() ?? '';
  } catch (err) {
    logger.warn(
      `[transcribeVoiceMemo] failed in ${Date.now() - start}ms: ${err instanceof Error ? err.message : err}`,
    );
    throw err;
  }
}
