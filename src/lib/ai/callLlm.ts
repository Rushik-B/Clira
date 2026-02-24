import { generateText, generateObject, LanguageModel, Output, stepCountIs } from 'ai';
import type { ProviderOptions as AISDKProviderOptions } from '@ai-sdk/provider-utils';
import { withConcurrency, type ConcurrencyOptions } from './concurrency';
import { withRetry, type RetryOptions } from './retry';
import { logger } from '../logger';
import { createSchemaRepairFunction } from './utils/repair';

// Using `any` for schema typing here to avoid tight coupling to internal AI SDK generics.
// Zod enforces structure at runtime; callers provide precise generic type T.

export type LlmOptions = {
  model: LanguageModel | string;
  system?: string;
  temperature?: number;
  abortSignal?: AbortSignal;
  providerOptions?: AISDKProviderOptions;
  // telemetry/meta
  op?: string; // operation name e.g. 'reply.generate'
  concurrency?: ConcurrencyOptions; // per-op keyed concurrency
  retry?: RetryOptions; // retry policy overrides
};

export type ToolBudgetOptions = {
  maxToolCallsTotal?: number;
  maxToolCallsPerTool?: Record<string, number>;
  deadlineMs?: number;
};

type ToolDefinition = {
  execute?: (args: unknown) => Promise<unknown>;
  [key: string]: unknown;
};

type ToolBudgetState = {
  totalCalls: number;
  perTool: Map<string, number>;
};

export type ToolBudgetReport = {
  totalCalls: number;
  perTool: Record<string, number>;
  maxToolCallsTotal?: number;
  maxToolCallsPerTool?: Record<string, number>;
  deadlineMs?: number;
};

export type ToolBudgetController = {
  tools: Record<string, ToolDefinition>;
  state: ToolBudgetState;
  config?: ToolBudgetOptions;
  report: () => ToolBudgetReport | undefined;
};

type ToolBudgetExceededResult = {
  ok: false;
  error: 'tool_budget_exceeded' | 'deadline_exceeded';
  tool: string;
  reason: string;
  counts: {
    total: number;
    tool: number;
    maxTotal?: number;
    maxForTool?: number;
  };
  timeLeftMs?: number;
  deadlineMs?: number;
  hint: string;
};

function makeAbortError(message: string): Error {
  // Ensure downstream sees a standard AbortError shape so we don't retry aborted calls.
  // DOMException is available in Node 18+; keep a fallback for safety.
  try {
    return new DOMException(message, 'AbortError');
  } catch {
    const err = new Error(message);
    (err as any).name = 'AbortError';
    return err;
  }
}

function normalizeAbortReason(reason: unknown, fallbackMessage: string): Error {
  if (reason == null) return makeAbortError(fallbackMessage);
  if (reason instanceof Error) return reason;
  return makeAbortError(String(reason));
}

export function createDeadlineController({
  abortSignal,
  deadlineMs,
}: {
  abortSignal?: AbortSignal;
  deadlineMs?: number;
}): {
  signal?: AbortSignal;
  cleanup: () => void;
  timeLeftMs: () => number | null;
  deadlineAt?: number;
} {
  if (!deadlineMs) {
    return {
      signal: abortSignal,
      cleanup: () => {},
      timeLeftMs: () => null,
      deadlineAt: undefined,
    };
  }

  const controller = new AbortController();
  const deadlineAt = Date.now() + deadlineMs;
  const onAbort = () => controller.abort(normalizeAbortReason(abortSignal?.reason, 'Aborted'));

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort(normalizeAbortReason(abortSignal.reason, 'Aborted'));
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    controller.abort(makeAbortError('Deadline exceeded'));
  }, deadlineMs);

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (abortSignal) {
      abortSignal.removeEventListener('abort', onAbort);
    }
  };

  return {
    signal: controller.signal,
    cleanup,
    timeLeftMs: () => Math.max(0, deadlineAt - Date.now()),
    deadlineAt,
  };
}

