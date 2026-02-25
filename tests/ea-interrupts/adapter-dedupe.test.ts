import { describe, expect, test } from 'vitest';
import { isDuplicateInboundFromAdapter } from '@/lib/services/messaging-orchestration/channelAdapters';

describe('Adapter deduplication', () => {
  test('duplicate inbound id is skipped idempotently', async () => {
    const adapter = {
      messageIdForDedupe: () => 'SM123',
    };

    let calls = 0;
    const result = await isDuplicateInboundFromAdapter(adapter, async (messageId) => {
      calls += 1;
      return messageId === 'SM123';
    });

    expect(calls).toBe(1);
    expect(result.isDuplicate).toBe(true);
    expect(result.messageId).toBe('SM123');
  });

  test('missing dedupe id does not call checker', async () => {
    const adapter = {
      messageIdForDedupe: () => null,
    };

    let calls = 0;
    const result = await isDuplicateInboundFromAdapter(adapter, async () => {
      calls += 1;
      return false;
    });

    expect(calls).toBe(0);
    expect(result.isDuplicate).toBe(false);
    expect(result.messageId).toBeNull();
  });
});
