import type { PushNotificationPayload } from '@/lib/email/gmailPushService';

export class GmailPubSubPayloadError extends Error {
  readonly retryable: boolean;
  readonly reason:
    | 'invalid-base64'
    | 'invalid-json'
    | 'invalid-shape'
    | 'missing-fields';

  constructor(
    message: string,
    reason: 'invalid-base64' | 'invalid-json' | 'invalid-shape' | 'missing-fields',
    retryable = false,
  ) {
    super(message);
    this.name = 'GmailPubSubPayloadError';
    this.reason = reason;
    this.retryable = retryable;
  }
}

function decodeBase64Utf8(encoded: string): string {
  if (!encoded || typeof encoded !== 'string') {
    throw new GmailPubSubPayloadError(
      'Pub/Sub message data is missing or not a base64 string.',
      'invalid-base64',
      false,
    );
  }

  try {
    return Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    throw new GmailPubSubPayloadError(
      'Failed to decode Pub/Sub message data from base64.',
      'invalid-base64',
      false,
    );
  }
}

/**
 * Gmail watch notifications carry `emailAddress` and `historyId` in a JSON payload.
 * We treat malformed payloads as non-retryable to prevent poison-message loops.
 */
export function decodeGmailPubSubPayload(base64Data: string): PushNotificationPayload {
  const decoded = decodeBase64Utf8(base64Data);

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new GmailPubSubPayloadError(
      'Pub/Sub message data is not valid JSON.',
      'invalid-json',
      false,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new GmailPubSubPayloadError(
      'Pub/Sub message payload must be a JSON object.',
      'invalid-shape',
      false,
    );
  }

  const payload = parsed as Record<string, unknown>;
  const emailAddress = typeof payload.emailAddress === 'string' ? payload.emailAddress.trim() : '';
  const historyId =
    typeof payload.historyId === 'string'
      ? payload.historyId.trim()
      : payload.historyId != null
        ? String(payload.historyId).trim()
        : '';

  if (!emailAddress || !historyId) {
    throw new GmailPubSubPayloadError(
      'Pub/Sub message payload is missing required fields: emailAddress and historyId.',
      'missing-fields',
      false,
    );
  }

  return {
    emailAddress,
    historyId,
  };
}

export function isNonRetryablePayloadError(error: unknown): error is GmailPubSubPayloadError {
  return error instanceof GmailPubSubPayloadError && error.retryable === false;
}
