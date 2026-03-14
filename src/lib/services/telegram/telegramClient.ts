/**
 * Telegram client + long-polling monitor.
 *
 * Uses grammY for Bot API access and @grammyjs/runner sequentialize middleware
 * to process updates per chat without race conditions.
 */

import { Bot, Context, GrammyError, HttpError } from 'grammy';
import { sequentialize } from '@grammyjs/runner';
import type { UserFromGetMe } from '@grammyjs/types/manage';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { normalizeMarkdownForTelegram } from './messageFormatting';

const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_POLL_RETRY_MAX_MS = 15_000;
const TELEGRAM_FILE_FETCH_TIMEOUT_MS = 30_000;
export const TELEGRAM_POLLER_WORKER_KEY = 'telegram-worker-main';

export interface TelegramClientConfig {
  botToken: string;
  enabled: boolean;
  pollTimeoutSeconds: number;
  pollRetryMaxMs: number;
}

export interface TelegramSendMessageResponse {
  messageId: string;
}

export interface TelegramInboundMessage {
  updateId: number;
  messageId: string;
  chatId: string;
  telegramUserId: string;
  telegramUsername?: string;
  senderName: string;
  text: string;
  timestamp: number;
  voiceFileId?: string;
  voiceMimeType?: string;
  imageFileId?: string;
  imageMimeType?: string;
  imageCaption?: string;
  pdfFileId?: string;
  pdfMimeType?: string;
  pdfFilename?: string;
  pdfCaption?: string;
  replyContext?: TelegramReplyContext;
}

export interface TelegramReplyContext {
  messageId: string;
  senderName?: string;
  text?: string;
  quote?: string;
  isBot?: boolean;
}

export interface TelegramPollerStateSnapshot {
  workerKey: string;
  lastUpdateId: number;
  updatedAt: Date;
}

type TelegramMonitorOptions = {
  onMessage: (message: TelegramInboundMessage) => Promise<void>;
};

function toBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return defaultValue;
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export function isTelegramEnabled(): boolean {
  const tokenPresent = isTelegramConfigured();
  if (!tokenPresent) return false;
  return toBooleanEnv(process.env.TELEGRAM_ENABLED, true);
}