function wrapToolsWithBudgets({
  tools,
  budgets,
  timeLeftMs,
  op,
  state: existingState,
}: {
  tools: Record<string, ToolDefinition>;
  budgets?: ToolBudgetOptions;
  timeLeftMs: () => number | null;
  op: string;
  state?: ToolBudgetState;
}): { tools: Record<string, ToolDefinition>; state: ToolBudgetState } {
  const state: ToolBudgetState =
    existingState ??
    ({
      totalCalls: 0,
      perTool: new Map<string, number>(),
    } satisfies ToolBudgetState);

  const hasBudgets =
    typeof budgets?.maxToolCallsTotal === 'number' ||
    typeof budgets?.deadlineMs === 'number' ||
    !!budgets?.maxToolCallsPerTool;
  if (!budgets || !hasBudgets) {
    return { tools, state };
  }

  const budgetedTools: Record<string, ToolDefinition> = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    if (!tool || typeof tool.execute !== 'function') {
      budgetedTools[toolName] = tool;
      continue;
    }

    const execute = tool.execute;
    budgetedTools[toolName] = {
      ...tool,
      execute: async (args: unknown) => {
        const totalCalls = state.totalCalls;
        const toolCalls = state.perTool.get(toolName) ?? 0;
        const maxTotal = budgets.maxToolCallsTotal;
        const maxForTool = budgets.maxToolCallsPerTool?.[toolName];
        const timeLeft = timeLeftMs();

        if (timeLeft !== null && timeLeft <= 0) {
          logger.warn(
            `[llm] tool budget exceeded op=${op} tool=${toolName} reason=deadline_exceeded total=${totalCalls} toolCalls=${toolCalls}`,
          );
          const result: ToolBudgetExceededResult = {
            ok: false,
            error: 'deadline_exceeded',
            tool: toolName,
            reason: 'Deadline reached before tool execution.',
            counts: {
              total: totalCalls,
              tool: toolCalls,
              maxTotal,
              maxForTool,
            },
            timeLeftMs: timeLeft,
            deadlineMs: budgets.deadlineMs,
            hint: 'Answer with available context or ask a single clarifying question.',
          };
          return result;
        }

        if (typeof maxTotal === 'number' && totalCalls >= maxTotal) {
          logger.warn(
            `[llm] tool budget exceeded op=${op} tool=${toolName} reason=max_total total=${totalCalls} toolCalls=${toolCalls}`,
          );
          const result: ToolBudgetExceededResult = {
            ok: false,
            error: 'tool_budget_exceeded',
            tool: toolName,
            reason: 'Max total tool calls reached.',
            counts: {
              total: totalCalls,
              tool: toolCalls,
              maxTotal,
              maxForTool,
            },
            timeLeftMs: timeLeft ?? undefined,
            deadlineMs: budgets.deadlineMs,
            hint: 'Answer with available context or ask a single clarifying question.',
          };
          return result;
        }

        if (typeof maxForTool === 'number' && toolCalls >= maxForTool) {
          logger.warn(
            `[llm] tool budget exceeded op=${op} tool=${toolName} reason=max_per_tool total=${totalCalls} toolCalls=${toolCalls}`,
          );
          const result: ToolBudgetExceededResult = {
            ok: false,
            error: 'tool_budget_exceeded',
            tool: toolName,
            reason: 'Max calls for this tool reached.',
            counts: {
              total: totalCalls,
              tool: toolCalls,
              maxTotal,
              maxForTool,
            },
            timeLeftMs: timeLeft ?? undefined,
            deadlineMs: budgets.deadlineMs,
            hint: 'Answer with available context or ask a single clarifying question.',
          };
          return result;
        }

        state.totalCalls = totalCalls + 1;
        state.perTool.set(toolName, toolCalls + 1);

        return execute(args);
      },
    };
  }

  return { tools: budgetedTools, state };
}

export function createToolBudgetController(params: {
  tools: Record<string, ToolDefinition>;
  maxToolCallsTotal?: number;
  maxToolCallsPerTool?: Record<string, number>;
  deadlineMs?: number;
  timeLeftMs: () => number | null;
  op: string;
}): ToolBudgetController {
  const hasBudgetConfig =
    typeof params.maxToolCallsTotal === 'number' ||
    typeof params.deadlineMs === 'number' ||
    !!params.maxToolCallsPerTool;

  const config: ToolBudgetOptions | undefined = hasBudgetConfig
    ? {
        maxToolCallsTotal: params.maxToolCallsTotal,
        maxToolCallsPerTool: params.maxToolCallsPerTool,
        deadlineMs: params.deadlineMs,
      }
    : undefined;

  const { tools: budgetedTools, state } = wrapToolsWithBudgets({
    tools: params.tools,
    budgets: config,
    timeLeftMs: params.timeLeftMs,
    op: params.op,
  });

  return {
    tools: budgetedTools,
    state,
    config,
    report: () => {
      if (!config) return undefined;
      return {
        totalCalls: state.totalCalls,
        perTool: Object.fromEntries(state.perTool.entries()),
        maxToolCallsTotal: config.maxToolCallsTotal,
        maxToolCallsPerTool: config.maxToolCallsPerTool,
        deadlineMs: config.deadlineMs,
      };
    },
  };
}

