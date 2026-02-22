import crypto from 'crypto';
import type { ProgressUpdateContext } from '@/lib/ai/tools/sendProgressUpdate';

export function buildNotificationProgressContext(
  channel: 'whatsapp' | 'telegram',
  conversationId: string,
): ProgressUpdateContext {
  return {
    channel,
    requestId: crypto.randomUUID(),
    conversationId,
    persistMessage: async () => undefined,
  };
}
