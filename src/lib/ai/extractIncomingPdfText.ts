/**
 * Compatibility facade over the shared content-ingestion pipeline.
 * Existing callers still receive the extracted text string, while phase 1
 * centralizes MIME checks, limits, budgeting, and cache behavior underneath.
 */

import {
  extractContentFromBuffer,
  renderContentExtractionForLegacyText,
} from '@/lib/services/content-ingestion';
import type { AiTraceContext } from '@/lib/ai/tracing';

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
  const result = await extractContentFromBuffer({
    buffer: pdfBuffer,
    mimeType,
    abortSignal: options?.abortSignal,
    traceContext: options?.traceContext,
    channelLabel: options?.channelLabel,
    filename: options?.filename ?? null,
    userCaption: options?.userCaption ?? null,
    provenance: {
      sourceLabel: options?.channelLabel?.trim() || 'pdf_ingestion',
      sourceKind: 'inline_buffer',
    },
  });

  return renderContentExtractionForLegacyText(result);
}
