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
  TELEGRAM_POLLER_WORKER_KEY,
  createTelegramConfig,
  startTelegramMonitor,
  stopTelegramMonitor,
  type TelegramClientConfig,
  type TelegramSendMessageResponse,
  type TelegramInboundMessage,
  type TelegramPollerStateSnapshot,
} from './telegramClient';

export {
  TELEGRAM_WORKER_HEARTBEAT_KEY,
  TELEGRAM_WORKER_HEARTBEAT_TTL_SECONDS,
  writeTelegramWorkerHeartbeat,
  readTelegramWorkerHeartbeat,
} from './workerHeartbeat';

export {
  getTelegramHealthSnapshot,
  type TelegramHealthSnapshot,
} from './health';

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
