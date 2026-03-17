import { readMcpContentReference } from '@/lib/services/mcp/runtime/contentReferences';
import {
  sanitizeContentExtractionResultForModel,
  sanitizeContentReferenceForModel,
} from './referenceModeling';
import {
  resolveStoredContentReference,
  STORED_CONTENT_SOURCE_KIND,
} from './referenceStore';
import { readThirdPartyContentReference } from './thirdPartyReferenceRuntime';
import type { ContentReference } from './types';

export async function readContentReference(params: {
  userId: string;
  reference: ContentReference;
  conversationId?: string;
  runId: string;
  deadlineMs: number;
}): Promise<Record<string, unknown>> {
  if (params.reference.sourceKind === STORED_CONTENT_SOURCE_KIND) {
    const resolved = await resolveStoredContentReference({
      userId: params.userId,
      reference: params.reference,
      conversationId: params.conversationId,
      runId: params.runId,
    });

    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error,
        message: resolved.message,
        ...(resolved.reference
          ? { contentRef: sanitizeContentReferenceForModel(resolved.reference) }
          : {}),
      };
    }

    return {
      ok: true,
      contentRef: sanitizeContentReferenceForModel(resolved.reference),
      resultCount: 1,
      results: [sanitizeContentExtractionResultForModel(resolved.extraction)],
      truncated: false,
      omittedResultCount: 0,
    };
  }

  if (params.reference.sourceKind === 'mcp_resource_link') {
    return readMcpContentReference(params);
  }

  if (params.reference.sourceKind === 'third_party') {
    return readThirdPartyContentReference(params);
  }

  return {
    ok: false,
    error: 'unsupported_content_reference',
    message: 'That content reference type is not supported yet.',
    contentRef: sanitizeContentReferenceForModel(params.reference),
  };
}
