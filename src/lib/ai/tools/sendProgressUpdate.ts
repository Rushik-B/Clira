import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  progressUpdateKinds,
  type ProgressUpdateChannel,
  type ProgressUpdateEvent,
  type ProgressUpdateKind,
} from '@/lib/ai/progressTypes';

export type ProgressUpdateMetadata = {
  type: 'progress';
  kind: ProgressUpdateKind;
  sequence: number;
  requestId: string;
  channel: ProgressUpdateChannel;
};

export type ProgressUpdateContext = {
  channel: ProgressUpdateChannel;
  requestId: string;
  conversationId: string;
  canEmitProgress?: () => boolean;
  sendMessage?: (text: string) => Promise<{ externalId?: string }>;
  persistMessage: (params: {
    content: string;
    metadata: ProgressUpdateMetadata;
    externalId?: string;
  }) => Promise<void>;
  emitWebProgress?: (update: ProgressUpdateEvent) => Promise<void> | void;
};

export type SendProgressUpdateResult = {
  sent: boolean;
  persisted: boolean;
  droppedReason?:
    | 'quota'
    | 'rate_limit'
    | 'duplicate'
    | 'invalid'
    | 'no_channel'
    | 'unstable_burst'
    | 'error';
  error?: string;
  sequence?: number;
  requestId: string;
  channel: ProgressUpdateChannel;
};

type ProgressUpdateLimits = {
  baseMaxPerRequest?: number;
  longTaskAfterMs?: number;
  minIntervalMs?: number;
  maxTextLength?: number;
};

export function createSendProgressUpdateTool(
  context: ProgressUpdateContext,
  limits?: ProgressUpdateLimits,
) {
  const createdAt = Date.now();
  const seenTexts = new Set<string>();
  let sentCount = 0;
  let lastSentAt = 0;

  const baseMaxPerRequest = limits?.baseMaxPerRequest ?? 2;
  const longTaskAfterMs = limits?.longTaskAfterMs ?? 6000;
  const minIntervalMs = limits?.minIntervalMs ?? 1500;
  const maxTextLength = limits?.maxTextLength ?? 200;

  const inputSchema = z.object({
    kind: z.enum(progressUpdateKinds).describe('Progress update category'),
    text: z
      .string()
      .min(1)
      .max(maxTextLength)
      .describe('Short, one-sentence update in Clira voice'),
  });

  const shouldAllowExtra = () => Date.now() - createdAt >= longTaskAfterMs;

  const buildResult = (overrides: Partial<SendProgressUpdateResult>): SendProgressUpdateResult => ({
    sent: false,
    persisted: false,
    requestId: context.requestId,
    channel: context.channel,
    ...overrides,
  });

  return {
    description:
      'Send a short, human progress update to the user. ' +
      'Use for quick acknowledgments, deep-search updates, or long-running tasks. ' +
      'Keep it to one sentence and never mention tool names.',
    inputSchema,
    execute: async (args: z.infer<typeof inputSchema>): Promise<SendProgressUpdateResult> => {
      const text = args.text.trim();
      if (!text) {
        return buildResult({ droppedReason: 'invalid' });
      }

      const normalizedText = text.toLowerCase();
      const maxPerRequest = baseMaxPerRequest + (shouldAllowExtra() ? 1 : 0);

      if (sentCount >= maxPerRequest) {
        return buildResult({ droppedReason: 'quota' });
      }

      const now = Date.now();
      if (lastSentAt && now - lastSentAt < minIntervalMs) {
        return buildResult({ droppedReason: 'rate_limit' });
      }

      if (seenTexts.has(normalizedText)) {
        return buildResult({ droppedReason: 'duplicate' });
      }

      if (!context.sendMessage && !context.emitWebProgress) {
        return buildResult({ droppedReason: 'no_channel' });
      }

      if (context.canEmitProgress && !context.canEmitProgress()) {
        return buildResult({ droppedReason: 'unstable_burst' });
      }

      const sequence = sentCount + 1;
      const progressId = `${context.requestId}-${sequence}`;
      const metadata: ProgressUpdateMetadata = {
        type: 'progress',
        kind: args.kind,
        sequence,
        requestId: context.requestId,
        channel: context.channel,
      };

      const event: ProgressUpdateEvent = {
        id: progressId,
        text,
        kind: args.kind,
        sequence,
        requestId: context.requestId,
        channel: context.channel,
      };

      try {
        let externalId: string | undefined;

        if (context.sendMessage) {
          const result = await context.sendMessage(text);
          externalId = result?.externalId;
        }

        if (context.emitWebProgress) {
          await context.emitWebProgress(event);
        }

        sentCount += 1;
        lastSentAt = now;
        seenTexts.add(normalizedText);

        try {
          await context.persistMessage({ content: text, metadata, externalId });
          return buildResult({ sent: true, persisted: true, sequence });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`[sendProgressUpdate] Persist failed: ${message}`);
          return buildResult({
            sent: true,
            persisted: false,
            sequence,
            droppedReason: 'error',
            error: message,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[sendProgressUpdate] Delivery failed: ${message}`);
        return buildResult({ droppedReason: 'error', error: message });
      }
    },
  };
}
