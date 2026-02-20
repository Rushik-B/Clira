/**
 * Transcribes a voice memo (audio buffer) to text using Gemini.
 * Used for WhatsApp voice messages: download → transcribe → pass transcript to Executive Agent.
 * No audio is stored; the buffer is used only for this single request.
 */

import { generateText } from 'ai';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';

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
  options?: { abortSignal?: AbortSignal },
): Promise<string> {
  const model = models.flash();
  const start = Date.now();
  try {
    const { text } = await generateText({
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
