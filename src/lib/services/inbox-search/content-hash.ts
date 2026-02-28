import crypto from 'node:crypto';

// Hash is computed on the raw body (pre-HTML-strip, pre-quote-removal) so that
// idempotency is based on the original content. Trade-off: if text-prep logic
// improves (e.g., better quote stripping), the hash won't change and existing
// documents won't be re-indexed. A full re-index would be required in that case.
export function computeInboxContentHash(body: string): string {
  return crypto.createHash('sha256').update(body ?? '', 'utf8').digest('hex');
}
