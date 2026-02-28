import type { InboxSearchChunkRecord } from '@/lib/services/inbox-search/types';

export const DEFAULT_CHUNK_SIZE_TOKENS = 384;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 64;

// Whitespace-split approximation of token counting. English averages ~1.3 BPE
// tokens per word, so 384 "words" ≈ 500 actual Gemini tokens — well within the
// 2048-token embedding API limit. Non-English text, URLs, and encoded strings
// may exceed this ratio, but the Gemini API truncates gracefully.
function tokenize(text: string): string[] {
  const tokens = text.match(/\S+/g);
  return tokens ?? [];
}

export function buildInboxChunks(params: {
  bodyText: string;
  chunkSizeTokens?: number;
  overlapTokens?: number;
}): InboxSearchChunkRecord[] {
  const chunkSizeTokens = params.chunkSizeTokens ?? DEFAULT_CHUNK_SIZE_TOKENS;
  const overlapTokens = params.overlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;

  if (chunkSizeTokens <= 0) {
    throw new Error(`Invalid chunkSizeTokens: ${chunkSizeTokens}`);
  }
  if (overlapTokens < 0 || overlapTokens >= chunkSizeTokens) {
    throw new Error(`Invalid overlapTokens: ${overlapTokens} for chunk size ${chunkSizeTokens}`);
  }

  const trimmedBody = params.bodyText.trim();
  if (!trimmedBody) {
    return [];
  }

  const tokens = tokenize(trimmedBody);
  if (tokens.length <= chunkSizeTokens) {
    return [{ chunkIndex: 0, chunkText: trimmedBody, tokenCount: tokens.length }];
  }

  const stepSize = chunkSizeTokens - overlapTokens;
  const chunks: InboxSearchChunkRecord[] = [];
  let chunkIndex = 0;

  for (let start = 0; start < tokens.length; start += stepSize) {
    const end = Math.min(start + chunkSizeTokens, tokens.length);
    const chunkTokens = tokens.slice(start, end);

    chunks.push({
      chunkIndex,
      chunkText: chunkTokens.join(' '),
      tokenCount: chunkTokens.length,
    });
    chunkIndex += 1;

    if (end >= tokens.length) break;
  }

  return chunks;
}
