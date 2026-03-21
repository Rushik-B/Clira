import type { LanguageModel } from 'ai';
import {
  callTextWithToolsStep,
  createToolBudgetController,
  type ToolBudgetReport,
} from '@/lib/ai/callLlm';
import type { ProgressEmitter } from '@/lib/ai/progressEmitter';
import { logger } from '@/lib/logger';
import type { AiTraceContext } from '@/lib/ai/tracing';
import type {
  ConsumeSteerEventsResult,
  RunPhase,
} from '@/lib/services/messaging-orchestration/types';

export type SteerRunContext = {
  consumeSteerEvents: (afterSeq: number) => Promise<ConsumeSteerEventsResult>;
  markRunPhase: (phase: RunPhase) => Promise<void>;
};

export type ProgressCheckpoint = {
  emitter: ProgressEmitter;
  describeLastTool: (toolName: string, variationIndex: number) => string | null;
};

function hasNonEmptyMessageContent(
  messages: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
): messages is Array<{ role: 'user' | 'assistant'; content: string }> {
  return Array.isArray(messages) && messages.some((message) => message.content.trim().length > 0);
}

function resolveSeedMessages(params: {
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (hasNonEmptyMessageContent(params.messages)) {
    return [...params.messages];
  }

  const prompt = params.prompt?.trim();
  if (prompt) {
    return [{ role: 'user', content: prompt }];
  }

  throw new Error('empty seed input');
}

function buildSteerInjection(params: {
  events: ConsumeSteerEventsResult['events'];
  droppedSummary: string[];
}): string {
  const lines: string[] = [
    'IN-RUN STEERING UPDATE (new user message while you were working):',
  ];

  for (const event of params.events) {
    const text = event.text.trim();
    if (text) {
      lines.push(`- ${text}`);
    }
  }

  const dropped = params.droppedSummary
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (dropped.length > 0) {
    lines.push('');
    lines.push(
      `Note: dropped ${dropped.length} earlier steering messages due to overflow; summary:`,
    );
    for (const item of dropped) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('Apply immediately. If this changes the plan, adjust your next step.');
  return lines.join('\n');
}

function extractToolName(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;

  const record = item as Record<string, unknown>;
  const candidate =
    record.toolName ??
    record.name ??
    record.tool ??
    (record.function &&
    typeof record.function === 'object' &&
    (record.function as Record<string, unknown>).name) ??
    record.functionName;

  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function collectOrderedToolNamesForStep(result: {
  toolResults?: unknown;
  toolCalls?: unknown;
}): string[] {
  const names: string[] = [];

  const collect = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const toolName = extractToolName(item);
      if (toolName) {
        names.push(toolName);
      }
    }
  };

  collect(result.toolResults);
  if (names.length === 0) {
    collect(result.toolCalls);
  }

  return names;
}

export async function runSteerableTextWithTools(params: {
  model: LanguageModel | string;
  system?: string;
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: any;
  timeLeftMs: () => number | null;
  maxSteps: number;
  stopWhen?: any;
  maxToolCallsTotal?: number;
  maxToolCallsPerTool?: Record<string, number>;
  deadlineMs?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  op: string;
  concurrency?: { key: string; maxConcurrency: number };
  retry?: { maxAttempts: number; baseDelayMs: number };
  providerOptions?: any;
  runContext?: SteerRunContext;
  traceContext?: AiTraceContext;
  progressCheckpoint?: ProgressCheckpoint;
}): Promise<{
  text: string;
  toolCalls: unknown[];
  toolResults: unknown[];
  steps: unknown[];
  toolBudget?: ToolBudgetReport;
  steer: { appliedEvents: number; appliedDroppedSummary: number; lastSeq: number };
  messagesWhenEmpty?: unknown[];
}> {
  const messages: any[] = resolveSeedMessages({
    messages: params.messages,
    prompt: params.prompt,
  });

  const budget = createToolBudgetController({
    tools: params.tools as any,
    maxToolCallsTotal: params.maxToolCallsTotal,
    maxToolCallsPerTool: params.maxToolCallsPerTool,
    deadlineMs: params.deadlineMs,
    timeLeftMs: params.timeLeftMs,
    op: params.op,
  });

  const toolCalls: unknown[] = [];
  const toolResults: unknown[] = [];
  const steps: unknown[] = [];
  let text = '';

  let steerSeq = 0;
  let appliedEvents = 0;
  let appliedDroppedSummary = 0;

  const consumeAndInjectSteer = async (): Promise<boolean> => {
    if (!params.runContext) return false;

    const consumed = await params.runContext.consumeSteerEvents(steerSeq);
    const hasEvents = consumed.events.length > 0;
    const hasDropped = consumed.droppedSummary.length > 0;
    if (!hasEvents && !hasDropped) return false;

    steerSeq = consumed.nextSeq;
    appliedEvents += consumed.events.length;
    appliedDroppedSummary += consumed.droppedSummary.length;

    messages.push({
      role: 'user',
      content: buildSteerInjection({
        events: consumed.events,
        droppedSummary: consumed.droppedSummary,
      }),
    });

    return true;
  };

  const isTerminalToolStep = (stepResult: { steps?: unknown[] }) => {
    if (!params.stopWhen) return false;
    const stopFns = Array.isArray(params.stopWhen) ? params.stopWhen : [params.stopWhen];
    return stopFns.some((fn) => {
      if (typeof fn !== 'function') return false;
      return Boolean(fn({ steps: stepResult.steps ?? [] }));
    });
  };

  await params.runContext?.markRunPhase('running');
  try {
    await consumeAndInjectSteer();

    for (let stepIndex = 0; stepIndex < params.maxSteps; stepIndex += 1) {
      const stepOp = `${params.op}.step.${stepIndex + 1}`;
      const result = await callTextWithToolsStep({
        model: params.model,
        system: params.system,
        messages,
        tools: budget.tools,
        stopWhen: params.stopWhen,
        temperature: params.temperature,
        abortSignal: params.abortSignal,
        op: stepOp,
        concurrency: params.concurrency,
        retry: params.retry,
        providerOptions: params.providerOptions,
        traceContext: params.traceContext,
      });

      if (Array.isArray(result.responseMessages) && result.responseMessages.length > 0) {
        messages.push(...result.responseMessages);
      }

      if (Array.isArray(result.toolCalls) && result.toolCalls.length > 0) {
        toolCalls.push(...result.toolCalls);
      }
      if (Array.isArray(result.toolResults) && result.toolResults.length > 0) {
        toolResults.push(...result.toolResults);
      }
      if (Array.isArray(result.steps) && result.steps.length > 0) {
        steps.push(...result.steps);
      }

      const candidateText = (result.text || '').trim();
      const terminalToolStep = isTerminalToolStep({ steps: result.steps });

      if (
        params.progressCheckpoint &&
        !candidateText &&
        !terminalToolStep
      ) {
        const stepToolNames = collectOrderedToolNamesForStep({
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
        });

        const variationIndex = params.progressCheckpoint.emitter.state().sentCount;
        for (let i = stepToolNames.length - 1; i >= 0; i -= 1) {
          const description = params.progressCheckpoint.describeLastTool(
            stepToolNames[i]!,
            variationIndex,
          );
          if (!description) {
            continue;
          }

          await params.progressCheckpoint.emitter.emit({
            text: description,
            kind: 'long_task',
            source: 'harness',
          });
          break;
        }
      }

      if (candidateText) {
        const injected = await consumeAndInjectSteer();
        if (!injected) {
          text = candidateText;
          break;
        }
      }

      if (terminalToolStep) {
        logger.info(`[steerableLoop] terminal tool stop op=${params.op} step=${stepIndex + 1}`);
        break;
      }

      await consumeAndInjectSteer();
    }

    const result = {
      text,
      toolCalls,
      toolResults,
      steps,
      toolBudget: budget.report(),
      steer: { appliedEvents, appliedDroppedSummary, lastSeq: steerSeq },
    };
    if (!text && steps.length > 0) {
      (result as { messagesWhenEmpty?: typeof messages }).messagesWhenEmpty = messages;
    }
    return result;
  } finally {
    await params.runContext?.markRunPhase('completed');
  }
}
