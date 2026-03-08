import { beforeEach, describe, expect, test, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  mode: 'push' as 'push' | 'pull',
  processPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/email/gmailIngestionConfig', () => ({
  getGmailIngestionMode: () => routeMocks.mode,
}));

vi.mock('@/lib/email/gmailPushService', () => ({
  GmailPushService: class GmailPushServiceMock {
    processPushNotification = routeMocks.processPushNotification;
  },
}));

const { POST } = await import('@/app/api/gmail-push/webhook/route');
const { processGmailPullMessage } = await import('@/lib/email/gmailPullWorker');

function buildPushWebhookRequest(payload: unknown): Request {
  return new Request('http://localhost/api/gmail-push/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        data: Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64'),
      },
    }),
  });
}

describe('gmail push webhook route', () => {
  beforeEach(() => {
    routeMocks.mode = 'push';
    routeMocks.processPushNotification.mockReset().mockResolvedValue(undefined);
  });

  test('returns 404 when ingestion mode is pull', async () => {
    routeMocks.mode = 'pull';

    const response = await POST(
      buildPushWebhookRequest({
        emailAddress: 'user@example.com',
        historyId: '1',
      }) as any,
    );

    expect(response.status).toBe(404);
    expect(routeMocks.processPushNotification).not.toHaveBeenCalled();
  });

  test('returns immediate 200 and defers processing when mode is push', async () => {
    const response = await POST(
      buildPushWebhookRequest({
        emailAddress: 'user@example.com',
        historyId: '42',
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(routeMocks.processPushNotification).toHaveBeenCalledWith({
      emailAddress: 'user@example.com',
      historyId: '42',
    });
  });

  test('acks malformed payloads without invoking processor', async () => {
    const malformedRequest = new Request('http://localhost/api/gmail-push/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { data: Buffer.from('not-json').toString('base64') },
      }),
    });

    const response = await POST(malformedRequest as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(routeMocks.processPushNotification).not.toHaveBeenCalled();
  });

  test('webhook and pull worker invoke processor with identical payload shape', async () => {
    const payload = {
      emailAddress: 'shared@example.com',
      historyId: '9001',
    };

    await POST(buildPushWebhookRequest(payload) as any);
    const webhookCall = routeMocks.processPushNotification.mock.calls[0]?.[0];

    const pullProcessor = vi.fn().mockResolvedValue(undefined);
    await processGmailPullMessage({
      message: {
        id: 'pull-message-1',
        data: Buffer.from(JSON.stringify(payload), 'utf-8'),
        ack: vi.fn(),
        nack: vi.fn(),
      },
      processPushNotification: pullProcessor,
    });

    const pullCall = pullProcessor.mock.calls[0]?.[0];
    expect(webhookCall).toEqual(pullCall);
  });
});
