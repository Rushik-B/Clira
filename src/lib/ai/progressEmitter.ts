import { logger } from '@/lib/logger';
import type {
  ProgressUpdateEvent,
  ProgressUpdateKind,
} from '@/lib/ai/progressTypes';
import type {
  ProgressUpdateContext,
  ProgressUpdateMetadata,
  SendProgressUpdateResult,
} from '@/lib/ai/tools/sendProgressUpdate';

export type ProgressEmitterConfig = {
  maxEmissions: number;
  minIntervalMs: number;
  longTaskBonusAfterMs: number;
  maxTextLength: number;
  harnessFirstDelayMs: number;
  harnessMinToolCalls: number;
};

export type ProgressEmitterResult = Omit<SendProgressUpdateResult, 'droppedReason'> & {
  droppedReason?:
    | NonNullable<SendProgressUpdateResult['droppedReason']>
    | 'harness_delay'
    | 'insufficient_tool_calls';
};

type ProgressEmitterSource = 'harness' | 'model';

const DEFAULT_PROGRESS_EMITTER_CONFIG: Required<ProgressEmitterConfig> = {
  maxEmissions: 3,
  minIntervalMs: 5_000,
  longTaskBonusAfterMs: 8_000,
  maxTextLength: 200,
  harnessFirstDelayMs: 4_500,
  harnessMinToolCalls: 1,
};

export class ProgressEmitter {
  private readonly createdAt = Date.now();

  private readonly seenTexts = new Set<string>();

  private sentCount = 0;

  private lastSentAt = 0;

  private toolCallsCompleted = 0;

  private readonly config: Required<ProgressEmitterConfig>;

  constructor(
    private readonly context: ProgressUpdateContext,
    config?: Partial<ProgressEmitterConfig>,
  ) {
    this.config = {
      ...DEFAULT_PROGRESS_EMITTER_CONFIG,
      ...config,
    };
  }

  async emit(params: {
    text: string;
    kind: ProgressUpdateKind;
    source: ProgressEmitterSource;
  }): Promise<ProgressEmitterResult> {
    const text = params.text.trim();
    if (!text || text.length > this.config.maxTextLength) {
      return this.buildResult({ droppedReason: 'invalid' });
    }

    const maxEmissions =
      this.config.maxEmissions +
      (this.elapsedMs() >= this.config.longTaskBonusAfterMs ? 1 : 0);
    if (this.sentCount >= maxEmissions) {
      return this.buildResult({ droppedReason: 'quota' });
    }

    const now = Date.now();
    if (this.lastSentAt && now - this.lastSentAt < this.config.minIntervalMs) {
      return this.buildResult({ droppedReason: 'rate_limit' });
    }

    const normalizedText = text.toLowerCase();
    if (this.seenTexts.has(normalizedText)) {
      return this.buildResult({ droppedReason: 'duplicate' });
    }

    if (!this.context.sendMessage && !this.context.emitWebProgress) {
      return this.buildResult({ droppedReason: 'no_channel' });
    }

    if (this.context.canEmitProgress && !this.context.canEmitProgress()) {
      return this.buildResult({ droppedReason: 'unstable_burst' });
    }

    if (params.source === 'harness') {
      if (this.elapsedMs() < this.config.harnessFirstDelayMs) {
        return this.buildResult({ droppedReason: 'harness_delay' });
      }

      if (
        this.sentCount === 0 &&
        this.toolCallsCompleted < this.config.harnessMinToolCalls
      ) {
        return this.buildResult({ droppedReason: 'insufficient_tool_calls' });
      }
    }

    const sequence = this.sentCount + 1;
    const progressId = `${this.context.requestId}-${sequence}`;
    const metadata: ProgressUpdateMetadata = {
      type: 'progress',
      kind: params.kind,
      sequence,
      requestId: this.context.requestId,
      channel: this.context.channel,
    };
    const event: ProgressUpdateEvent = {
      id: progressId,
      text,
      kind: params.kind,
      sequence,
      requestId: this.context.requestId,
      channel: this.context.channel,
    };

    try {
      let externalId: string | undefined;

      if (this.context.sendMessage) {
        const result = await this.context.sendMessage(text);
        externalId = result?.externalId;
      }

      if (this.context.emitWebProgress) {
        await this.context.emitWebProgress(event);
      }

      this.sentCount += 1;
      this.lastSentAt = now;
      this.seenTexts.add(normalizedText);

      try {
        await this.context.persistMessage({ content: text, metadata, externalId });
        return this.buildResult({
          sent: true,
          persisted: true,
          sequence,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[progressEmitter] Persist failed: ${message}`);
        return this.buildResult({
          sent: true,
          persisted: false,
          sequence,
          droppedReason: 'error',
          error: message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[progressEmitter] Delivery failed: ${message}`);
      return this.buildResult({ droppedReason: 'error', error: message });
    }
  }

  noteToolCallCompleted(toolName: string, result?: unknown): void {
    if (!toolName || toolName === 'send_progress_update') {
      return;
    }

    if (result && typeof result === 'object') {
      const record = result as Record<string, unknown>;
      if (
        record.status === 'deferred' ||
        record.error === 'tool_budget_exceeded' ||
        record.error === 'deadline_exceeded'
      ) {
        return;
      }
    }

    this.toolCallsCompleted += 1;
  }

  getLastSentAt(): number {
    return this.lastSentAt;
  }

  state(): {
    sentCount: number;
    toolCallsCompleted: number;
    elapsedMs: number;
    lastSentAt: number;
  } {
    return {
      sentCount: this.sentCount,
      toolCallsCompleted: this.toolCallsCompleted,
      elapsedMs: this.elapsedMs(),
      lastSentAt: this.lastSentAt,
    };
  }

  private elapsedMs(): number {
    return Date.now() - this.createdAt;
  }

  private buildResult(
    overrides: Partial<ProgressEmitterResult>,
  ): ProgressEmitterResult {
    return {
      sent: false,
      persisted: false,
      requestId: this.context.requestId,
      channel: this.context.channel,
      ...overrides,
    };
  }
}
