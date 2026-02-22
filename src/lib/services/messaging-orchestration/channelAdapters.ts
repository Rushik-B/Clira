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
