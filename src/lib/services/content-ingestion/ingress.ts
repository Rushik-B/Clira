import { renderContentExtractionForLegacyText } from './service';
import type { ContentExtractionResult, ContentProvenance } from './types';

type BuildInlineBufferProvenanceParams = {
  sourceLabel: string;
  sourceKind: string;
  channel?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  messageId?: string | null;
  attachmentId?: string | null;
  originUri?: string | null;
};

type MessagingMediaKind = 'image' | 'pdf';

/**
 * Standardizes provenance for inbound byte buffers before they enter the
 * shared content-ingestion pipeline.
 */
export function buildInlineBufferProvenance(
  params: BuildInlineBufferProvenanceParams,
): ContentProvenance {
  return {
    sourceLabel: params.sourceLabel,
    sourceKind: params.sourceKind,
    channel: params.channel ?? null,
    conversationId: params.conversationId ?? null,
    runId: params.runId ?? null,
    messageId: params.messageId ?? null,
    attachmentId: params.attachmentId ?? null,
    originUri: params.originUri ?? null,
  };
}

/**
 * Preserves the existing chat-facing scaffolding while sourcing the body from
 * the normalized extraction result contract.
 */
export function formatMessagingMediaForAgent(params: {
  channelLabel: string;
  mediaKind: MessagingMediaKind;
  extraction: ContentExtractionResult;
  filename?: string | null;
  caption?: string | null;
}): string {
  const mediaLabel = params.mediaKind === 'image' ? 'image' : 'PDF';
  const detailLabel =
    params.mediaKind === 'image' ? 'Detailed image description:' : 'Raw PDF text:';
  const renderedExtraction = renderContentExtractionForLegacyText(params.extraction);

  return [
    `User sent ${params.mediaKind === 'image' ? 'an' : 'a'} ${mediaLabel} on ${params.channelLabel}.`,
    params.filename ? `Filename: ${params.filename}` : null,
    params.caption ? `User caption: ${params.caption}` : null,
    detailLabel,
    renderedExtraction,
  ]
    .filter(Boolean)
    .join('\n\n');
}
