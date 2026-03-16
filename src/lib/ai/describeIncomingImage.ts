/**
 * Compatibility facade over the shared content-ingestion pipeline.
 */

import {
  extractContentFromBuffer,
  renderContentExtractionForLegacyText,
} from '@/lib/services/content-ingestion';
import type { AiTraceContext } from '@/lib/ai/tracing';

export async function describeIncomingImage(
  imageBuffer: Buffer,
  mimeType: string,
  options?: {
    abortSignal?: AbortSignal;
    traceContext?: AiTraceContext;
    channelLabel?: string;
    userCaption?: string | null;
  },
): Promise<string> {
  const result = await extractContentFromBuffer({
    buffer: imageBuffer,
    mimeType,
    abortSignal: options?.abortSignal,
    traceContext: options?.traceContext,
    channelLabel: options?.channelLabel,
    userCaption: options?.userCaption ?? null,
    provenance: {
      sourceLabel: options?.channelLabel?.trim() || 'image_ingestion',
      sourceKind: 'inline_buffer',
    },
  });

  return renderContentExtractionForLegacyText(result);
}
