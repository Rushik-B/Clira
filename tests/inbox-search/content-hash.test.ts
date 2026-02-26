import { describe, expect, test } from 'vitest';
import { computeInboxContentHash } from '@/lib/services/inbox-search/content-hash';

describe('computeInboxContentHash', () => {
  test('returns deterministic sha256 hash for same body', () => {
    const body = 'Hello world';
    const hashA = computeInboxContentHash(body);
    const hashB = computeInboxContentHash(body);

    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });

  test('produces different hashes for different bodies', () => {
    const hashA = computeInboxContentHash('body one');
    const hashB = computeInboxContentHash('body two');

    expect(hashA).not.toBe(hashB);
  });
});
