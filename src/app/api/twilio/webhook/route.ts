/**
 * Twilio SMS/RCS Webhook Endpoint
 *
 * Handles incoming Twilio Programmable Messaging webhooks:
 * - GET: Optional webhook verification (not required by Twilio but included for completeness)
 * - POST: Incoming SMS/RCS messages and status updates
 *
 * Security:
 * - POST: Validates X-Twilio-Signature using HMAC SHA1
 *
 * Pattern: Immediate acknowledgment (200 OK), async processing
 * This prevents HTTP timeouts and webhook retries.
 *
 * Key Differences from WhatsApp:
 * - Twilio uses form-encoded webhooks (application/x-www-form-urlencoded), NOT JSON
 * - Signature algorithm is HMAC SHA1 (not SHA256)
 * - Signature includes the full webhook URL + sorted params
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  getTwilioClient,
  isTwilioConfigured,
} from '@/lib/services/twilio';
import { processTwilioMessage } from '@/lib/services/twilio/messageProcessor';

// ─────────────────────────────────────────────────────────────────────────────
// GET: Optional Webhook Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional GET handler for health checks or basic verification.
 * Twilio doesn't require GET verification like WhatsApp/Meta, but we include it
 * for consistency and potential future use.
 */
export async function GET(request: NextRequest): Promise<Response> {
  logger.info('[Twilio Webhook] GET request received', {
    url: request.url,
  });

  // Check if Twilio is configured
  if (!isTwilioConfigured()) {
    logger.error('[Twilio Webhook] Twilio not configured - missing env vars');
    return new Response('Twilio not configured', { status: 503 });
  }

  return new Response('Twilio webhook endpoint is active', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST: Incoming Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles incoming Twilio SMS/RCS messages and status updates.
 *
 * Flow:
 * 1. Parse form-encoded body (NOT JSON)
 * 2. Verify webhook signature (HMAC SHA1 with URL + params)
 * 3. Extract message data
 * 4. Acknowledge immediately (200 OK)
 * 5. Process message asynchronously
 *
 * This pattern prevents HTTP timeouts since message processing
 * (agent invocation, Gmail API calls) can take several seconds.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Check if Twilio is configured
  if (!isTwilioConfigured()) {
    logger.error('[Twilio Webhook] Twilio not configured - missing env vars');
    return NextResponse.json(
      { error: 'Twilio not configured' },
      { status: 503 },
    );
  }

  const client = getTwilioClient();

  // Step 1: Parse form-encoded body
  // Twilio sends webhooks as application/x-www-form-urlencoded, NOT JSON
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    logger.error('[Twilio Webhook] Failed to parse form data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Invalid form data' },
      { status: 400 },
    );
  }

  // Convert FormData to Record<string, string> for signature verification and parsing
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = value.toString();
  }

  logger.debug('[Twilio Webhook] Form data parsed', {
    keys: Object.keys(params),
    messageSid: params.MessageSid?.slice(0, 16) + '...',
    from: params.From?.slice(0, 4) + '****',
  });

  // Step 2: Verify webhook signature
  // Twilio signature algorithm: HMAC SHA1 of (URL + sorted params)
  // Important: When behind a proxy (e.g., ngrok), reconstruct the original URL
  // that Twilio used to sign the request using forwarded headers
  const signature = request.headers.get('x-twilio-signature');
  
  // Reconstruct the original URL from forwarded headers if present
  // This is necessary when running behind ngrok or other proxies
  let url = request.url;
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  
  if (forwardedHost && forwardedProto) {
    // Reconstruct the URL that Twilio actually called
    const pathname = new URL(request.url).pathname;
    url = `${forwardedProto}://${forwardedHost}${pathname}`;
  }

  if (!client.verifyWebhookSignature(signature, url, params)) {
    logger.warn('[Twilio Webhook] Invalid signature - rejecting request', {
      hasSignature: !!signature,
      url: url.slice(0, 50) + '...',
      originalUrl: request.url.slice(0, 50) + '...',
      forwardedHost,
      forwardedProto,
    });
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 },
    );
  }

  // Step 3: Parse the webhook payload to extract message
  const message = client.parseWebhookPayload(params);

  if (!message) {
    // This is a status update or non-message webhook - acknowledge and ignore
    logger.debug('[Twilio Webhook] Non-message webhook received (likely status update)');
    return NextResponse.json({ success: true });
  }

  logger.info('[Twilio Webhook] Message received', {
    from: `${message.from.slice(0, 4)}****`,
    to: `${message.to.slice(0, 4)}****`,
    bodyLength: message.body.length,
    messageSid: message.messageSid.slice(0, 16) + '...',
    channelPrefix: message.channelPrefix,
  });

  // Step 4: Acknowledge immediately to prevent retries and timeouts
  // Step 5: Process the message asynchronously
  processTwilioMessage(message)
    .then((result) => {
      logger.info('[Twilio Webhook] Message processed successfully', {
        from: `${message.from.slice(0, 4)}****`,
        success: result.success,
      });
    })
    .catch((error) => {
      logger.error('[Twilio Webhook] Error processing message', {
        from: `${message.from.slice(0, 4)}****`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

  return NextResponse.json({ success: true });
}
