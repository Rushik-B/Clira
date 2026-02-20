/**
 * WhatsApp Service Module
 *
 * Exports all WhatsApp-related services for the Executive Agent feature.
 */

// Client
export {
  WhatsAppClient,
  getWhatsAppClient,
  isWhatsAppConfigured,
  createWhatsAppConfig,
  WhatsAppApiError,
  type WhatsAppClientConfig,
  type WhatsAppSendMessageResponse,
  type WhatsAppWebhookMessage,
  type WhatsAppWebhookPayload,
  type WhatsAppWebhookStatusUpdate,
} from './whatsappClient';

// Conversation Manager
export {
  ConversationManager,
  getConversationManager,
  type EmailDraft,
  type AddMessageParams,
  type ConversationWithMessages,
  type OutboundMessageStatusUpdate,
  type OutboundMessageStatusRecord,
} from './conversationManager';

// Message Processor
export {
  processWhatsAppMessage,
  processWebChatMessage,
  type ProcessMessageResult,
} from './messageProcessor';
