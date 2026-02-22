export interface TextingSettings {
  whatsappPhoneNumber: string | null;
  whatsappVerified: boolean;
  twilioPhoneNumber: string | null;
  twilioVerified: boolean;
}

export type NotificationDeliveryChannel = 'WHATSAPP' | 'TELEGRAM' | 'BOTH';

export interface TelegramLinkSettings {
  id: string;
  telegramUserId: string;
  chatId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  linkedAt: string;
  lastSeenAt: string | null;
  updatedAt?: string;
}

export interface TelegramHealthState {
  configured: boolean;
  enabled: boolean;
  workerConnected: boolean;
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  lastUpdateId: number | null;
  lastUpdateAt: string | null;
}

export interface TelegramPendingPairingRequest {
  id: string;
  pairingCode: string;
  telegramUserId: string;
  chatId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface TelegramSettingsState {
  telegramConfigured: boolean;
  telegramEnabled: boolean;
  botUsername: string | null;
  links: TelegramLinkSettings[];
  pendingPairingRequests: TelegramPendingPairingRequest[];
  health: TelegramHealthState | null;
}

export interface CountryOption {
  code: string;
  name: string;
  dialCode: string;
}
