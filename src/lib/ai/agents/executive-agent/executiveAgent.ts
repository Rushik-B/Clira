import {
  callTextWithTools,
  createDeadlineController,
} from '@/lib/ai/callLlm';
import { LlmError } from '@/lib/ai/errors';
import { models } from '@/lib/ai/models';
import {
  type Prisma,
  PendingCalendarChangeStatus,
} from '@prisma/client';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  parsePendingCalendarChangeRecord,
} from '@/lib/ai/agents/executiveCalendarMutationHelpers';
import {
  MESSAGING_DEADLINE_MS,
  MESSAGING_MAX_STEPS,
  MESSAGING_MAX_TOOL_CALLS_TOTAL,
  MESSAGING_TOOL_BUDGETS_BASE,
} from './constants';
import {
  buildTerminalFallbackResponse,
  collectToolNamesFromExecution,
  resolveProgressChannel,
  resolveRetrievalProfile,
  stopWhenToolCalled,
  wrapToolsWithTimingMetadata,
} from './helpers';
import { buildExecutiveAgentPrompt } from './prompt';
import { buildExecutiveAgentTools } from './tools';
import type {
  ExecutiveAgentInput,
  ExecutiveAgentOutput,
  PendingCalendarChangeRecord,
} from './types';

export class ExecutiveAgent {
  async process(input: ExecutiveAgentInput): Promise<ExecutiveAgentOutput> {
    let memoryStored = false;
    const resolvedChannel = input.channel ?? resolveProgressChannel(input);
    const retrievalProfile = resolveRetrievalProfile(resolvedChannel);
    const isRunCurrent = async () => {
      if (!input.runContext?.isRunCurrent) return true;
      return input.runContext.isRunCurrent();
    };
    const isBurstStable = () => {
      if (!input.runContext?.isBurstStable) return true;
      return input.runContext.isBurstStable();
    };

    let toolAbort: ReturnType<typeof createDeadlineController> | undefined;

    try {
      const promptContext = await buildExecutiveAgentPrompt(input, resolvedChannel);
      const { prompt, userTimezone, currentTimeUtc, currentTimeUserTz, dayOfWeek } = promptContext;
      const pendingRecordForPrompt = await prisma.pendingCalendarChange.findFirst({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          status: PendingCalendarChangeStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          plan: true,
          resolvedTarget: true,
          userTimezone: true,
          userRequest: true,
          expiresAt: true,
          status: true,
          createdAt: true,
        },
      });
      const pendingPayloadForPrompt = pendingRecordForPrompt
        ? parsePendingCalendarChangeRecord(pendingRecordForPrompt as PendingCalendarChangeRecord)
        : null;
      const pendingCalendarInstruction = pendingRecordForPrompt && pendingPayloadForPrompt
        ? `Active pending calendar change exists (pendingId=${pendingRecordForPrompt.id}, action=${pendingPayloadForPrompt.plan.action}, expiresAt=${pendingRecordForPrompt.expiresAt.toISOString()}).`
        : 'No active pending calendar change exists.';

      toolAbort = createDeadlineController({
        abortSignal: input.abortSignal,
        deadlineMs: MESSAGING_DEADLINE_MS,
      });
      const toolAbortSignal = toolAbort.signal ?? input.abortSignal;

      const tools = buildExecutiveAgentTools({
        input,
        channel: resolvedChannel,
        retrievalProfile,
        userTimezone,
        currentTimeUtc,
        currentTimeUserTz,
        dayOfWeek,
        toolAbort,
        toolAbortSignal,
        isRunCurrent,
        isBurstStable,
        onMemoryStored: () => {
          memoryStored = true;
        },
      });

      const startTime = Date.now();
      let lastProgressSentAt = 0;

      const timedTools = wrapToolsWithTimingMetadata({
        tools,
        agentStartedAt: startTime,
        timeLeftMs: () => toolAbort!.timeLeftMs(),
        getLastProgressSentAt: () => lastProgressSentAt,
        setLastProgressSentAt: (sentAt: number) => {
          lastProgressSentAt = sentAt;
        },
        isRunCurrent,
      });

      const systemPrompt =
        'You are Clira, an Executive AI Agent helping the user over messaging. ' +
        'You are warm, casual, confident, and high-agency (like a top-tier human EA). ' +
        'NEVER sound robotic or use phrases like "as an AI" or "I don\'t have feelings". ' +
        'Keep responses SHORT by default. Ask clarifying questions only when truly needed. ' +
        'Be proactive and decisive ("want me to send it now?"). ' +
        '**TIME AWARENESS (CRITICAL):** Always be aware of the CURRENT time shown in the prompt context. ' +
        'If the last message was sent hours or days ago, you are responding at a DIFFERENT time. ' +
        'Pay attention to: (1) What time of day it is NOW (morning/afternoon/evening/night), ' +
        '(2) What day it is NOW (today, not yesterday), (3) How much time has passed since the last message. ' +
        'If it\'s a new day or significantly different time, acknowledge it naturally (e.g., "Good morning" if it\'s morning after a night conversation, or "Hey" if it\'s been a while). ' +
        'Learn the user over time: call append_to_supermemory (1) when they reveal names, roles, preferences, or facts, and (2) when you discover accurate, high-confidence facts from your tools (inbox, calendar)—e.g. you find who their professor or manager is from emails/calendar. Don\'t rely only on what the user says. ' +
        'When the user asks a recall question (e.g. "what\'s my stat prof\'s name?", "who\'s my manager?"), call search_memory first; only say you don\'t know if search returns nothing. ' +
        'Use send_progress_update naturally like texting a friend: ' +
        'when you need to dig deeper after a weak first result, ' +
        'when you\'re adding another tool (e.g., checking calendar after inbox), ' +
        'or when the request clearly needs multiple steps. ' +
        'Tool results include _timing (elapsed_ms, ms_since_last_progress_update, time_left_ms). If ms_since_last_progress_update > 15000 and you plan another tool call, send a quick progress update first. ' +
        'Avoid robotic "starting search" updates and never mention tool names. ' +
        'When drafting emails: gather context first (search_inbox_context, calendar, memory), then propose the draft to the user. ' +
        'For analytical or quantitative questions over emails (totals, counts, patterns, aggregations), use search_inbox_context with mode=deep, then analyze the evidence and report. ' +
        'ONLY call send_email after the user explicitly says "yes", "send it", "go ahead", or similar clear approval. NEVER assume permission. The email will be SENT IMMEDIATELY. ' +
        `Pending calendar state: ${pendingCalendarInstruction} ` +
        'Calendar change workflow: ' +
        '(1) If no pending change exists: call plan_calendar_change to create one. For move/reschedule requests, call plan_calendar_change ONCE with the complete plan (all events and new times). Do not call it again to refine unless the user explicitly asks for changes. ' +
        '(2) If a pending change exists and user confirms (approvals: "yes", "yessirr", "yup", "yeah", "sure", "send it", "confirm", "do it", "lock it in", "go ahead"): call commit_calendar_change with decision="confirm". DO NOT call plan_calendar_change again. ' +
        '(3) If a pending change exists and user declines ("no", "cancel", "don\'t"): call commit_calendar_change with decision="cancel". ' +
        '(4) If a pending change exists but approval is ambiguous: ask a short confirmation question WITHOUT calling plan_calendar_change again. ' +
        'NEVER call plan_calendar_change when an active pending change already exists unless the user explicitly requests a modification to the plan. If (and only if) they explicitly request a modification, call plan_calendar_change with forceNewPlan=true. ' +
        'Use search_memory when the user asks to recall something about themselves or their contacts. ' +
        'If asked directly whether you\'re an AI, be honest but don\'t volunteer it. ' +
        'If conversation goes off-topic, politely redirect: "noted, but let\'s tackle that inbox!" ' +
        'Latency discipline is critical: decide the minimum context needed before calling tools. ' +
        'Tool strategy (do this silently): ' +
        '(1) If the request is about schedule/events/availability, use ONE calendar tool first (search_calendar for events; check_calendar only for free/busy/scheduling). ' +
        '(2) For plan_calendar_change that moves or reschedules specific events: call search_calendar exactly ONCE with one combined query (all event names) and one date range, then call plan_calendar_change with resolvedEvents from that single result. Never use 2+ search_calendar calls for the same plan. Do not call plan_calendar_change without resolvedEvents when the plan updates named events. ' +
        '(3) If the request is about finding/summarizing emails, use ONE inbox search first (quick for lookup, deep for aggregation). ' +
        '(4) Only use ONE fallback tool if it meaningfully improves the answer. ' +
        'Do not repeat a tool call unless the user provides new constraints in the same message. Do not use search_calendar with generic queries like "*" when you already have a sufficient result. ' +
        'If a tool returns empty results or a budget limit, ask ONE clarifying question and stop.';

      const stopConditions = [stopWhenToolCalled('send_email')];

      const isNotificationFlow =
        input.userRequest.startsWith('REMINDER DELIVERY:') ||
        input.userRequest.startsWith('ALERT NOTIFICATION:');
      const providerOptions = isNotificationFlow
        ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
        : undefined;

      const { text, toolCalls, toolResults, steps, toolBudget } = await callTextWithTools({
        model: models.execAgent(),
        system: systemPrompt,
        prompt,
        tools: timedTools,
        maxSteps: MESSAGING_MAX_STEPS,
        maxToolCallsTotal: MESSAGING_MAX_TOOL_CALLS_TOTAL,
        maxToolCallsPerTool: MESSAGING_TOOL_BUDGETS_BASE,
        deadlineMs: MESSAGING_DEADLINE_MS,
        stopWhen: stopConditions,
        temperature: 0.7,
        op: `${resolvedChannel}.executive`,
        concurrency: { key: `${resolvedChannel}.executive`, maxConcurrency: 4 },
        retry: { maxAttempts: 3, baseDelayMs: 500 },
        abortSignal: toolAbortSignal,
        providerOptions,
      });

      const toolNames = collectToolNamesFromExecution({ toolCalls, toolResults, steps });
      logger.info(`[executiveAgent] Tools used: ${Array.from(toolNames).join(', ') || '(none)'}`);
      logger.info(
        `[executiveAgent] Completed in ${Date.now() - startTime}ms totalTools=${toolBudget?.totalCalls ?? 0}`,
      );

      let response = (text || '').trim();
      if (!response) {
        response = buildTerminalFallbackResponse(toolResults);
        logger.info(`[executiveAgent] Empty model text, using fallback: ${response}`);
      }

      if (!(await isRunCurrent())) {
        throw new Error('superseded_by_newer_message');
      }

      const metadata: Record<string, Prisma.InputJsonValue> = {};
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        metadata.toolCalls = toolCalls as Prisma.InputJsonValue;
      }
      if (Array.isArray(toolResults) && toolResults.length > 0) {
        metadata.toolResults = toolResults as Prisma.InputJsonValue;
      }
      if (Array.isArray(steps) && steps.length > 0) {
        metadata.steps = steps as Prisma.InputJsonValue;
      }
      if (toolBudget) {
        metadata.toolBudget = toolBudget as Prisma.InputJsonValue;
      }
      if (input.runContext) {
        metadata.orchestration = {
          runId: input.runContext.runId,
          burstId: input.runContext.burstId,
          classifierDecision: input.runContext.classifierDecision ?? null,
          queueOverflowSummary:
            (input.runContext.droppedSummary ?? []).length > 0
              ? {
                  droppedCount: (input.runContext.droppedSummary ?? []).length,
                  droppedMessages: input.runContext.droppedSummary ?? [],
                }
              : null,
        } as Prisma.InputJsonValue;
      }

      return {
        response,
        memoryStored,
        status: 'ok',
        metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonObject) : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const isAbort =
        (error instanceof LlmError && error.code === 'abort') ||
        (error instanceof Error &&
          (error.name === 'AbortError' || /aborted|abort|cancel|superseded/i.test(message)));
      const isDeadline = /deadline exceeded/i.test(message);

      if (isAbort && !isDeadline) {
        logger.debug(`[executiveAgent] Run aborted: ${message}`);
        throw error;
      }

      logger.error(`[executiveAgent] Error: ${message}`);

      return {
        response: isDeadline
          ? 'I hit a time limit. Should I check your inbox or your calendar?'
          : "Hmm, something went wrong on my end. Can you try that again?",
        memoryStored: false,
        status: 'fallback',
        error: message,
      };
    } finally {
      toolAbort?.cleanup();
    }
  }
}

let _agentInstance: ExecutiveAgent | null = null;

export function getExecutiveAgent(): ExecutiveAgent {
  if (!_agentInstance) {
    _agentInstance = new ExecutiveAgent();
  }
  return _agentInstance;
}
