/**
 * WhatsApp Webhook Endpoint
 *
 * Handles incoming WhatsApp Cloud API webhooks:
 * - GET: Webhook verification (Meta setup handshake)
 * - POST: Incoming messages and status updates
 *
 * Security:
 * - GET: Validates verify_token matches our configured token
 * - POST: Validates X-Hub-Signature-256 using HMAC SHA256
 *
 * Pattern: Immediate acknowledgment (200 OK), async processing
 * This prevents HTTP timeouts and Pub/Sub retries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  getConversationManager,
  getWhatsAppClient,
  isWhatsAppConfigured,
  type WhatsAppWebhookPayload,
  type WhatsAppWebhookStatusUpdate,
} from '@/lib/services/whatsapp';
import { processWhatsAppMessage } from '@/lib/services/whatsapp/messageProcessor';
import { markReminderMissed } from '@/lib/services/reminderNotificationService';

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

function parseStatusTimestamp(timestamp: number): Date {
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function processStatusUpdates(statusUpdates: WhatsAppWebhookStatusUpdate[]): Promise<void> {
  if (statusUpdates.length === 0) return;

  const conversationManager = getConversationManager();

  for (const statusUpdate of statusUpdates) {
    const normalizedStatus = normalizeStatus(statusUpdate.status);
    const statusTimestamp = parseStatusTimestamp(statusUpdate.timestamp);
    const firstError = statusUpdate.errors?.[0];
    const errorPayload = firstError
      ? {
          code: firstError.code,
          title: firstError.title,
          message: firstError.message,
          details: firstError.details,
          href: firstError.href,
        }
      : undefined;

    const matchedMessages = await conversationManager.recordOutboundStatusUpdate({
      waMessageId: statusUpdate.messageId,
      status: normalizedStatus,
      statusTimestamp,
      recipientId: statusUpdate.recipientId,
      error: errorPayload,
    });

    if (matchedMessages.length === 0) {
      logger.info('[WhatsApp Webhook] Status update received for unknown outbound message', {
        messageId: statusUpdate.messageId,
        status: normalizedStatus,
      });
      continue;
    }

    logger.info('[WhatsApp Webhook] Outbound status update processed', {
      messageId: statusUpdate.messageId,
      status: normalizedStatus,
      matchedMessages: matchedMessages.length,
      hasError: Boolean(errorPayload),
    });

    if (normalizedStatus !== 'failed') {
      continue;
    }

    const reason = firstError?.message
      ? `whatsapp-status-failed: ${firstError.message}`
      : 'whatsapp-status-failed';

    for (const message of matchedMessages) {
      if (message.source !== 'reminder_notification' || !message.reminderId) {
        continue;
      }

      await markReminderMissed({
        reminderId: message.reminderId,
        userId: message.userId,
        reason,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Webhook Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles Meta's webhook verification request.
 *
 * When setting up the webhook in Meta's App Dashboard, they send a GET request
 * with hub.mode, hub.verify_token, and hub.challenge. We must respond with
 * the challenge if the verify_token matches our configured token.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  logger.info('[WhatsApp Webhook] Verification request received', {
    mode,
    hasToken: !!token,
    tokenValue: token ? `${token.slice(0, 4)}****` : null,
    hasChallenge: !!challenge,
    challengeValue: challenge,
    url: request.url,
  });

  // Check if WhatsApp is configured
  if (!isWhatsAppConfigured()) {
    logger.error('[WhatsApp Webhook] WhatsApp not configured - missing env vars');
    return new Response('WhatsApp not configured', { status: 503 });
  }

  const client = getWhatsAppClient();
  const expectedToken = client.getVerifyToken();

  logger.info('[WhatsApp Webhook] Token comparison', {
    receivedToken: token ? `${token.slice(0, 4)}****` : null,
    expectedToken: expectedToken ? `${expectedToken.slice(0, 4)}****` : null,
    tokensMatch: token === expectedToken,
    modeMatches: mode === 'subscribe',
  });

  // Validate the verification request
  if (mode === 'subscribe' && token === expectedToken) {
    if (!challenge) {
      logger.error('[WhatsApp Webhook] Challenge is missing');
      return new Response('Challenge missing', { status: 400 });
    }

    logger.info('[WhatsApp Webhook] Verification successful', {
      challenge: challenge,
    });

    // Meta expects the challenge echoed back as plain text with 200 status
    // Explicitly set Content-Type to text/plain to ensure proper handling
    return new Response(challenge, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  logger.warn('[WhatsApp Webhook] Verification failed', {
    reason: mode !== 'subscribe' ? 'mode mismatch' : 'token mismatch',
    mode,
    expectedMode: 'subscribe',
    tokenMatch: token === expectedToken,
  });

  return new Response('Forbidden', { status: 403 });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST: Incoming Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles incoming WhatsApp messages and status updates.
 *
 * Flow:
 * 1. Verify webhook signature (HMAC SHA256)
 * 2. Parse the webhook payload
 * 3. Acknowledge immediately (200 OK)
 * 4. Process message asynchronously
 *
 * This pattern prevents HTTP timeouts since message processing
 * (agent invocation, Gmail API calls) can take several seconds.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Check if WhatsApp is configured
  if (!isWhatsAppConfigured()) {
    logger.error('[WhatsApp Webhook] WhatsApp not configured - missing env vars');
    return NextResponse.json(
      { error: 'WhatsApp not configured' },
      { status: 503 },
    );
  }

  // Read the raw body for signature verification
  const rawBody = await request.text();

  // Verify webhook signature
  const signature = request.headers.get('x-hub-signature-256');
  const client = getWhatsAppClient();

  if (!client.verifyWebhookSignature(signature, rawBody)) {
    logger.warn('[WhatsApp Webhook] Invalid signature - rejecting request');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 },
    );
  }

  // Parse the JSON payload
  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logger.error('[WhatsApp Webhook] Invalid JSON payload');
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const statusUpdates = client.parseWebhookStatusUpdates(payload);
  if (statusUpdates.length > 0) {
    try {
      await processStatusUpdates(statusUpdates);
    } catch (error) {
      logger.error('[WhatsApp Webhook] Failed processing status updates', {
        count: statusUpdates.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Parse the webhook payload to extract message
  const message = client.parseWebhookPayload(payload);

  if (!message) {
    // This is a status update or non-message webhook - acknowledge and ignore
    if (statusUpdates.length > 0) {
      return NextResponse.json({ success: true });
    }
    logger.debug('[WhatsApp Webhook] Non-message webhook received');
    return NextResponse.json({ success: true });
  }

  logger.info('[WhatsApp Webhook] Message received', {
    waId: `${message.waId.slice(0, 4)}****`,
    ...(message.audioMediaId
      ? { voiceMemo: true, messageId: message.messageId }
      : message.imageMediaId
        ? { image: true, messageId: message.messageId, hasCaption: Boolean(message.imageCaption) }
        : message.pdfMediaId
          ? {
              pdf: true,
              messageId: message.messageId,
              filename: message.pdfFilename ?? null,
              hasCaption: Boolean(message.pdfCaption),
            }
        : { textLength: message.text.length, messageId: message.messageId }),
  });

  // Acknowledge immediately to prevent retries and timeouts
  // Process the message asynchronously
  processWhatsAppMessage(message)
    .then((result) => {
      const log = result.success ? logger.info : logger.warn;
      log('[WhatsApp Webhook] Message processed', {
        waId: `${message.waId.slice(0, 4)}****`,
        success: result.success,
        error: result.error ?? null,
      });
    })
    .catch((error) => {
      logger.error('[WhatsApp Webhook] Error processing message', {
        waId: `${message.waId.slice(0, 4)}****`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

  return NextResponse.json({ success: true });
}
