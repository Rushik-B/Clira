import { describe, expect, test } from 'vitest';
import {
  decodeGmailPubSubPayload,
  GmailPubSubPayloadError,
  isNonRetryablePayloadError,
} from '@/lib/email/gmailPubSubPayload';

function asBase64(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
}

describe('gmailPubSubPayload', () => {
  test('decodes a valid gmail notification payload', () => {
    const payload = decodeGmailPubSubPayload(
      asBase64({
        emailAddress: 'user@example.com',
        historyId: '12345',
      }),
    );

    expect(payload).toEqual({
      emailAddress: 'user@example.com',
      historyId: '12345',
    });
  });

  test('normalizes numeric history ids to strings', () => {
    const payload = decodeGmailPubSubPayload(
      asBase64({
        emailAddress: 'user@example.com',
        historyId: 98765,
      }),
    );

    expect(payload.historyId).toBe('98765');
  });

  test('throws non-retryable error for invalid json payload', () => {
    expect(() => decodeGmailPubSubPayload('this-is-not-json')).toThrowError(
      GmailPubSubPayloadError,
    );

    try {
      decodeGmailPubSubPayload('this-is-not-json');
    } catch (error) {
      expect(isNonRetryablePayloadError(error)).toBe(true);
      expect((error as GmailPubSubPayloadError).reason).toBe('invalid-json');
    }
  });

  test('throws non-retryable error when required fields are missing', () => {
    try {
      decodeGmailPubSubPayload(asBase64({ emailAddress: 'user@example.com' }));
      throw new Error('Expected decoder to fail');
    } catch (error) {
      expect(isNonRetryablePayloadError(error)).toBe(true);
      expect((error as GmailPubSubPayloadError).reason).toBe('missing-fields');
    }
  });
});