export async function callText({
  model,
  system,
  prompt,
  temperature = 0.6,
  abortSignal,
  op = 'text',
  concurrency,
  retry,
  providerOptions,
}: LlmOptions & { prompt: string }) {
  const exec = async () => {
    const start = Date.now();
    const promptChars = prompt?.length ?? 0;
    const systemChars = system?.length ?? 0;
    const modelLabelStart = typeof model === 'string' ? model : 'unknown';
    logger.info(
      `🚀 [llm] start op=${op} model=${modelLabelStart} prompt=${promptChars} chars sys=${systemChars} temp=${temperature}`,
    );
    try {
      const result = await generateText({
        model,
        system,
        prompt,
        temperature,
        abortSignal,
        providerOptions,
      });
      const { text, usage, response } = result as any;
      const dur = Date.now() - start;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      logger.info(
        `✅ [llm] done op=${op} model=${modelId} 🔢 in=${usage?.inputTokens ?? '-'} out=${usage?.outputTokens ?? '-'} total=${usage?.totalTokens ?? '-'} ⏱️ ${dur}ms`,
      );
      return { text, usage };
    } catch (err) {
      const dur = Date.now() - start;
      const usage = (err as any)?.usage;
      const response = (err as any)?.response;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      logger.warn(
        `❌ [llm] fail op=${op} model=${modelId} 🔢 in=${usage?.inputTokens ?? '-'} out=${usage?.outputTokens ?? '-'} total=${usage?.totalTokens ?? '-'} ⏱️ ${dur}ms reason=${(err as any)?.code ?? (err as any)?.name ?? 'error'}`,
      );
      throw err;
    }
  };

  return withConcurrency(() => withRetry(exec, retry), { key: concurrency?.key ?? op, maxConcurrency: concurrency?.maxConcurrency });
}

/**
 * Multi-step text generation with tool calling enabled.
 *
 * Use this for "agent-like" workflows where the model can call tools and then
 * continue reasoning across multiple steps before producing its final output.
 */
export async function callTextWithTools({
  model,
  system,
  prompt,
  tools,
  maxSteps,
  stopWhen,
  maxToolCallsTotal,
  maxToolCallsPerTool,
  deadlineMs,
  temperature = 0.3,
  abortSignal,
  op = 'agent',
  concurrency,
  retry,
  providerOptions,
}: LlmOptions & {
  prompt: string;
  tools: any;
  maxSteps?: number;
  stopWhen?: any;
  maxToolCallsTotal?: number;
  maxToolCallsPerTool?: Record<string, number>;
  deadlineMs?: number;
}) {
  const exec = async () => {
    const start = Date.now();
    const promptChars = prompt?.length ?? 0;
    const systemChars = system?.length ?? 0;
    const modelLabelStart = typeof model === 'string' ? model : 'unknown';
    const hasBudgetConfig =
      typeof maxToolCallsTotal === 'number' ||
      typeof deadlineMs === 'number' ||
      !!maxToolCallsPerTool;
    const budgetConfig: ToolBudgetOptions | undefined = hasBudgetConfig
      ? {
          maxToolCallsTotal,
          maxToolCallsPerTool,
          deadlineMs,
        }
      : undefined;
    const { signal: combinedAbortSignal, cleanup, timeLeftMs } = createDeadlineController({
      abortSignal,
      deadlineMs: budgetConfig?.deadlineMs,
    });
    const toolDefinitions = tools as Record<string, ToolDefinition>;
    const { tools: budgetedTools, state: budgetState } = wrapToolsWithBudgets({
      tools: toolDefinitions,
      budgets: budgetConfig,
      timeLeftMs,
      op,
    });

    logger.info(
      `🚀 [llm] start op=${op} model=${modelLabelStart} prompt=${promptChars} chars sys=${systemChars} temp=${temperature} steps=${maxSteps ?? '-'}`,
    );
    if (budgetConfig) {
      logger.info(
        `[llm] tool budgets op=${op} total=${budgetConfig.maxToolCallsTotal ?? '-'} deadlineMs=${budgetConfig.deadlineMs ?? '-'} perTool=${budgetConfig.maxToolCallsPerTool ? Object.keys(budgetConfig.maxToolCallsPerTool).length : 0}`,
      );
    }

    try {
      const stepCap = stepCountIs(maxSteps ?? 5);
      const composedStopWhen = stopWhen
        ? [stepCap, ...(Array.isArray(stopWhen) ? stopWhen : [stopWhen])]
        : stepCap;

      const result = await generateText({
        model,
        system,
        prompt,
        temperature,
        tools: budgetedTools,
        stopWhen: composedStopWhen,
        abortSignal: combinedAbortSignal,
        providerOptions,
      } as any);

      const { text, usage, totalUsage, response, steps, toolCalls, toolResults } = result as any;
      const dur = Date.now() - start;
      const modelId = (response && (response as any).modelId) || modelLabelStart;

      const u = totalUsage ?? usage;
      logger.info(
        `✅ [llm] done op=${op} model=${modelId} 🔢 in=${u?.inputTokens ?? '-'} out=${u?.outputTokens ?? '-'} total=${u?.totalTokens ?? '-'} ⏱️ ${dur}ms steps=${Array.isArray(steps) ? steps.length : '-'}`,
      );
      if (budgetConfig) {
        const perTool = Object.fromEntries(budgetState.perTool.entries());
        logger.info(
          `[llm] tool budgets op=${op} usedTotal=${budgetState.totalCalls} perTool=${JSON.stringify(perTool)}`,
        );
      }

      return {
        text,
        usage: u,
        steps,
        toolCalls,
        toolResults,
        toolBudget: budgetConfig
          ? ({
              totalCalls: budgetState.totalCalls,
              perTool: Object.fromEntries(budgetState.perTool.entries()),
              maxToolCallsTotal: budgetConfig.maxToolCallsTotal,
              maxToolCallsPerTool: budgetConfig.maxToolCallsPerTool,
              deadlineMs: budgetConfig.deadlineMs,
            } satisfies ToolBudgetReport)
          : undefined,
      };
    } catch (err) {
      const dur = Date.now() - start;
      const usage = (err as any)?.usage;
      const response = (err as any)?.response;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      logger.warn(
        `❌ [llm] fail op=${op} model=${modelId} 🔢 in=${usage?.inputTokens ?? '-'} out=${usage?.outputTokens ?? '-'} total=${usage?.totalTokens ?? '-'} ⏱️ ${dur}ms reason=${(err as any)?.code ?? (err as any)?.name ?? 'error'}`,
      );
      throw err;
    } finally {
      cleanup();
    }
  };

  return withConcurrency(() => withRetry(exec, retry), {
    key: concurrency?.key ?? op,
    maxConcurrency: concurrency?.maxConcurrency,
  });
}

