import { PubSub, type Message, type Subscription } from '@google-cloud/pubsub';
import { logger } from '@/lib/logger';
import { GmailPushService, type PushNotificationPayload } from '@/lib/email/gmailPushService';
import { decodeGmailPubSubPayload, isNonRetryablePayloadError } from '@/lib/email/gmailPubSubPayload';

const DEFAULT_DRAIN_POLL_MS = 50;

export type GmailPullMessage = Pick<Message, 'id' | 'data' | 'ack' | 'nack'>;

export async function processGmailPullMessage(params: {
  message: GmailPullMessage;
  processPushNotification: (payload: PushNotificationPayload) => Promise<void>;
}): Promise<'acked' | 'nacked'> {
  const { message, processPushNotification } = params;

  let payload: PushNotificationPayload;
  try {
    payload = decodeGmailPubSubPayload(message.data.toString('base64'));
  } catch (error) {
    if (isNonRetryablePayloadError(error)) {
      logger.warn('[GmailPullWorker] Non-retryable payload, acking message', {
        messageId: message.id,
        reason: error.reason,
      });
      message.ack();
      return 'acked';
    }

    logger.error('[GmailPullWorker] Unexpected payload decode failure, nacking message', {
      messageId: message.id,
      error,
    });
    message.nack();
    return 'nacked';
  }

  try {
    await processPushNotification(payload);
    message.ack();
    return 'acked';
  } catch (error) {
    if (isNonRetryablePayloadError(error)) {
      logger.warn('[GmailPullWorker] Non-retryable processing error, acking message', {
        messageId: message.id,
        error,
      });
      message.ack();
      return 'acked';
    }

    logger.error('[GmailPullWorker] Retryable processing error, nacking message', {
      messageId: message.id,
      error,
    });
    message.nack();
    return 'nacked';
  }
}

export async function waitForInFlightToDrain(
  inFlightTasks: Set<Promise<unknown>>,
  timeoutMs: number,
  pollMs = DEFAULT_DRAIN_POLL_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (inFlightTasks.size > 0 && Date.now() < deadline) {
    await Promise.race([
      Promise.allSettled(Array.from(inFlightTasks)),
      new Promise((resolve) => setTimeout(resolve, pollMs)),
    ]);
  }

  return inFlightTasks.size === 0;
}

export class GmailPullWorker {
  private readonly subscriptionName: string;
  private readonly maxMessages: number;
  private readonly maxBytes: number;
  private readonly processPushNotification: (
    payload: PushNotificationPayload,
  ) => Promise<void>;
  private readonly pubsubClient: PubSub;
  private subscription: Subscription | null = null;
  private readonly inFlightTasks = new Set<Promise<unknown>>();
  private isShuttingDown = false;

  constructor(params: {
    subscriptionName: string;
    maxMessages: number;
    maxBytes: number;
    pubsubClient?: PubSub;
    processPushNotification?: (payload: PushNotificationPayload) => Promise<void>;
  }) {
    this.subscriptionName = params.subscriptionName;
    this.maxMessages = params.maxMessages;
    this.maxBytes = params.maxBytes;
    this.pubsubClient = params.pubsubClient ?? new PubSub();
    this.processPushNotification =
      params.processPushNotification ??
      (async (payload) => {
        const pushService = new GmailPushService();
        await pushService.processPushNotification(payload);
      });
  }

  start(): void {
    if (this.subscription) {
      throw new Error('GmailPullWorker has already started.');
    }

    this.subscription = this.pubsubClient.subscription(this.subscriptionName, {
      flowControl: {
        maxMessages: this.maxMessages,
        maxBytes: this.maxBytes,
      },
    });

    this.subscription.on('message', this.handleMessage);
    this.subscription.on('error', this.handleSubscriptionError);
    this.subscription.on('close', this.handleSubscriptionClose);

    logger.info('[GmailPullWorker] Started', {
      subscription: this.subscriptionName,
      maxMessages: this.maxMessages,
      maxBytes: this.maxBytes,
    });
  }

  async stop(timeoutMs: number): Promise<{ drained: boolean; remaining: number }> {
    this.isShuttingDown = true;

    const subscription = this.subscription;
    if (subscription) {
      subscription.removeListener('message', this.handleMessage);
      subscription.removeListener('error', this.handleSubscriptionError);
      subscription.removeListener('close', this.handleSubscriptionClose);
      this.subscription = null;

      try {
        await subscription.close();
      } catch (error) {
        logger.warn('[GmailPullWorker] Failed to close subscription cleanly', error);
      }
    }

    const drained = await waitForInFlightToDrain(this.inFlightTasks, timeoutMs);
    const remaining = this.inFlightTasks.size;

    if (!drained) {
      logger.warn('[GmailPullWorker] Shutdown drain timeout reached', {
        timeoutMs,
        remaining,
      });
    }

    return { drained, remaining };
  }

  private handleSubscriptionError = (error: Error): void => {
    logger.error('[GmailPullWorker] Subscription error', {
      subscription: this.subscriptionName,
      error,
    });
  };

  private handleSubscriptionClose = (): void => {
    logger.warn('[GmailPullWorker] Subscription stream closed', {
      subscription: this.subscriptionName,
    });
  };

  private handleMessage = (message: Message): void => {
    if (this.isShuttingDown) {
      message.nack();
      return;
    }

    const task = processGmailPullMessage({
      message,
      processPushNotification: this.processPushNotification,
    }).catch((error) => {
      logger.error('[GmailPullWorker] Unhandled message processing error', {
        messageId: message.id,
        error,
      });
      try {
        message.nack();
      } catch (nackError) {
        logger.error('[GmailPullWorker] Failed to nack message after unhandled error', {
          messageId: message.id,
          error: nackError,
        });
      }
    });

    this.inFlightTasks.add(task);
    task.finally(() => {
      this.inFlightTasks.delete(task);
    });
  };
}
