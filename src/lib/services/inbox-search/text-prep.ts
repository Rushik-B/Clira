import { stripHtmlPreservingNewlines } from '@/lib/email/text';
import { stripQuotedReplyChainsAndSignatures } from '@/lib/services/supermemory/emailPruner';

export function prepareInboxBodyText(rawBody: string): string {
  if (!rawBody) return '';
  const plainText = stripHtmlPreservingNewlines(rawBody);
  return stripQuotedReplyChainsAndSignatures(plainText);
}
