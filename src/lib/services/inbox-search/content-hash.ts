import crypto from 'node:crypto';

export function computeInboxContentHash(body: string): string {
  return crypto.createHash('sha256').update(body ?? '', 'utf8').digest('hex');
}
