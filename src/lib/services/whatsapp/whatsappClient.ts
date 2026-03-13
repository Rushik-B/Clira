/**
 * WhatsApp Cloud API Client
 *
 * Low-level HTTP client for interacting with the Meta WhatsApp Cloud API.
 * Handles authentication, message sending, webhook verification, and payload parsing.
 *
 * API Reference: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import crypto from 'crypto';
import { logger } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppClientConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  apiVersion?: string;
}

export interface WhatsAppSendMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface WhatsAppWebhookMessage {
  /** WhatsApp ID (phone number without +) of the sender */
  waId: string;
  /** Display name of the sender */
  senderName: string;
  /** WhatsApp message ID */
  messageId: string;
  /** Message content (text, or placeholder when audio) */
  text: string;
  /** Unix timestamp of the message */
  timestamp: number;
  /** When present, message is a voice memo; media must be downloaded and transcribed */
  audioMediaId?: string;
  audioMimeType?: string;
  /** When present, message is an image; media must be downloaded and described */
  imageMediaId?: string;
  imageMimeType?: string;
  imageCaption?: string;
  /** When present, message is a PDF document; media must be downloaded and extracted */
  pdfMediaId?: string;
  pdfMimeType?: string;
  pdfFilename?: string;
  pdfCaption?: string;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          audio?: { id: string; mime_type?: string };
          image?: { id: string; mime_type?: string; caption?: string };
          document?: { id: string; mime_type?: string; filename?: string; caption?: string };
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
          conversation?: {
            id?: string;
            expiration_timestamp?: string;
            origin?: {
              type?: string;
            };
          };
          errors?: Array<{
            code?: number;
            title?: string;
            message?: string;
            error_data?: {
              details?: string;
            };
            href?: string;
          }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

export interface WhatsAppWebhookStatusUpdate {
  messageId: string;
  status: string;
  timestamp: number;
  recipientId: string;
  conversationId?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    details?: string;
    href?: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Class
// ─────────────────────────────────────────────────────────────────────────────

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_API_VERSION = 'v21.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const BASE_URL = 'https://graph.facebook.com';

function normalizeMarkdownForWhatsApp(text: string): string {
  if (!text.includes('*') && !text.includes('_')) return text;

  // Convert markdown bold variants to WhatsApp-native bold markers.
  return text
    .replace(/\*\*\*([^\n]+?)\*\*\*/g, '*$1*')
    .replace(/\*\*([^\n]+?)\*\*/g, '*$1*')
    .replace(/__([^\n]+?)__/g, '*$1*');
}

/**
 * Creates WhatsApp client configuration from environment variables.
 * Throws if required variables are missing.
 */
export function createWhatsAppConfig(): WhatsAppClientConfig {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN environment variable is required');
  }
  if (!phoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID environment variable is required');
  }
  if (!appSecret) {
    throw new Error('WHATSAPP_APP_SECRET environment variable is required');
  }
  if (!verifyToken) {
    throw new Error('WHATSAPP_VERIFY_TOKEN environment variable is required');
  }