export async function callTextWithToolsStep({
  model,
  system,
  messages,
  tools,
  stopWhen,
  temperature = 0.3,
  abortSignal,
  op = 'agent.step',
  concurrency,
  retry,
  providerOptions,
}: LlmOptions & {
  messages: any[];
  tools: any;
  stopWhen?: any;
}) {
  const exec = async () => {
    const start = Date.now();
    const messageCount = Array.isArray(messages) ? messages.length : 0;
    const systemChars = system?.length ?? 0;
    const modelLabelStart = typeof model === 'string' ? model : 'unknown';

    logger.info(
      `🚀 [llm] start op=${op} model=${modelLabelStart} messages=${messageCount} sys=${systemChars} temp=${temperature} steps=1`,
    );

    try {
      const stepCap = stepCountIs(1);
      const composedStopWhen = stopWhen
        ? [stepCap, ...(Array.isArray(stopWhen) ? stopWhen : [stopWhen])]
        : stepCap;

      const result = await generateText({
        model,
        system,
        messages,
        temperature,
        tools,
        stopWhen: composedStopWhen,
        abortSignal,
        providerOptions,
      } as any);

      const { text, usage, totalUsage, response, steps, toolCalls, toolResults } = result as any;
      const dur = Date.now() - start;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      const u = totalUsage ?? usage;

      logger.info(
        `✅ [llm] done op=${op} model=${modelId} 🔢 in=${u?.inputTokens ?? '-'} out=${u?.outputTokens ?? '-'} total=${u?.totalTokens ?? '-'} ⏱️ ${dur}ms`,
      );

      return {
        text,
        usage: u,
        steps,
        toolCalls,
        toolResults,
        responseMessages: (response && (response as any).messages) || [],
      };
    } catch (err) {
      const dur = Date.now() - start;
      const usage = (err as any)?.usage;
      const response = (err as any)?.response;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      logger.warn(
        `❌ [llm] fail op=${op} model=${modelId} 🔢 in=${usage?.inputTokens ?? '-'} out=${usage?.outputTokens ?? '-'} total=${usage?.totalTokens ?? '-'} ⏱️ ${dur}ms reason=${(err as any)?.code ?? (err as any)?.name ?? 'error'}`,
      );
      throw err;
    }
  };

  return withConcurrency(() => withRetry(exec, retry), {
    key: concurrency?.key ?? op,
    maxConcurrency: concurrency?.maxConcurrency,
  });
}

