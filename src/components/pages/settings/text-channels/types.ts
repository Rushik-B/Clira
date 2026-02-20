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

export interface TelegramSettingsState {
  telegramConfigured: boolean;
  telegramEnabled: boolean;
  botUsername: string | null;
  links: TelegramLinkSettings[];
}

export interface CountryOption {
  code: string;
  name: string;
  dialCode: string;
}
