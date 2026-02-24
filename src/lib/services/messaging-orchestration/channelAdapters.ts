import type {
  ChannelAdapter,
  OrchestrationChannel,
} from './types';

export function buildConversationKeyFromAdapter(adapter: Pick<ChannelAdapter, 'channel' | 'conversationId'>): string {
  return `${adapter.channel}:${adapter.conversationId()}`;
}

export function ensureAdapterChannel(
  channel: OrchestrationChannel,
  adapter: Pick<ChannelAdapter, 'channel'>,
): void {
  if (adapter.channel !== channel) {
    throw new Error(`Channel adapter mismatch: expected ${channel}, got ${adapter.channel}`);
  }
}

export async function isDuplicateInboundFromAdapter(
  adapter: Pick<ChannelAdapter, 'messageIdForDedupe'>,
  hasSeenMessageId: (messageId: string) => Promise<boolean>,
): Promise<{ isDuplicate: boolean; messageId: string | null }> {
  const messageId = adapter.messageIdForDedupe();
  if (!messageId) {
    return { isDuplicate: false, messageId: null };
  }

  const isDuplicate = await hasSeenMessageId(messageId);
  return { isDuplicate, messageId };
}
