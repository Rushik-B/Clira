import { describe, expect, test, vi } from 'vitest';
import type { PushNotificationPayload } from '@/lib/email/gmailPushService';
import {
  processGmailPullMessage,
  waitForInFlightToDrain,
  type GmailPullMessage,
} from '@/lib/email/gmailPullWorker';

function createMessage(data: unknown): GmailPullMessage & { ack: ReturnType<typeof vi.fn>; nack: ReturnType<typeof vi.fn> } {
  const ack = vi.fn();
  const nack = vi.fn();
  return {
    id: 'message-1',
    data: Buffer.from(JSON.stringify(data), 'utf-8'),
    ack,
    nack,
  };
}

describe('gmailPullWorker message handling', () => {
  test('acks message on successful processing', async () => {
    const message = createMessage({
      emailAddress: 'user@example.com',
      historyId: '123',
    });
    const processor = vi.fn(async (_payload: PushNotificationPayload) => undefined);

    const outcome = await processGmailPullMessage({
      message,
      processPushNotification: processor,
    });

    expect(outcome).toBe('acked');
    expect(processor).toHaveBeenCalledWith({
      emailAddress: 'user@example.com',
      historyId: '123',
    });
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.nack).not.toHaveBeenCalled();
  });

  test('acks malformed payloads (non-retryable poison messages)', async () => {
    const ack = vi.fn();
    const nack = vi.fn();
    const malformedMessage: GmailPullMessage = {
      id: 'message-2',
      data: Buffer.from('not-json', 'utf-8'),
      ack,
      nack,
    };

    const outcome = await processGmailPullMessage({
      message: malformedMessage,
      processPushNotification: vi.fn().mockResolvedValue(undefined),
    });

    expect(outcome).toBe('acked');
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  test('nacks retryable processing failures', async () => {
    const message = createMessage({
      emailAddress: 'user@example.com',
      historyId: '124',
    });
    const processor = vi.fn(async (_payload: PushNotificationPayload) => {
      throw new Error('transient failure');
    });

    const outcome = await processGmailPullMessage({
      message,
      processPushNotification: processor,
    });

    expect(outcome).toBe('nacked');
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.nack).toHaveBeenCalledTimes(1);
  });
});

describe('gmailPullWorker shutdown drain behavior', () => {
  test('reports drained when in-flight tasks settle before timeout', async () => {
    const inFlight = new Set<Promise<unknown>>();
    let resolveTask: (() => void) | null = null;

    const task = new Promise<void>((resolve) => {
      resolveTask = () => {
        inFlight.delete(task);
        resolve();
      };
    });
    inFlight.add(task);

    setTimeout(() => resolveTask?.(), 10);
    const drained = await waitForInFlightToDrain(inFlight, 200, 5);

    expect(drained).toBe(true);
    expect(inFlight.size).toBe(0);
  });

  test('times out when in-flight tasks do not settle', async () => {
    const inFlight = new Set<Promise<unknown>>();
    inFlight.add(new Promise(() => {}));

    const drained = await waitForInFlightToDrain(inFlight, 20, 5);

    expect(drained).toBe(false);
    expect(inFlight.size).toBe(1);
  });
});
