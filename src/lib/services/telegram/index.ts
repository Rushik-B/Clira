/**
 * Telegram Service Module
 *
 * Exports Telegram client, pairing manager, conversation manager, and processor.
 */

export {
  TelegramClient,
  getTelegramClient,
  isTelegramConfigured,
  isTelegramEnabled,
  createTelegramConfig,
  startTelegramMonitor,
  stopTelegramMonitor,
  type TelegramClientConfig,
  type TelegramSendMessageResponse,
  type TelegramInboundMessage,
  type TelegramPollerStateSnapshot,
} from './telegramClient';

export {
  ConversationManager,
  getConversationManager,
  type AddMessageParams,
  type ConversationWithMessages,
} from './conversationManager';

export {
  PairingManager,
  PairingCodeError,
  getPairingManager,
  type PairingRequestInput,
} from './pairingManager';

export {
  processTelegramMessage,
  type ProcessMessageResult,
} from './messageProcessor';
