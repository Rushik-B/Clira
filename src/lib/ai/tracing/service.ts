import crypto from 'node:crypto';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { getQueuedFileWriter, releaseQueuedFileWriter } from './fileWriter';
import { previewText, sanitizeForTrace } from './sanitize';
import type {
  AiTraceContext,
  AiTraceRootInput,
  AiTraceRunFinishInput,
  AiTraceSpanHandle,
  AiTraceSpanInput,
  AiTraceUsage,
} from './types';

const sequenceCounters = new Map<string, number>();

function isTraceEnabled(): boolean {
  return process.env.CLIRA_AI_TRACE_ENABLED !== 'false';
}

function getCaptureMode(): 'full' | 'summary' | 'off' {
  const raw = (process.env.CLIRA_AI_TRACE_CAPTURE ?? 'full').trim().toLowerCase();
  if (raw === 'summary' || raw === 'off') return raw;
  return 'full';
}

export function resolveAiTraceDir(): string {
  const configured = process.env.CLIRA_AI_TRACE_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
  }
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    '.clira-runtime',
    'ai-traces',
  );
}

function buildDayPartition(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function buildArtifactPath(runId: string, date = new Date()): string {
  return path.join(resolveAiTraceDir(), buildDayPartition(date), `${runId}.jsonl`);
}

function resolveManifestPath(): string {
  return path.join(resolveAiTraceDir(), 'index.jsonl');
}

function nextSeq(runId: string): number {
  const next = (sequenceCounters.get(runId) ?? 0) + 1;
  sequenceCounters.set(runId, next);
  return next;
}

function maybeSanitizePayload(context: AiTraceContext, payload: unknown): unknown {
  if (!context.enabled || context.captureMode === 'off' || payload === undefined) {
    return undefined;
  }

  if (context.captureMode === 'summary') {
    return sanitizeForTrace({
      preview: previewText(typeof payload === 'string' ? payload : JSON.stringify(sanitizeForTrace(payload))),
    });
  }

  return sanitizeForTrace(payload);
}

async function appendJsonl(filePath: string, record: Record<string, unknown>): Promise<void> {
  const writer = getQueuedFileWriter(filePath);
  await writer.write(`${JSON.stringify(record)}\n`);
}

async function appendRawTraceLine(context: AiTraceContext, record: Record<string, unknown>): Promise<void> {
  if (!context.enabled || !context.artifactPath) return;

  await appendJsonl(context.artifactPath, {
    ...record,
    ts: new Date().toISOString(),
    runId: context.runId,
    pipeline: context.pipeline,
    userId: context.userId,
    channel: context.channel ?? null,
    conversationId: context.conversationId ?? null,
    emailId: context.emailId ?? null,
    mailboxId: context.mailboxId ?? null,
    externalMessageId: context.externalMessageId ?? null,
    label: context.label ?? null,
  });
}

async function appendManifestRecord(context: AiTraceContext, record: Record<string, unknown>): Promise<void> {
  if (!context.enabled) return;

  await appendJsonl(resolveManifestPath(), {
    ...record,
    ts: new Date().toISOString(),
    runId: context.runId,
    pipeline: context.pipeline,
    userId: context.userId,
    channel: context.channel ?? null,
    conversationId: context.conversationId ?? null,
    emailId: context.emailId ?? null,
    mailboxId: context.mailboxId ?? null,
    externalMessageId: context.externalMessageId ?? null,
    label: context.label ?? null,
    artifactPath: context.artifactPath ?? null,
  });
}

function childContext(context: AiTraceContext, spanId: string): AiTraceContext {
  return {
    ...context,
    spanId,
    parentSpanId: context.spanId ?? null,
  };
}

export async function createAiTraceRoot(input: AiTraceRootInput): Promise<AiTraceContext> {
  const enabled = isTraceEnabled();
  const captureMode = enabled ? getCaptureMode() : 'off';
  const runId = input.runId ?? crypto.randomUUID();
  const startedAt = new Date();
  const artifactPath = enabled ? buildArtifactPath(runId, startedAt) : null;

  const context: AiTraceContext = {
    enabled,
    captureMode,
    runId,
    pipeline: input.pipeline,
    userId: input.userId,
    channel: input.channel ?? null,
    conversationId: input.conversationId ?? null,
    emailId: input.emailId ?? null,
    mailboxId: input.mailboxId ?? null,
    externalMessageId: input.externalMessageId ?? null,
    label: input.label ?? null,
    artifactPath,
    rootStartedAtMs: startedAt.getTime(),
  };

  if (!enabled || captureMode === 'off') {
    return context;
  }

  const metadata = maybeSanitizePayload(context, input.metadata ?? undefined);

  await appendManifestRecord(context, {
    event: 'run.start',
    status: 'PENDING',
    startedAt: startedAt.toISOString(),
    inputPreview: input.inputPreview ?? null,
    metadata,
  });

  await appendRawTraceLine(context, {
    event: 'run.start',
    status: 'PENDING',
    inputPreview: input.inputPreview ?? null,
    metadata,
  });

  return context;
}

export async function accumulateAiTraceUsage(
  context: AiTraceContext | undefined,
  usage: AiTraceUsage | null | undefined,
): Promise<void> {
  if (!context?.enabled || !usage) return;

  await appendRawTraceLine(context, {
    event: 'usage',
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      totalTokens: usage.totalTokens ?? null,
    },
  });
}

