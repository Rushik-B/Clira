import {
  sanitizeMcpInlineText,
  sanitizeMcpJson,
} from '@/lib/services/mcp/security/sanitization';
import type { McpExecutionResult } from '@/lib/services/mcp/types';
import { summarizeMcpContentRefsForModel } from './contentReferences';

function summarizeContentBlocks(content: unknown[]): string[] {
  const snippets: string[] = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    const record = block as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      const snippet = sanitizeMcpInlineText(record.text, 400);
      if (snippet) {
        snippets.push(snippet);
      }
    }

    if (snippets.length >= 6) {
      break;
    }
  }

  return snippets;
}

export function summarizeMcpExecutionResultForModel(
  result: McpExecutionResult,
): Record<string, unknown> {
  const snippets = summarizeContentBlocks(result.content);
  const contentRefSummary = summarizeMcpContentRefsForModel(result.contentRefs);
  const structuredSummary =
    result.structuredContent && typeof result.structuredContent === 'object'
      ? (sanitizeMcpJson(result.structuredContent, 2) as Record<string, unknown>)
      : undefined;

  return {
    ok: result.ok,
    toolName: result.toolName,
    modelToolName: result.modelToolName,
    displayName: result.displayName,
    degraded: result.degraded,
    errorClass: result.errorClass ?? null,
    freshness: result.freshness,
    userFacingDegradedReason: result.userFacingDegradedReason ?? null,
    snippets,
    structuredSummary,
    ...(contentRefSummary.contentRefCount > 0
      ? {
          contentRefs: contentRefSummary.contentRefs,
          contentRefCount: contentRefSummary.contentRefCount,
          omittedContentRefCount: contentRefSummary.omittedContentRefCount,
          contentRefSummaryLines: contentRefSummary.contentRefSummaryLines,
        }
      : {}),
  };
}
