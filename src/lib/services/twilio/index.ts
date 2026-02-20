/**
 * Twilio Service Module
 *
 * Exports all Twilio SMS/RCS-related services for the Executive Agent feature.
 */

// Client
export {
  TwilioClient,
  getTwilioClient,
  isTwilioConfigured,
  createTwilioConfig,
  TwilioApiError,
  type TwilioClientConfig,
  type TwilioSendMessageOptions,
  type TwilioSendMessageResponse,
  type TwilioWebhookMessage,
} from './twilioClient';

// Conversation Manager
export {
  ConversationManager,
  getConversationManager,
  type AddMessageParams,
  type ConversationWithMessages,
} from './conversationManager';

// Message Processor
export {
  processTwilioMessage,
  processWebChatMessage,
  type ProcessMessageResult,
} from './messageProcessor';