export function createTelegramConfig(): TelegramClientConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }

  return {
    botToken,
    enabled: isTelegramEnabled(),
    pollTimeoutSeconds: toPositiveNumber(
      process.env.TELEGRAM_POLL_TIMEOUT_SECONDS,
      DEFAULT_POLL_TIMEOUT_SECONDS,
    ),
    pollRetryMaxMs: toPositiveNumber(process.env.TELEGRAM_POLL_RETRY_MAX_MS, DEFAULT_POLL_RETRY_MAX_MS),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSenderName(ctx: Context): string {
  const first = ctx.from?.first_name?.trim() ?? '';
  const last = ctx.from?.last_name?.trim() ?? '';
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (ctx.from?.username) return `@${ctx.from.username}`;
  return 'Unknown';
}

function buildSenderNameFromUserLike(
  user: { first_name?: string; last_name?: string; username?: string } | null | undefined,
): string | undefined {
  if (!user) return undefined;
  const first = user.first_name?.trim() ?? '';
  const last = user.last_name?.trim() ?? '';
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (user.username) return `@${user.username}`;
  return undefined;
}

function extractReplyContext(message: Record<string, unknown>): TelegramReplyContext | undefined {
  const replyToMessage = message.reply_to_message as Record<string, unknown> | undefined;
  if (!replyToMessage) return undefined;

  const replyMessageId = replyToMessage.message_id;
  if (replyMessageId == null) return undefined;

  const replyText = typeof replyToMessage.text === 'string' && replyToMessage.text.trim().length > 0
    ? replyToMessage.text
    : typeof replyToMessage.caption === 'string' && replyToMessage.caption.trim().length > 0
      ? replyToMessage.caption
      : undefined;
  const replyFrom = replyToMessage.from as {
    first_name?: string;
    last_name?: string;
    username?: string;
    is_bot?: boolean;
  } | undefined;
  const quote = (message.quote as { text?: string } | undefined)?.text;

  return {
    messageId: String(replyMessageId),
    senderName: buildSenderNameFromUserLike(replyFrom),
    text: replyText,
    quote: typeof quote === 'string' && quote.trim().length > 0 ? quote : undefined,
    isBot: replyFrom?.is_bot === true,
  };
}

function toTelegramChatId(chatId: string): string {
  return chatId;
}

export function extractTelegramInboundMessage(ctx: Context): TelegramInboundMessage | null {
  const updateId = ctx.update.update_id;
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message as Record<string, unknown> | undefined;

  if (!message || !from || !chat) return null;
  if (chat.type !== 'private') return null;

  const timestamp = typeof message.date === 'number' ? message.date : Math.floor(Date.now() / 1000);
  const base: TelegramInboundMessage = {
    updateId,
    messageId: String(message.message_id ?? ''),
    chatId: String(chat.id),
    telegramUserId: String(from.id),
    telegramUsername: from.username ?? undefined,
    senderName: buildSenderName(ctx),
    text: '',
    timestamp,
    replyContext: extractReplyContext(message),
  };

  if (typeof message.text === 'string' && message.text.trim().length > 0) {
    return {
      ...base,
      text: message.text,
    };
  }

  const voice = message.voice as { file_id?: string; mime_type?: string } | undefined;
  if (voice?.file_id) {
    return {
      ...base,
      text: '',
      voiceFileId: voice.file_id,
      voiceMimeType: voice.mime_type ?? 'audio/ogg',
    };
  }

  const photo = message.photo as Array<{ file_id?: string; mime_type?: string }> | undefined;
  if (Array.isArray(photo) && photo.length > 0) {
    const largest = photo[photo.length - 1];
    if (largest?.file_id) {
      return {
        ...base,
        text: '',
        imageFileId: largest.file_id,
        imageMimeType: largest.mime_type ?? 'image/jpeg',
        imageCaption: typeof message.caption === 'string' ? message.caption : undefined,
      };
    }
  }

  const document = message.document as {
    file_id?: string;
    mime_type?: string;
    file_name?: string;
  } | undefined;
  const documentMimeType = document?.mime_type?.toLowerCase();
  const documentFilename = document?.file_name;
  const isPdfDocument = documentMimeType === 'application/pdf'
    || documentFilename?.toLowerCase().endsWith('.pdf') === true;
  if (document?.file_id && isPdfDocument) {
    return {
      ...base,
      text: '',
      pdfFileId: document.file_id,
      pdfMimeType: document.mime_type ?? 'application/pdf',
      pdfFilename: document.file_name,
      pdfCaption: typeof message.caption === 'string' ? message.caption : undefined,
    };
  }

  return null;
}

export class TelegramClient {
  private readonly config: TelegramClientConfig;
  private readonly bot: Bot;
  private botIdentity: UserFromGetMe | null = null;
  private botInitialized = false;
  private botInitPromise: Promise<void> | null = null;
  private monitorRunning = false;
  private monitorLoop: Promise<void> | null = null;
  private onMessageHandler: ((message: TelegramInboundMessage) => Promise<void>) | null = null;
  private currentOffset = 0;

  constructor(config?: Partial<TelegramClientConfig>) {
    const envConfig = createTelegramConfig();
    this.config = { ...envConfig, ...config };
    this.bot = new Bot(this.config.botToken);

    // Process updates sequentially per chat to avoid cross-message races.
    this.bot.use(
      sequentialize((ctx) => {
        const chatId = ctx.chat?.id;
        return chatId ? `chat:${chatId}` : 'chat:unknown';
      }),
    );

    this.bot.on('message', async (ctx) => {
      if (!this.onMessageHandler) return;
      const inbound = extractTelegramInboundMessage(ctx);
      if (!inbound) return;
      await this.onMessageHandler(inbound);
    });

    this.bot.catch((error) => {
      const ctx = error.ctx;
      if (error.error instanceof GrammyError) {
        logger.error('[Telegram] grammY error', {
          updateId: ctx?.update?.update_id,
          message: error.error.description,
        });
      } else if (error.error instanceof HttpError) {
        logger.error('[Telegram] HTTP error', {
          updateId: ctx?.update?.update_id,
          message: error.error.message,
        });
      } else {
        logger.error('[Telegram] Unknown bot error', {
          updateId: ctx?.update?.update_id,
          error: error.error instanceof Error ? error.error.message : String(error.error),
        });
      }
    });
  }

  private async ensureBotInitialized(): Promise<void> {
    if (this.botInitialized) return;
    if (!this.botInitPromise) {
      this.botInitPromise = (async () => {
        await this.bot.init();
        this.botIdentity = this.bot.botInfo;
        this.botInitialized = true;
      })()
        .catch((error) => {
          this.botInitPromise = null;
          throw error;
        });
    }
    await this.botInitPromise;
  }

  async getBotIdentity(): Promise<UserFromGetMe | null> {
    if (this.botIdentity) return this.botIdentity;
    try {
      await this.ensureBotInitialized();
      this.botIdentity = this.bot.botInfo;
      return this.botIdentity;
    } catch (error) {
      logger.warn('[Telegram] Failed to fetch bot identity', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  startTypingIndicator(chatId: string): () => void {
    const fire = () => {
      this.bot.api.sendChatAction(toTelegramChatId(chatId), 'typing').catch(() => {
        // Best-effort; indicator auto-expires after 5s anyway.
      });
    };
    fire();
    const interval = setInterval(fire, 4_000);
    return () => clearInterval(interval);
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramSendMessageResponse> {
    const normalizedText = normalizeMarkdownForTelegram(text);
    const sent = await this.bot.api.sendMessage(toTelegramChatId(chatId), normalizedText, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    return { messageId: String(sent.message_id) };
  }

  async getFileBuffer(fileId: string): Promise<{ data: Buffer; mimeType: string }> {
    const fileMeta = await this.bot.api.getFile(fileId);
    if (!fileMeta.file_path) {
      throw new Error('Telegram file path missing in getFile response');
    }

    const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${fileMeta.file_path}`;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort('telegram_file_download_timeout');
    }, TELEGRAM_FILE_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(fileUrl, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
      }

      const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
      const data = Buffer.from(await response.arrayBuffer());
      return { data, mimeType };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Telegram file download timed out after ${TELEGRAM_FILE_FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async startMonitor(options: TelegramMonitorOptions): Promise<void> {
    if (!this.config.enabled) {
      logger.info('[Telegram] Monitor start skipped - Telegram disabled');
      return;
    }

    if (this.monitorRunning) {
      logger.info('[Telegram] Monitor already running, skipping duplicate start');
      return;
    }

    await this.ensureBotInitialized();
    this.onMessageHandler = options.onMessage;
    const state = await this.getPollerState();
    this.currentOffset = state?.lastUpdateId ?? 0;

    this.monitorRunning = true;
    this.monitorLoop = this.pollLoop();

    logger.info('[Telegram] Long-polling monitor started', {
      offset: this.currentOffset,
      timeoutSeconds: this.config.pollTimeoutSeconds,
      retryMaxMs: this.config.pollRetryMaxMs,
    });
  }

  async stopMonitor(): Promise<void> {
    if (!this.monitorRunning) return;
    this.monitorRunning = false;

    try {
      await this.monitorLoop;
    } finally {
      this.monitorLoop = null;
      this.onMessageHandler = null;
    }

    logger.info('[Telegram] Long-polling monitor stopped');
  }

  isMonitorRunning(): boolean {
    return this.monitorRunning;
  }

  async getPollerState(): Promise<TelegramPollerStateSnapshot | null> {
    const state = await prisma.telegramPollerState.findUnique({
      where: { workerKey: TELEGRAM_POLLER_WORKER_KEY },
      select: {
        workerKey: true,
        lastUpdateId: true,
        updatedAt: true,
      },
    });

    if (!state) return null;
    return {
      workerKey: state.workerKey,
      lastUpdateId: state.lastUpdateId,
      updatedAt: state.updatedAt,
    };
  }

  private async persistPollOffset(lastUpdateId: number): Promise<void> {
    await prisma.telegramPollerState.upsert({
      where: { workerKey: TELEGRAM_POLLER_WORKER_KEY },
      update: { lastUpdateId },
      create: {
        workerKey: TELEGRAM_POLLER_WORKER_KEY,
        lastUpdateId,
      },
    });
  }

  private async pollLoop(): Promise<void> {
    let retryDelayMs = 500;

    while (this.monitorRunning) {
      try {
        const updates = await this.bot.api.getUpdates({
          offset: this.currentOffset + 1,
          timeout: this.config.pollTimeoutSeconds,
          allowed_updates: ['message'],
        });

        retryDelayMs = 500;
        if (!updates || updates.length === 0) {
          continue;
        }

        for (const update of updates) {
          if (!this.monitorRunning) break;
          await this.bot.handleUpdate(update);

          if (update.update_id > this.currentOffset) {
            this.currentOffset = update.update_id;
            await this.persistPollOffset(this.currentOffset);
          }
        }
      } catch (error) {
        if (!this.monitorRunning) break;

        const waitMs = Math.min(retryDelayMs, this.config.pollRetryMaxMs);
        logger.warn('[Telegram] Poll loop error, retrying', {
          waitMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(waitMs);
        retryDelayMs = Math.min(waitMs * 2, this.config.pollRetryMaxMs);
      }
    }
  }
}

let _telegramClientInstance: TelegramClient | null = null;

export function getTelegramClient(): TelegramClient {
  if (!_telegramClientInstance) {
    _telegramClientInstance = new TelegramClient();
  }
  return _telegramClientInstance;
}

export async function startTelegramMonitor(options: TelegramMonitorOptions): Promise<void> {
  const client = getTelegramClient();
  await client.startMonitor(options);
}

export async function stopTelegramMonitor(): Promise<void> {
  const client = getTelegramClient();
  await client.stopMonitor();
}
