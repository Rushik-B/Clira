import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDuplicateInboundFromAdapter } from '@/lib/services/messaging-orchestration/channelAdapters';

test('scenario 7: duplicate inbound id is skipped idempotently', async () => {
  const adapter = {
    messageIdForDedupe: () => 'SM123',
  };

  let calls = 0;
  const result = await isDuplicateInboundFromAdapter(adapter, async (messageId) => {
    calls += 1;
    return messageId === 'SM123';
  });

  assert.equal(calls, 1);
  assert.equal(result.isDuplicate, true);
  assert.equal(result.messageId, 'SM123');
});

test('scenario 7: missing dedupe id does not call checker', async () => {
  const adapter = {
    messageIdForDedupe: () => null,
  };

  let calls = 0;
  const result = await isDuplicateInboundFromAdapter(adapter, async () => {
    calls += 1;
    return false;
  });

  assert.equal(calls, 0);
  assert.equal(result.isDuplicate, false);
  assert.equal(result.messageId, null);
});
