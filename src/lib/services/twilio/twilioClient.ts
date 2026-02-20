/**
 * Twilio SMS/RCS API Client
 *
 * Low-level client for interacting with the Twilio Programmable Messaging API.
 * Handles authentication, message sending (SMS + RCS), webhook verification, and payload parsing.
 *
 * API Reference: https://www.twilio.com/docs/messaging/api
 * RCS Documentation: https://www.twilio.com/docs/messaging/channels/rcs
 */

import crypto from 'crypto';
import { logger } from '@/lib/logger';
import type { Twilio } from 'twilio';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TwilioClientConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  messagingServiceSid?: string; // For RCS support
}

export interface TwilioSendMessageOptions {
  /** RCS Content Template SID (HXxxxxx) for rich cards/carousels/buttons */
  contentSid?: string;
  /** Variables to populate RCS content template */
  contentVariables?: Record<string, string>;
}

export interface TwilioSendMessageResponse {
  messageSid: string;
}

export interface TwilioWebhookMessage {
  /** Twilio Message SID (e.g., "SM...") */
  messageSid: string;
  /** Sender phone number in E.164 format (e.g., "+16505551234") */
  from: string;
  /** Recipient phone number in E.164 format */
  to: string;
  /** Message text content */
  body: string;
  /** Number of media attachments (for future MMS support) */
  numMedia: number;
  /** Channel type: "sms" or "rcs" (from ChannelPrefix field) */
  channelPrefix?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Class
// ─────────────────────────────────────────────────────────────────────────────

export class TwilioApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = 'TwilioApiError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates Twilio client configuration from environment variables.
 * Throws if required variables are missing.
 */
export function createTwilioConfig(): TwilioClientConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber =
    process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid) {
    throw new Error('TWILIO_ACCOUNT_SID environment variable is required');
  }
  if (!authToken) {
    throw new Error('TWILIO_AUTH_TOKEN environment variable is required');
  }
  if (!phoneNumber) {
    throw new Error(
      'TWILIO_PHONE_NUMBER (or TWILIO_WHATSAPP_NUMBER) environment variable is required',
    );
  }

  return {
    accountSid,
    authToken,
    phoneNumber,
    messagingServiceSid,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Twilio SMS/RCS API Client
 *
 * Provides methods for:
 * - Sending SMS messages
 * - Sending RCS rich content (cards, carousels, buttons)
 * - Verifying webhook signatures (HMAC SHA1)
 * - Parsing incoming webhook payloads (form-encoded)
 */
export class TwilioClient {
  private readonly config: TwilioClientConfig;
  private twilioSdk: Twilio | null = null;

  constructor(config?: Partial<TwilioClientConfig>) {
    const envConfig = createTwilioConfig();
    this.config = { ...envConfig, ...config };
  }

  /**
   * Lazily initialize Twilio SDK.
   * This prevents issues during build time when twilio module isn't available.
   */
  private getTwilioSdk(): Twilio {
    if (!this.twilioSdk) {
      // Dynamic import to avoid build-time issues
      const twilioModule = require('twilio');
      this.twilioSdk = twilioModule(this.config.accountSid, this.config.authToken);
    }
    if (!this.twilioSdk) {
      throw new Error('Failed to initialize Twilio SDK');
    }
    return this.twilioSdk;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Message Sending
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sends an SMS or RCS message to a phone number.
   *
   * SMS Mode (default):
   * - Messages ≤160 chars auto-upgrade to RCS on capable devices (free)
   * - No code changes needed for basic upgrade
   *
   * RCS Rich Content Mode:
   * - Use contentSid + contentVariables for cards/carousels/buttons
   * - Automatically falls back to SMS if RCS unavailable
   *
   * @param to - Recipient phone number in E.164 format (e.g., "+16505551234")
   * @param body - Message text content (ignored if contentSid provided)
   * @param options - Optional RCS content template configuration
   * @returns The Twilio message SID
   */
  async sendMessage(
    to: string,
    body: string,
    options?: TwilioSendMessageOptions,
  ): Promise<TwilioSendMessageResponse> {
    logger.debug(`[Twilio] Sending message to: ${to.slice(0, 4)}****`);

    try {
      const twilioSdk = this.getTwilioSdk();

      // Build message parameters
      const messageParams: {
        to: string;
        from?: string;
        body?: string;
        contentSid?: string;
        contentVariables?: string;
        messagingServiceSid?: string;
      } = {
        to,
        from: this.config.phoneNumber,
      };

      // RCS rich content mode: use Content Template
      if (options?.contentSid) {
        messageParams.contentSid = options.contentSid;
        if (options.contentVariables) {
          messageParams.contentVariables = JSON.stringify(options.contentVariables);
        }
        logger.debug(`[Twilio] Using RCS content template: ${options.contentSid}`);
      } else {
        // Standard SMS mode (auto-upgrades to RCS on capable devices)
        messageParams.body = body;
      }

      // Use Messaging Service SID if configured (recommended for RCS)
      if (this.config.messagingServiceSid) {
        messageParams.messagingServiceSid = this.config.messagingServiceSid;
        delete messageParams.from; // Messaging Service handles sender ID
      }

      const message = await twilioSdk.messages.create(messageParams);

      logger.debug(`[Twilio] Message sent: sid=${message.sid}`);

      return { messageSid: message.sid };
    } catch (error) {
      logger.error('[Twilio] Failed to send message', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new TwilioApiError(
        `Twilio API error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Verification
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verifies the webhook signature from Twilio.
   * Uses HMAC SHA1 with the auth token to validate the payload.
   *
   * Important: Twilio uses SHA1 (not SHA256 like WhatsApp)
   *
   * @param signature - The X-Twilio-Signature header value (base64-encoded HMAC)
   * @param url - The full webhook URL (must match exactly)
   * @param params - The form-encoded parameters from the request body
   * @returns true if signature is valid, false otherwise
   */
  verifyWebhookSignature(
    signature: string | null,
    url: string,
    params: Record<string, string>,
  ): boolean {
    if (!signature) {
      logger.warn('[Twilio] Missing webhook signature header');
      return false;
    }

    try {
      // Twilio's signature algorithm:
      // 1. URL + sorted(params) concatenated as: url + param1=value1param2=value2...
      // 2. HMAC SHA1 with auth token
      // 3. Base64 encode

      // Sort params alphabetically by key
      const sortedKeys = Object.keys(params).sort();

      // Build data string: url + sorted params concatenated
      let data = url;
      for (const key of sortedKeys) {
        data += key + params[key];
      }

      // Compute HMAC SHA1
      const expectedSignature = crypto
        .createHmac('sha1', this.config.authToken)
        .update(data, 'utf-8')
        .digest('base64');

      // Timing-safe comparison
      const isValid =
        signature.length === expectedSignature.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

      if (!isValid) {
        logger.warn('[Twilio] Webhook signature mismatch');
      }

      return isValid;
    } catch (error) {
      logger.warn('[Twilio] Webhook signature verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payload Parsing
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parses an incoming webhook payload (form-encoded data).
   * Returns null if the payload is not an inbound message (e.g., status update).
   *
   * Twilio webhooks are form-encoded (application/x-www-form-urlencoded),
   * NOT JSON like WhatsApp.
   *
   * @param formData - The parsed form data from the webhook
   * @returns Extracted message data or null if not an inbound message
   */
  parseWebhookPayload(formData: Record<string, string>): TwilioWebhookMessage | null {
    const messageSid = formData.MessageSid;
    const from = formData.From;
    const to = formData.To;
    const body = formData.Body;
    const numMedia = parseInt(formData.NumMedia || '0', 10);
    const messageStatus = formData.MessageStatus;
    const channelPrefix = formData.ChannelPrefix; // "sms" or "rcs"

    // Filter out status updates (sent, delivered, read, failed)
    // We only want inbound messages from users
    if (messageStatus && !messageSid) {
      logger.debug('[Twilio] Ignoring status update webhook');
      return null;
    }

    // Validate required fields for inbound message
    if (!messageSid || !from || !to || body === undefined) {
      logger.debug('[Twilio] Webhook missing required fields, ignoring');
      return null;
    }

    logger.debug('[Twilio] Parsed inbound message', {
      from: `${from.slice(0, 4)}****`,
      messageSid: messageSid.slice(0, 16) + '...',
      bodyLength: body.length,
      channelPrefix,
    });

    return {
      messageSid,
      from,
      to,
      body,
      numMedia,
      channelPrefix,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton & Helpers
// ─────────────────────────────────────────────────────────────────────────────

let _clientInstance: TwilioClient | null = null;

/**
 * Gets the singleton Twilio client instance.
 * Creates the client on first call using environment configuration.
 */
export function getTwilioClient(): TwilioClient {
  if (!_clientInstance) {
    _clientInstance = new TwilioClient();
  }
  return _clientInstance;
}

/**
 * Checks if Twilio is configured (all required env vars present).
 */
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER)
  );
}
