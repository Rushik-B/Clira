import { describe, expect, test } from 'vitest';
import { buildInboxChunks } from '@/lib/services/inbox-search/chunker';

function buildTokenString(count: number): string {
  return Array.from({ length: count }, (_, idx) => `t${idx + 1}`).join(' ');
}

describe('buildInboxChunks', () => {
  test('creates one chunk when email is shorter than chunk size', () => {
    const body = buildTokenString(20);
    const chunks = buildInboxChunks({
      bodyText: body,
      chunkSizeTokens: 384,
      overlapTokens: 64,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks[0]?.tokenCount).toBe(20);
  });

  test('creates overlapping chunks for longer emails', () => {
    const body = buildTokenString(900);
    const chunks = buildInboxChunks({
      bodyText: body,
      chunkSizeTokens: 384,
      overlapTokens: 64,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.tokenCount).toBe(384);
    expect(chunks[1]?.tokenCount).toBe(384);

    const firstTokens = chunks[0]?.chunkText.split(' ') ?? [];
    const secondTokens = chunks[1]?.chunkText.split(' ') ?? [];
    const firstOverlap = firstTokens.slice(-64);
    const secondStart = secondTokens.slice(0, 64);

    expect(secondStart).toEqual(firstOverlap);
  });
});