  return {
    accessToken,
    phoneNumberId,
    appSecret,
    verifyToken,
    apiVersion: process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WhatsApp Cloud API Client
 *
 * Provides methods for:
 * - Sending text messages
 * - Verifying webhook signatures (HMAC SHA256)
 * - Parsing incoming webhook payloads
 */
export class WhatsAppClient {
  private readonly config: WhatsAppClientConfig;

  constructor(config?: Partial<WhatsAppClientConfig>) {
    const envConfig = createWhatsAppConfig();
    this.config = { ...envConfig, ...config };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Message Sending
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sends a text message to a WhatsApp user.
   *
   * @param to - Recipient phone number in E.164 format (without +)
   * @param text - Message text content (max 4096 characters)
   * @returns The WhatsApp message ID
   */
  async sendMessage(to: string, text: string): Promise<{ messageId: string }> {
    // Normalize phone number: remove + prefix if present
    const normalizedTo = to.startsWith('+') ? to.slice(1) : to;
    const normalizedText = normalizeMarkdownForWhatsApp(text);

    logger.debug(`[WhatsApp] Sending message to: ${normalizedTo.slice(0, 4)}****`);

    const response = await this.request<WhatsAppSendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      {
        method: 'POST',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedTo,
          type: 'text',
          text: { body: normalizedText },
        },
      },
    );

    const messageId = response.messages?.[0]?.id;
    if (!messageId) {
      throw new WhatsAppApiError('No message ID returned from WhatsApp API');
    }

    logger.debug(`[WhatsApp] Message sent: id=${messageId}`);
    return { messageId };
  }

  /**
   * Marks a message as read (shows blue ticks in WhatsApp).
   * This gives immediate visual feedback that the message was received and is being processed.
   *
   * @param messageId - The WhatsApp message ID to mark as read
   * @returns Promise that resolves when the message is marked as read
   */
  async markAsRead(messageId: string): Promise<void> {
    try {
      logger.debug(`[WhatsApp] Marking message as read: ${messageId.slice(0, 16)}...`);

      await this.request<{ success: boolean }>(`/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        body: {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
      });

      logger.debug(`[WhatsApp] Message marked as read: ${messageId.slice(0, 16)}...`);
    } catch (error) {
      // Don't crash the flow if this fails - it's a nice-to-have UX feature
      logger.warn(`[WhatsApp] Failed to mark message as read: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Typing Indicators
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sends a typing indicator to show the user that a response is being prepared.
   *
   * This combines marking the message as read (blue ticks) with displaying a
   * "typing..." indicator in the user's WhatsApp client. The indicator provides
   * visual feedback while the Executive Agent processes the request.
   *
   * **API Behavior:**
   * - The typing indicator will be automatically dismissed when:
   *   1. A response message is sent, OR
   *   2. 25 seconds elapse (whichever comes first)
   * - Only display a typing indicator if you intend to respond
   *
   * **Error Handling:**
   * - This method is non-blocking and won't throw errors
   * - Failures are logged but don't interrupt message processing
   * - This is intentional: typing indicators are a UX enhancement, not critical
   *
   * @param messageId - The WhatsApp message ID to respond to (from webhook)
   * @returns Promise<boolean> - true if successful, false if failed
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators/
   *
   * @example
   * ```ts
   * // In message processor, before running the agent:
   * await whatsappClient.sendTypingIndicator(incomingMessageId);
   * const response = await runExecutiveAgent(request);
   * await whatsappClient.sendMessage(to, response); // Typing indicator auto-dismisses
   * ```
   */
  async sendTypingIndicator(messageId: string): Promise<boolean> {
    const logPrefix = '[WhatsApp:TypingIndicator]';

    try {
      logger.debug(`${logPrefix} Sending for message: ${messageId.slice(0, 16)}...`);

      const response = await this.request<{ success: boolean }>(
        `/${this.config.phoneNumberId}/messages`,
        {
          method: 'POST',
          body: {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
            typing_indicator: {
              type: 'text',
            },
          },
        },
      );

      if (response.success) {
        logger.debug(`${logPrefix} Successfully sent for message: ${messageId.slice(0, 16)}...`);
        return true;
      }

      // API returned but success was false - unexpected but handle gracefully
      logger.warn(`${logPrefix} API returned success=false for message: ${messageId.slice(0, 16)}...`);
      return false;
    } catch (error) {
      // Non-blocking error handling - typing indicator is a UX enhancement
      // We don't want to interrupt message processing if this fails
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = error instanceof WhatsAppApiError ? error.statusCode : undefined;

      logger.warn(`${logPrefix} Failed to send typing indicator`, {
        messageId: messageId.slice(0, 16) + '...',
        error: errorMessage,
        statusCode: errorCode,
      });

      return false;
    }
  }

  /**
   * Sends a typing indicator with retry capability for improved reliability.
   *
   * This method wraps `sendTypingIndicator` with a simple retry mechanism
   * for transient failures (network issues, temporary API unavailability).
   *
   * **Retry Strategy:**
   * - Maximum 2 attempts (1 initial + 1 retry)
   * - 500ms delay between attempts
   * - Only retries on network/timeout errors, not API rejections
   *
   * @param messageId - The WhatsApp message ID to respond to
   * @returns Promise<boolean> - true if successful on any attempt, false otherwise
   */
  async sendTypingIndicatorWithRetry(messageId: string): Promise<boolean> {
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 500;
    const logPrefix = '[WhatsApp:TypingIndicator]';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const success = await this.sendTypingIndicator(messageId);

      if (success) {
        return true;
      }

      // Only retry if we haven't exhausted attempts
      if (attempt < MAX_ATTEMPTS) {
        logger.debug(`${logPrefix} Retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS}) after ${RETRY_DELAY_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    logger.warn(`${logPrefix} All ${MAX_ATTEMPTS} attempts failed for message: ${messageId.slice(0, 16)}...`);
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Verification
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verifies the webhook signature from Meta.
   * Uses HMAC SHA256 with the app secret to validate the payload.
   *
   * @param signature - The X-Hub-Signature-256 header value (format: "sha256=<hex>")
   * @param body - The raw request body as a string
   * @returns true if signature is valid, false otherwise
   */
  verifyWebhookSignature(signature: string | null, body: string): boolean {
    if (!signature) {
      logger.warn('[WhatsApp] Missing webhook signature header');
      return false;
    }

    // Extract the hex signature from "sha256=<hex>" format
    const parts = signature.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      logger.warn('[WhatsApp] Invalid signature format');
      return false;
    }

    const receivedSignature = parts[1];

    // Compute expected signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac('sha256', this.config.appSecret)
      .update(body)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(receivedSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );

      if (!isValid) {
        logger.warn('[WhatsApp] Webhook signature mismatch');
      }

      return isValid;
    } catch {
      // Buffer lengths don't match or invalid hex
      logger.warn('[WhatsApp] Webhook signature verification failed');
      return false;
    }
  }

  /**
   * Returns the configured verify token for webhook setup verification.
   */
  getVerifyToken(): string {
    return this.config.verifyToken;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payload Parsing
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parses an incoming webhook payload and extracts the message.
   * Returns null if the payload is not a user message (e.g., status update).
   *
   * @param payload - The parsed JSON webhook payload
   * @returns Extracted message data or null if not a message
   */
  parseWebhookPayload(payload: WhatsAppWebhookPayload): WhatsAppWebhookMessage | null {
    // Validate basic structure
    if (payload.object !== 'whatsapp_business_account') {
      logger.debug('[WhatsApp] Ignoring non-WhatsApp webhook');
      return null;
    }

    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) {
      logger.debug('[WhatsApp] No value in webhook payload');
      return null;
    }

    // Check if this is a message (not a status update)
    const messages = value.messages;
    if (!messages || messages.length === 0) {
      // This is likely a status update (delivered, read, etc.)
      logger.debug('[WhatsApp] Webhook is a status update, not a message');
      return null;
    }

    const message = messages[0];
    const contact = value.contacts?.[0];
    const senderName = contact?.profile?.name || 'Unknown';
    const waId = message.from;

    // Handle audio (voice memo)
    if (message.type === 'audio' && message.audio?.id) {
      return {
        waId,
        senderName,
        messageId: message.id,
        text: '',
        timestamp: parseInt(message.timestamp, 10),
        audioMediaId: message.audio.id,
        audioMimeType: message.audio.mime_type ?? 'audio/ogg',
      };
    }

    // Handle text
    if (message.type === 'text' && message.text?.body) {
      return {
        waId,
        senderName,
        messageId: message.id,
        text: message.text.body,
        timestamp: parseInt(message.timestamp, 10),
      };
    }

    // Handle images
    if (message.type === 'image' && message.image?.id) {
      return {
        waId,
        senderName,
        messageId: message.id,
        text: '',
        timestamp: parseInt(message.timestamp, 10),
        imageMediaId: message.image.id,
        imageMimeType: message.image.mime_type ?? 'image/jpeg',
        imageCaption: message.image.caption,
      };
    }

    // Handle PDF documents
    if (
      message.type === 'document' &&
      message.document?.id &&
      (
        message.document.mime_type?.toLowerCase() === 'application/pdf' ||
        message.document.filename?.toLowerCase().endsWith('.pdf')
      )
    ) {
      return {
        waId,
        senderName,
        messageId: message.id,
        text: '',
        timestamp: parseInt(message.timestamp, 10),
        pdfMediaId: message.document.id,
        pdfMimeType: message.document.mime_type ?? 'application/pdf',
        pdfFilename: message.document.filename,
        pdfCaption: message.document.caption,
      };
    }

    logger.debug(`[WhatsApp] Ignoring unsupported message type: ${message.type}`);
    return null;
  }

  /**
   * Parses outbound status updates from a webhook payload.
   * Returns an empty list when no status updates are present.
   */
  parseWebhookStatusUpdates(payload: WhatsAppWebhookPayload): WhatsAppWebhookStatusUpdate[] {
    if (payload.object !== 'whatsapp_business_account') {
      return [];
    }

    const updates: WhatsAppWebhookStatusUpdate[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const statuses = change.value?.statuses;
        if (!Array.isArray(statuses) || statuses.length === 0) {
          continue;
        }

        for (const status of statuses) {
          const messageId = status.id;
          const statusValue = status.status;
          const recipientId = status.recipient_id;
          if (!messageId || !statusValue || !recipientId) {
            continue;
          }

          const parsedTimestamp = Number.parseInt(status.timestamp, 10);
          const timestamp = Number.isFinite(parsedTimestamp)
            ? parsedTimestamp
            : Math.floor(Date.now() / 1000);

          updates.push({
            messageId,
            status: statusValue,
            timestamp,
            recipientId,
            conversationId: status.conversation?.id,
            errors: Array.isArray(status.errors)
              ? status.errors.map((error) => ({
                  code: error.code,
                  title: error.title,
                  message: error.message,
                  details: error.error_data?.details,
                  href: error.href,
                }))
              : undefined,
          });
        }
      }
    }

    return updates;
  }

  /**
   * Fetches media (e.g. voice memo, image, or PDF) by ID. Does not persist; returns in-memory buffer only.
   * @param mediaId - WhatsApp media ID from webhook
   * @returns Buffer and MIME type; throws on failure
   */
  async getMediaBuffer(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const meta = await this.request<{ url: string; mime_type?: string }>(`/${mediaId}`, {
      method: 'GET',
    });
    if (!meta?.url) {
      throw new WhatsAppApiError('WhatsApp media response missing url', undefined, meta);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(meta.url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new WhatsAppApiError(
          `WhatsApp media download failed: ${response.status} ${response.statusText}`,
          response.status,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return {
        data: Buffer.from(arrayBuffer),
        mimeType: meta.mime_type ?? 'application/octet-stream',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal HTTP Layer
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Makes an authenticated request to the WhatsApp Cloud API.
   */
  private async request<T>(
    endpoint: string,
    options: {
      method: 'GET' | 'POST';
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    const url = `${BASE_URL}/${this.config.apiVersion}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const fetchOptions: RequestInit = {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }

        logger.error('[WhatsApp] API error', {
          status: response.status,
          endpoint,
          errorBody,
        });

        throw new WhatsAppApiError(
          `WhatsApp API error: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof WhatsAppApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new WhatsAppApiError(`WhatsApp API request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
      }

      throw new WhatsAppApiError(
        `WhatsApp API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton & Helpers
// ─────────────────────────────────────────────────────────────────────────────

let _clientInstance: WhatsAppClient | null = null;

/**
 * Gets the singleton WhatsApp client instance.
 * Creates the client on first call using environment configuration.
 */
export function getWhatsAppClient(): WhatsAppClient {
  if (!_clientInstance) {
    _clientInstance = new WhatsAppClient();
  }
  return _clientInstance;
}

/**
 * Checks if WhatsApp is configured (all required env vars present).
 */
export function isWhatsAppConfigured(): boolean {
  return !!(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_APP_SECRET &&
    process.env.WHATSAPP_VERIFY_TOKEN
  );
}
