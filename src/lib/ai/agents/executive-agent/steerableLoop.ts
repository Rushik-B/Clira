import type { LanguageModel } from 'ai';
import {
  callTextWithToolsStep,
  createToolBudgetController,
  type ToolBudgetReport,
} from '@/lib/ai/callLlm';
import { logger } from '@/lib/logger';
import type {
  ConsumeSteerEventsResult,
  RunPhase,
} from '@/lib/services/messaging-orchestration/types';

export type SteerRunContext = {
  consumeSteerEvents: (afterSeq: number) => Promise<ConsumeSteerEventsResult>;
  markRunPhase: (phase: RunPhase) => Promise<void>;
};

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

export async function runSteerableTextWithTools(params: {
  model: LanguageModel | string;
  system?: string;
  prompt: string;
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
}): Promise<{
  text: string;
  toolCalls: unknown[];
  toolResults: unknown[];
  steps: unknown[];
  toolBudget?: ToolBudgetReport;
  steer: { appliedEvents: number; appliedDroppedSummary: number; lastSeq: number };
}> {
  const messages: any[] = [{ role: 'user', content: params.prompt }];

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
      if (candidateText) {
        const injected = await consumeAndInjectSteer();
        if (!injected) {
          text = candidateText;
          break;
        }
      }

      if (isTerminalToolStep({ steps: result.steps })) {
        logger.info(`[steerableLoop] terminal tool stop op=${params.op} step=${stepIndex + 1}`);
        break;
      }

      await consumeAndInjectSteer();
    }

    return {
      text,
      toolCalls,
      toolResults,
      steps,
      toolBudget: budget.report(),
      steer: { appliedEvents, appliedDroppedSummary, lastSeq: steerSeq },
    };
  } finally {
    await params.runContext?.markRunPhase('completed');
  }
}
