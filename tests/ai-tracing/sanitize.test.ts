import { describe, expect, it } from 'vitest';
import { previewText, sanitizeForTrace } from '@/lib/ai/tracing/sanitize';

describe('ai trace sanitize', () => {
  it('redacts obvious secret-like keys', () => {
    expect(
      sanitizeForTrace({
        apiKey: 'secret-value',
        nested: { authorization: 'Bearer abc' },
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
  });

  it('summarizes binary payloads and errors', () => {
    const payload = sanitizeForTrace({
      audio: Buffer.from('hello'),
      failure: new Error('boom'),
    });

    expect(payload).toMatchObject({
      audio: { type: 'Buffer', byteLength: 5 },
      failure: { name: 'Error', message: 'boom' },
    });
  });

  it('builds short previews', () => {
    expect(previewText('  hello world  ', 20)).toBe('hello world');
    expect(previewText('x'.repeat(30), 10)).toBe('xxxxxxxxxx...');
  });
});