export async function startAiTraceSpan(
  context: AiTraceContext | undefined,
  input: AiTraceSpanInput,
): Promise<AiTraceSpanHandle> {
  const spanId = crypto.randomUUID();
  const startedAt = new Date();
  const spanContext = context ? childContext(context, spanId) : undefined;

  if (spanContext?.enabled) {
    await appendRawTraceLine(spanContext, {
      event: 'span.start',
      seq: nextSeq(spanContext.runId),
      spanId,
      parentSpanId: spanContext.parentSpanId ?? null,
      kind: input.kind,
      name: input.name,
      payload: maybeSanitizePayload(spanContext, {
        input: input.input,
        metadata: input.metadata ?? null,
      }),
    });
  }

  return {
    spanId,
    context: spanContext ?? {
      enabled: false,
      captureMode: 'off',
      runId: '',
      pipeline: '',
      userId: '',
    },
    finish: async (params) => {
      if (!spanContext?.enabled) return;

      const endedAt = new Date();
      const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

      await appendRawTraceLine(spanContext, {
        event: params?.status === 'ERROR' ? 'span.error' : 'span.finish',
        seq: nextSeq(spanContext.runId),
        spanId,
        parentSpanId: spanContext.parentSpanId ?? null,
        kind: input.kind,
        name: input.name,
        status: params?.status ?? 'OK',
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs,
        errorMessage: params?.errorMessage ?? null,
        payload: maybeSanitizePayload(spanContext, {
          input: input.input,
          metadata: {
            ...(input.metadata ?? {}),
            ...(params?.metadata ?? {}),
          },
          output: params?.output,
        }),
      });

      if (params?.usage) {
        await accumulateAiTraceUsage(spanContext, params.usage);
      }
    },
  };
}

export async function withAiTraceSpan<T>(
  context: AiTraceContext | undefined,
  input: AiTraceSpanInput,
  fn: (child: AiTraceContext | undefined) => Promise<{ result: T; output?: unknown; usage?: AiTraceUsage | null }>,
): Promise<T> {
  const handle = await startAiTraceSpan(context, input);
  try {
    const response = await fn(handle.context.enabled ? handle.context : context);
    await handle.finish({
      status: 'OK',
      output: response.output ?? response.result,
      usage: response.usage ?? undefined,
    });
    return response.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowered = message.toLowerCase();
    await handle.finish({
      status: lowered.includes('abort') || lowered.includes('superseded') ? 'ABORTED' : 'ERROR',
      errorMessage: message,
      output: error,
    });
    throw error;
  }
}

export async function finalizeAiTraceRun(
  context: AiTraceContext | undefined,
  input: AiTraceRunFinishInput,
): Promise<void> {
  if (!context?.runId) return;

  if (!context.enabled) {
    sequenceCounters.delete(context.runId);
    return;
  }

  const endedAt = new Date();
  const durationMs = Math.max(0, endedAt.getTime() - (context.rootStartedAtMs ?? endedAt.getTime()));
  const record = {
    event: 'run.finish',
    status: input.status,
    endedAt: endedAt.toISOString(),
    durationMs,
    outputPreview: input.outputPreview ?? null,
    errorMessage: input.errorMessage ?? null,
    metadata: maybeSanitizePayload(context, input.metadata ?? undefined),
  };

  try {
    await appendManifestRecord(context, record);
    await appendRawTraceLine(context, record);
  } finally {
    sequenceCounters.delete(context.runId);

    if (context.artifactPath) {
      await releaseQueuedFileWriter(context.artifactPath);
    }
  }
}

export function buildAiTraceMetadata(context: AiTraceContext | undefined): Record<string, unknown> | null {
  if (!context?.runId) return null;
  return {
    trace: {
      runId: context.runId,
      spanId: context.spanId ?? null,
      pipeline: context.pipeline,
      channel: context.channel ?? null,
      artifactPath: context.artifactPath ?? null,
    },
  };
}

export function deriveRunStatusFromError(error: unknown): AiTraceRunFinishInput['status'] {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|aborted|superseded/i.test(message)) {
    return 'ABORTED';
  }
  return 'ERROR';
}

export function deriveOutputPreview(value: unknown): string | null {
  if (typeof value === 'string') return previewText(value, 400);
  if (value && typeof value === 'object' && 'reply' in (value as Record<string, unknown>)) {
    return previewText(String((value as Record<string, unknown>).reply ?? ''), 400);
  }
  try {
    return previewText(JSON.stringify(sanitizeForTrace(value)), 400);
  } catch {
    return null;
  }
}

export function wrapToolsWithAiTracing<T extends Record<string, unknown>>(
  context: AiTraceContext | undefined,
  tools: T,
): T {
  const wrapped: Record<string, unknown> = {};

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const tool = toolDefinition as { execute?: (args: unknown) => Promise<unknown> };
    if (!tool || typeof tool !== 'object' || typeof tool.execute !== 'function') {
      wrapped[toolName] = toolDefinition;
      continue;
    }

    wrapped[toolName] = {
      ...tool,
      execute: async (args: unknown) => {
        return withAiTraceSpan(
          context,
          {
            kind: 'TOOL',
            name: toolName,
            input: args,
          },
          async () => {
            const result = await tool.execute?.(args);
            return {
              result,
              output: result,
            };
          },
        );
      },
    };
  }

  return wrapped as T;
}

export async function appendAiTraceNote(
  context: AiTraceContext | undefined,
  name: string,
  payload?: unknown,
): Promise<void> {
  if (!context?.enabled) return;
  await appendRawTraceLine(context, {
    event: 'note',
    seq: nextSeq(context.runId),
    name,
    payload: maybeSanitizePayload(context, payload),
  });
}
