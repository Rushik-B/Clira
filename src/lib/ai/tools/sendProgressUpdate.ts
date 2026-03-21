import { z } from 'zod';
import {
  progressUpdateKinds,
  type ProgressUpdateEvent,
  type ProgressUpdateChannel,
  type ProgressUpdateKind,
} from '@/lib/ai/progressTypes';
import { ProgressEmitter } from '@/lib/ai/progressEmitter';

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

export const sendProgressUpdateDescription =
  'Send a short, human progress update only when the user would otherwise be left waiting. ' +
  'Automatic wait notes may already be sent for long-running work, so use this only when you have genuinely helpful extra context. ' +
  'Do not use it just to narrate another lookup. Keep it to one sentence and never mention tool names.';

export const sendProgressUpdateInputSchema = z.object({
  kind: z.enum(progressUpdateKinds).describe('Progress update category'),
  text: z
    .string()
    .min(1)
    .max(200)
    .describe('Short, one-sentence update in natural Clira voice, only when the wait is noticeable'),
});

function buildSendProgressUpdateTool(params: {
  execute: (
    args: z.infer<typeof sendProgressUpdateInputSchema>,
  ) => Promise<SendProgressUpdateResult>;
}) {
  return {
    description: sendProgressUpdateDescription,
    inputSchema: sendProgressUpdateInputSchema,
    execute: params.execute,
  };
}

export function createSendProgressUpdateToolFromEmitter(
  emitter: ProgressEmitter,
  channel: ProgressUpdateChannel,
  requestId: string,
) {
  return buildSendProgressUpdateTool({
    execute: async (
      args: z.infer<typeof sendProgressUpdateInputSchema>,
    ): Promise<SendProgressUpdateResult> => {
      const result = await emitter.emit({
        text: args.text,
        kind: args.kind,
        source: 'model',
      });
      const droppedReason =
        result.droppedReason === 'harness_delay' ||
        result.droppedReason === 'insufficient_tool_calls'
          ? undefined
          : result.droppedReason;

      return {
        ...result,
        channel,
        requestId,
        droppedReason,
      };
    },
  });
}

export function createSendProgressUpdateTool(
  context: ProgressUpdateContext,
  limits?: ProgressUpdateLimits,
) {
  const baseMaxPerRequest = limits?.baseMaxPerRequest ?? 2;
  const longTaskAfterMs = limits?.longTaskAfterMs ?? 45_000;
  const minIntervalMs = limits?.minIntervalMs ?? 12_000;
  const maxTextLength = limits?.maxTextLength ?? 200;
  const emitter = new ProgressEmitter(context, {
    maxEmissions: baseMaxPerRequest,
    minIntervalMs,
    longTaskBonusAfterMs: longTaskAfterMs,
    maxTextLength,
  });

  return createSendProgressUpdateToolFromEmitter(
    emitter,
    context.channel,
    context.requestId,
  );
}
