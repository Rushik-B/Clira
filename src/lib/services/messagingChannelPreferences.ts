import type { NotificationDeliveryChannel } from '@prisma/client';

export type MessagingChannel = 'whatsapp' | 'telegram';

export function normalizeNotificationDeliveryChannel(
  value: NotificationDeliveryChannel | null | undefined,
): NotificationDeliveryChannel {
  return value ?? 'BOTH';
}

export function allowsMessagingChannel(
  preference: NotificationDeliveryChannel | null | undefined,
  channel: MessagingChannel,
): boolean {
  const normalized = normalizeNotificationDeliveryChannel(preference);

  if (normalized === 'BOTH') {
    return true;
  }

  if (normalized === 'WHATSAPP') {
    return channel === 'whatsapp';
  }

  return channel === 'telegram';
}