export async function callObject<T>({
  model,
  system,
  prompt,
  schema,
  temperature = 0.4,
  abortSignal,
  op = 'object',
  concurrency,
  retry,
  providerOptions,
}: LlmOptions & { prompt: string; schema: any }) {
  const exec = async () => {
    const start = Date.now();
    const promptChars = prompt?.length ?? 0;
    const systemChars = system?.length ?? 0;
    const modelLabelStart = typeof model === 'string' ? model : 'unknown';
    logger.info(
      `🚀 [llm] start op=${op} model=${modelLabelStart} prompt=${promptChars} chars sys=${systemChars} temp=${temperature}`,
    );
    try {
      const result = await generateObject({
        model,
        system,
        prompt,
        schema,
        temperature,
        abortSignal,
        experimental_repairText: createSchemaRepairFunction(),
        providerOptions,
      });
      const { object, usage, response } = result as any;
      const dur = Date.now() - start;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      logger.info(
        `✅ [llm] done op=${op} model=${modelId} 🔢 in=${usage?.inputTokens ?? '-'} out=${usage?.outputTokens ?? '-'} total=${usage?.totalTokens ?? '-'} ⏱️ ${dur}ms`,
      );
      return { object: object as T, usage };
    } catch (err) {
      const dur = Date.now() - start;
      const usage = (err as any)?.usage;
      const response = (err as any)?.response;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      logger.warn(
        `❌ [llm] fail op=${op} model=${modelId} 🔢 in=${usage?.inputTokens ?? '-'} out=${usage?.outputTokens ?? '-'} total=${usage?.totalTokens ?? '-'} ⏱️ ${dur}ms reason=${(err as any)?.code ?? (err as any)?.name ?? 'error'}`,
      );
      throw err;
    }
  };

  return withConcurrency(() => withRetry(exec, retry), { key: concurrency?.key ?? op, maxConcurrency: concurrency?.maxConcurrency });
}

/**
 * Single-call structured output generation with tool calling enabled.
 *
 * Uses AI SDK structured `output` to parse a Zod/JSON schema object from the
 * model response while still allowing tool calls across multiple steps.
 */
export async function callObjectWithTools<T>({
  model,
  system,
  prompt,
  schema,
  tools,
  maxSteps,
  temperature = 0.3,
  abortSignal,
  op = 'agent.object',
  concurrency,
  retry,
  providerOptions,
}: LlmOptions & {
  prompt: string;
  schema: any;
  tools: any;
  maxSteps?: number;
}) {
  const exec = async () => {
    const start = Date.now();
    const promptChars = prompt?.length ?? 0;
    const systemChars = system?.length ?? 0;
    const modelLabelStart = typeof model === 'string' ? model : 'unknown';
    logger.info(
      `🚀 [llm] start op=${op} model=${modelLabelStart} prompt=${promptChars} chars sys=${systemChars} temp=${temperature} steps=${maxSteps ?? '-'}`,
    );

    try {
      const result = await generateText({
        model,
        system,
        prompt,
        temperature,
        tools,
        // Structured output adds an extra step after tool calls to produce the final object.
        stopWhen: stepCountIs((maxSteps ?? 5) + 1),
        output: Output.object({ schema }),
        abortSignal,
        providerOptions,
      } as any);

      const { output, usage, totalUsage, response, steps, toolCalls, toolResults } = result as any;
      const dur = Date.now() - start;
      const modelId = (response && (response as any).modelId) || modelLabelStart;

      const u = totalUsage ?? usage;
      logger.info(
        `✅ [llm] done op=${op} model=${modelId} 🔢 in=${u?.inputTokens ?? '-'} out=${u?.outputTokens ?? '-'} total=${u?.totalTokens ?? '-'} ⏱️ ${dur}ms steps=${Array.isArray(steps) ? steps.length : '-'}`,
      );

      return {
        object: output as T,
        usage: u,
        steps,
        toolCalls,
        toolResults,
      };
    } catch (err) {
      const dur = Date.now() - start;
      const usage = (err as any)?.usage;
      const response = (err as any)?.response;
      const modelId = (response && (response as any).modelId) || modelLabelStart;
      logger.warn(
        `❌ [llm] fail op=${op} model=${modelId} 🔢 in=${usage?.inputTokens ?? '-'} out=${usage?.outputTokens ?? '-'} total=${usage?.totalTokens ?? '-'} ⏱️ ${dur}ms reason=${(err as any)?.code ?? (err as any)?.name ?? 'error'}`,
      );
      throw err;
    }
  };

  return withConcurrency(() => withRetry(exec, retry), {
    key: concurrency?.key ?? op,
    maxConcurrency: concurrency?.maxConcurrency,
  });
}
