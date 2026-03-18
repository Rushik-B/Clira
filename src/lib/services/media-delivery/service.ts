import { logger } from '@/lib/logger';
import { sanitizeContentReferenceForModel } from '@/lib/services/content-ingestion/referenceModeling';
import { loadContentReferenceAsset } from '@/lib/services/content-ingestion/referenceRuntime';
import type { ContentReference } from '@/lib/services/content-ingestion/types';
import { resolveTelegramDeliveryTargetForUser } from '@/lib/services/messagingDeliveryTargets';
import { getTelegramClient } from '@/lib/services/telegram';

export type MediaDeliveryChannel = 'telegram';

export type DeliverContentReferenceResult =
  | {
      success: true;
      channel: MediaDeliveryChannel;
      deliveryMode: 'document' | 'photo';
      externalMessageId: string;
      message: string;
      filename: string | null;
      mimeType: string | null;
      contentRef: Record<string, unknown>;
    }
  | {
      success: false;
      channel: MediaDeliveryChannel;
      error:
        | 'invalid_content_reference'
        | 'content_reference_not_found'
        | 'unsupported_content_reference'
        | 'delivery_target_unavailable'
        | 'delivery_failed';
      retryable: boolean;
      message: string;
      contentRef?: Record<string, unknown>;
    };

function shouldSendAsTelegramPhoto(mimeType?: string | null): boolean {
  const normalized = mimeType?.trim().toLowerCase() ?? '';
  return (
    normalized === 'image/jpeg' ||
    normalized === 'image/jpg' ||
    normalized === 'image/png' ||
    normalized === 'image/webp'
  );
}

export async function deliverContentReference(params: {
  userId: string;
  reference: ContentReference;
  channel: MediaDeliveryChannel;
  caption?: string | null;
}): Promise<DeliverContentReferenceResult> {
  const asset = await loadContentReferenceAsset({
    userId: params.userId,
    reference: params.reference,
  });

  if (!asset.ok) {
    return {
      success: false,
      channel: params.channel,
      error:
        asset.error === 'invalid_content_reference' ||
        asset.error === 'content_reference_not_found' ||
        asset.error === 'unsupported_content_reference'
          ? asset.error
          : 'unsupported_content_reference',
      retryable: asset.error !== 'invalid_content_reference',
      message: asset.message,
      ...(asset.reference
        ? { contentRef: sanitizeContentReferenceForModel(asset.reference) }
        : {}),
    };
  }

  if (params.channel !== 'telegram') {
    return {
      success: false,
      channel: params.channel,
      error: 'delivery_failed',
      retryable: false,
      message: 'That delivery channel is not supported yet.',
      contentRef: sanitizeContentReferenceForModel(asset.reference),
    };
  }

  const target = await resolveTelegramDeliveryTargetForUser(params.userId);
  if (!target) {
    return {
      success: false,
      channel: 'telegram',
      error: 'delivery_target_unavailable',
      retryable: false,
      message: 'Telegram is not connected for this user right now.',
      contentRef: sanitizeContentReferenceForModel(asset.reference),
    };
  }

  try {
    const telegramClient = getTelegramClient();
    const deliveryMode = shouldSendAsTelegramPhoto(asset.mimeType) ? 'photo' : 'document';
    const sendResult =
      deliveryMode === 'photo'
        ? await telegramClient.sendPhoto(target.chatId, {
            data: asset.bytes,
            filename: asset.filename,
            caption: params.caption,
          })
        : await telegramClient.sendDocument(target.chatId, {
            data: asset.bytes,
            filename: asset.filename,
            caption: params.caption,
          });

    logger.info('[mediaDelivery] delivered content reference', {
      userId: params.userId,
      channel: 'telegram',
      contentRefId: asset.reference.contentRefId,
      chatId: target.chatId,
      deliveryMode,
      mimeType: asset.mimeType,
      filename: asset.filename,
      externalMessageId: sendResult.messageId,
    });

    return {
      success: true,
      channel: 'telegram',
      deliveryMode,
      externalMessageId: sendResult.messageId,
      message:
        deliveryMode === 'photo'
          ? 'Sent the image to Telegram.'
          : 'Sent the file to Telegram.',
      filename: asset.filename,
      mimeType: asset.mimeType,
      contentRef: sanitizeContentReferenceForModel(asset.reference),
    };
  } catch (error) {
    logger.warn('[mediaDelivery] failed to deliver content reference', {
      userId: params.userId,
      channel: 'telegram',
      contentRefId: asset.reference.contentRefId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      channel: 'telegram',
      error: 'delivery_failed',
      retryable: true,
      message: 'I found the file, but Telegram delivery failed.',
      contentRef: sanitizeContentReferenceForModel(asset.reference),
    };
  }
}
