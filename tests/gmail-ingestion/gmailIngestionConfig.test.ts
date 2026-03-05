import { afterEach, describe, expect, test } from 'vitest';
import {
  GmailIngestionConfigError,
  getGmailIngestionMode,
  getGmailPubSubTopic,
  getGmailPullMaxBytes,
  getGmailPullMaxMessages,
  getGmailPullRuntimeConfig,
  getGmailPullShutdownTimeoutMs,
  getGmailPullSubscription,
} from '@/lib/email/gmailIngestionConfig';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('gmailIngestionConfig', () => {
  test('defaults ingestion mode to pull', () => {
    delete process.env.GMAIL_INGESTION_MODE;
    expect(getGmailIngestionMode()).toBe('pull');
  });

  test('parses push mode', () => {
    process.env.GMAIL_INGESTION_MODE = 'push';
    expect(getGmailIngestionMode()).toBe('push');
  });

  test('throws explicit error for invalid mode', () => {
    process.env.GMAIL_INGESTION_MODE = 'invalid';

    expect(() => getGmailIngestionMode()).toThrowError(GmailIngestionConfigError);
    expect(() => getGmailIngestionMode()).toThrowError(
      /Invalid GMAIL_INGESTION_MODE/i,
    );
  });

  test('requires pubsub topic', () => {
    delete process.env.GMAIL_PUBSUB_TOPIC;
    expect(() => getGmailPubSubTopic()).toThrowError(
      /Missing required Gmail ingestion environment variable: GMAIL_PUBSUB_TOPIC/,
    );
  });

  test('requires pull subscription only in pull mode', () => {
    process.env.GMAIL_INGESTION_MODE = 'pull';
    delete process.env.GMAIL_PUBSUB_PULL_SUBSCRIPTION;
    expect(() => getGmailPullSubscription()).toThrowError(
      /GMAIL_PUBSUB_PULL_SUBSCRIPTION/,
    );

    process.env.GMAIL_INGESTION_MODE = 'push';
    delete process.env.GMAIL_PUBSUB_PULL_SUBSCRIPTION;
    expect(getGmailPullSubscription()).toBe('');
  });

  test('uses default pull runtime values', () => {
    process.env.GMAIL_INGESTION_MODE = 'pull';
    process.env.GMAIL_PUBSUB_PULL_SUBSCRIPTION =
      'projects/test/subscriptions/clira-gmail-pull-sub';
    delete process.env.GMAIL_PUBSUB_PULL_MAX_MESSAGES;
    delete process.env.GMAIL_PUBSUB_PULL_MAX_BYTES;
    delete process.env.GMAIL_PUBSUB_PULL_SHUTDOWN_TIMEOUT_MS;

    expect(getGmailPullMaxMessages()).toBe(25);
    expect(getGmailPullMaxBytes()).toBe(10 * 1024 * 1024);
    expect(getGmailPullShutdownTimeoutMs()).toBe(15_000);
  });

  test('throws on invalid pull tuning values', () => {
    process.env.GMAIL_PUBSUB_PULL_MAX_MESSAGES = '0';
    expect(() => getGmailPullMaxMessages()).toThrow(/Expected a positive integer/);
  });

  test('returns complete pull runtime config', () => {
    process.env.GMAIL_INGESTION_MODE = 'pull';
    process.env.GMAIL_PUBSUB_PULL_SUBSCRIPTION = 'projects/test/subscriptions/sub-a';
    process.env.GMAIL_PUBSUB_PULL_MAX_MESSAGES = '10';
    process.env.GMAIL_PUBSUB_PULL_MAX_BYTES = '2048';
    process.env.GMAIL_PUBSUB_PULL_SHUTDOWN_TIMEOUT_MS = '9000';

    expect(getGmailPullRuntimeConfig()).toEqual({
      subscription: 'projects/test/subscriptions/sub-a',
      maxMessages: 10,
      maxBytes: 2048,
      shutdownTimeoutMs: 9000,
    });
  });
});
