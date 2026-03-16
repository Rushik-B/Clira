/**
 * Compatibility facade over the shared content-ingestion pipeline.
 */

import {
  extractContentFromBuffer,
  renderContentExtractionForLegacyText,
} from '@/lib/services/content-ingestion';
import type { AiTraceContext } from '@/lib/ai/tracing';

export async function transcribeVoiceMemo(
  audioBuffer: Buffer,
  mimeType: string,
  options?: { abortSignal?: AbortSignal; traceContext?: AiTraceContext },
): Promise<string> {
  const result = await extractContentFromBuffer({
    buffer: audioBuffer,
    mimeType,
    abortSignal: options?.abortSignal,
    traceContext: options?.traceContext,
    provenance: {
      sourceLabel: 'voice_memo',
      sourceKind: 'inline_buffer',
    },
  });

  return renderContentExtractionForLegacyText(result);
}
