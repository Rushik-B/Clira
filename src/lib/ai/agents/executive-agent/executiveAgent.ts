import {
  callTextWithMessages,
  callTextWithTools,
  createDeadlineController,
} from '@/lib/ai/callLlm';
import { LlmError } from '@/lib/ai/errors';
import { models } from '@/lib/ai/models';
import {
  isNativeSteeringEnabled,
  requireNativeSteeringRuntime,
  resolveNativeSteeringRuntime,
} from '@/lib/ai/runtime/steeringRuntime';
import {
  isCooperativeSteeringEnabled,
} from '@/lib/services/messaging-orchestration/steeringConfig';
import {
  type Prisma,
  PendingCalendarChangeStatus,
} from '@prisma/client';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  parsePendingCalendarChangeRecord,
} from '@/lib/ai/agents/executiveCalendarMutationHelpers';
import { formatDateTimeInTimeZone } from '@/lib/utils/timezone';
import {
  MESSAGING_DEADLINE_MS,
  MESSAGING_MAX_STEPS,
  MESSAGING_MAX_TOOL_CALLS_TOTAL,
  MESSAGING_TOOL_BUDGETS_BASE,
} from './constants';
import {
  buildTerminalFallbackResponse,
  collectExecutedToolNames,
  collectOutOfPackToolNames,
  resolveProgressChannel,
  resolveRetrievalProfile,
  stripInternalMetadataFromAssistantResponse,
  stripUndefined,
  stopWhenToolCalled,
  wrapToolsWithTimingMetadata,
} from './helpers';
import {
  buildExecutiveAgentPrompt,
  EXECUTIVE_AGENT_PROMPT_VERSION,
} from './prompt';
import { runSteerableTextWithTools, type SteerRunContext } from './steerableLoop';
import { buildExecutiveAgentTools } from './tools';
import {
  extractExecutiveTurnFeatures,
  resolveTurnFeaturesWithSelection,
  selectExecutiveToolPackForTurn,
} from './selector';
import { buildExecutiveMcpPromptFragments } from './mcp/promptFragments';
import { EXECUTIVE_AGENT_PACK_VERSION } from './toolPacks';
import {
  createExecutiveToolResultReuseCache,
  isAppendToSupermemorySuccessful,
  isCommitCalendarChangeSuccessful,
  type ExecutiveToolResultCacheStats,
} from './toolResultReuseCache';
import { stripCacheDebugMetadataForPersistence } from './persistence';
import { normalizeExecutiveAgentToolsForModel } from './tool-schema-normalization';
import { createInitialWorkingState, createWorkingStateController } from './workingState';
import {
  buildAiTraceMetadata,
  wrapToolsWithAiTracing,
} from '@/lib/ai/tracing';
import type {
  ExecutiveAgentInput,
  ExecutiveAgentOutput,
  ExecutiveTurnFeatures,
  PendingCalendarChangeRecord,
  ToolPackId,
} from './types';
import { resolveMcpToolExposure } from '@/lib/services/mcp/policy/service';

export class ExecutiveAgent {
  async process(input: ExecutiveAgentInput): Promise<ExecutiveAgentOutput> {
    let memoryStored = false;
    const toolResultCacheStatsReader: {
      read?: () => ExecutiveToolResultCacheStats;
    } = {};
    const resolvedChannel = resolveProgressChannel(input);
    const retrievalProfile = resolveRetrievalProfile(resolvedChannel);
    const toolResultCache = createExecutiveToolResultReuseCache({
      conversationHistory: input.conversationHistory,
    });
    const isRunCurrent = async () => {
      if (!input.runContext?.isRunCurrent) return true;
      return input.runContext.isRunCurrent();
    };
    const isBurstStable = () => {
      if (!input.runContext?.isBurstStable) return true;
      return input.runContext.isBurstStable();
    };

    let toolAbort: ReturnType<typeof createDeadlineController> | undefined;
    let selectedPack: ToolPackId | null = null;
    let selectedPacks: ToolPackId[] = [];
    let selectorReasons: string[] = [];
    let turnFeatures: ExecutiveTurnFeatures | null = null;
    let mcpToolExposure: Awaited<ReturnType<typeof resolveMcpToolExposure>> | null = null;
    let workingStateController: ReturnType<typeof createWorkingStateController> | null = null;
    let steerMetadata: Prisma.InputJsonValue | null = null;

    const buildHarnessMetadata = (): Prisma.InputJsonValue | undefined => {
      if (!selectedPack || !workingStateController) {
        return undefined;
      }

      return stripUndefined({
          selectedPack,
          selectedPacks,
          capabilityIntents: mcpToolExposure?.capabilityIntents ?? [],
          selectorReasons,
          workingState: workingStateController.getState(),
          promptVersion: EXECUTIVE_AGENT_PROMPT_VERSION,
          packVersion: EXECUTIVE_AGENT_PACK_VERSION,
        }) as unknown as Prisma.InputJsonValue;
    };

    const buildOrchestrationMetadata = (): Prisma.InputJsonValue | undefined => {
      if (!input.runContext) {
        return undefined;
      }

      return {
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
        steer: steerMetadata,
      } as Prisma.InputJsonValue;
    };

    try {
      const pendingRecord = await prisma.pendingCalendarChange.findFirst({
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
      const pendingPayload = pendingRecord
        ? parsePendingCalendarChangeRecord(pendingRecord as PendingCalendarChangeRecord)
        : null;
      const pendingTimezone = pendingRecord?.userTimezone || userTimezone;
      const pendingCalendarInstruction = pendingRecord && pendingPayload
        ? `Active pending calendar change exists (pendingId=${pendingRecord.id}, action=${pendingPayload.plan.action}, expiresAt=${formatDateTimeInTimeZone(pendingRecord.expiresAt, pendingTimezone)}).`
        : pendingRecord
          ? `Active pending calendar change exists (pendingId=${pendingRecord.id}), but its details need to be re-planned before execution.`
          : 'No active pending calendar change exists.';

      const activeTurnFeatures = extractExecutiveTurnFeatures({
        input,
        pendingCalendarChangePresent: Boolean(pendingRecord),
      });
      // Pack selection uses the LLM selector when available. Safety-critical
      // flows can still bypass it deterministically, but selector outages now
      // expose every pack and rely on downstream tool gating.
      const selection = await selectExecutiveToolPackForTurn({
        input,
        features: activeTurnFeatures,
      });
      const resolvedTurnFeatures = resolveTurnFeaturesWithSelection({
        features: activeTurnFeatures,
        selection,
      });
      turnFeatures = resolvedTurnFeatures;
      const activePack = selection.packId;
      const activePacks = selection.packIds;
      input.runContext?.setSelectedPack?.(activePack);
      selectedPack = activePack;
      selectedPacks = activePacks;
      selectorReasons = selection.reasons;
      mcpToolExposure = await resolveMcpToolExposure({
        userId: input.userId,
        conversationId: input.conversationId,
        channel: resolvedChannel,
        capabilityIntents: selection.capabilityIntents,
      });
      const mcpPromptFragments = buildExecutiveMcpPromptFragments(mcpToolExposure);

      logger.info('[executiveAgent] harness.selection', {
        selectedPack,
        selectedPacks,
        capabilityIntents: selection.capabilityIntents,
        selectorReasons,
        draftCandidatePresent: resolvedTurnFeatures.draftCandidatePresent,
        draftCandidateReason: resolvedTurnFeatures.draftCandidateReason,
        pendingCalendarChangePresent: resolvedTurnFeatures.pendingCalendarChangePresent,
        hasRecentPendingCalendarPreview: resolvedTurnFeatures.hasRecentPendingCalendarPreview,
        pendingCalendarModifyIntent: resolvedTurnFeatures.pendingCalendarModifyIntent,
        classifierDecision: input.runContext?.classifierDecision ?? null,
        channel: resolvedTurnFeatures.channel,
      });

      workingStateController = createWorkingStateController(
        createInitialWorkingState({
          goal: input.userRequest,
          selectedPack: activePack,
          features: resolvedTurnFeatures,
          pendingCalendarChangeId: pendingRecord?.id,
        }),
      );

      const promptContext = await buildExecutiveAgentPrompt(input, resolvedChannel, {
        pendingCalendarInstruction,
        harnessReminders: [
          ...selection.reminders,
          ...mcpPromptFragments.reminderLines,
        ],
        mcpCapabilitySummaryLines: mcpPromptFragments.capabilitySummaryLines,
        mcpDegradedSummaryLines: mcpPromptFragments.degradedSummaryLines,
      });
      const {
        systemPrompt: promptSystemPrompt,
        messages,
        userTimezone,
        currentTimeUtc,
        currentTimeUserTz,
        dayOfWeek,
      } = promptContext;

      toolAbort = createDeadlineController({
        abortSignal: input.abortSignal,
        deadlineMs: MESSAGING_DEADLINE_MS,
      });
      const toolAbortSignal = toolAbort.signal ?? input.abortSignal;

      const startTime = Date.now();
      let lastProgressSentAt = 0;

      const hasPendingSteer = async () => {
        if (typeof input.runContext?.hasPendingSteer !== 'function') return false;
        return input.runContext.hasPendingSteer(0);
      };

      const tools = buildExecutiveAgentTools({
        input,
        channel: resolvedChannel,
        retrievalProfile,
        selectedPack: activePack,
        selectedPacks: activePacks,
        selectorReasons,
        turnFeatures: resolvedTurnFeatures,
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
        onToolResult: (toolName, result) => {
          workingStateController?.updateFromToolResult(toolName, result);
        },
        registerToolResultCacheStatsReader: (readStats) => {
          toolResultCacheStatsReader.read = readStats;
        },
        toolResultCache,
        mcpToolExposure,
      });

      logger.info('[executiveAgent] harness.pack_tools', {
        selectedPack,
        toolCount: Object.keys(tools).length,
        tools: Object.keys(tools),
      });
      const availableToolNames = Object.keys(tools);

      const activeToolBudgets = Object.fromEntries(
        Object.keys(tools).map((toolName) => [
          toolName,
          MESSAGING_TOOL_BUDGETS_BASE[toolName] ?? 1,
        ]),
      );

      const timedTools = wrapToolsWithTimingMetadata({
        tools,
        agentStartedAt: startTime,
        timeLeftMs: () => toolAbort!.timeLeftMs(),
        getLastProgressSentAt: () => lastProgressSentAt,
        setLastProgressSentAt: (sentAt: number) => {
          lastProgressSentAt = sentAt;
        },
        isRunCurrent,
        hasPendingSteer,
        onToolResult: (toolName, args, result, observedAtMs) => {
          workingStateController?.updateFromToolResult(toolName, result);

          if (
            toolName === 'append_to_supermemory' &&
            isAppendToSupermemorySuccessful(result)
          ) {
            toolResultCache.noteMutation('append_to_supermemory', observedAtMs);
            return;
          }

          if (
            toolName === 'commit_calendar_change' &&
            isCommitCalendarChangeSuccessful(args, result)
          ) {
            toolResultCache.noteMutation('commit_calendar_change', observedAtMs);
            return;
          }

          if (
            toolName === 'commit_mcp_action' &&
            result != null &&
            typeof result === 'object' &&
            (result as Record<string, unknown>).ok === true
          ) {
            toolResultCache.noteMcpMutation(observedAtMs);
          }
        },
      });
      const tracedTools = wrapToolsWithAiTracing(input.traceContext, timedTools);
      const modelTools = normalizeExecutiveAgentToolsForModel(
        tracedTools as Record<string, any>,
      );

      const stopConditions = [
        stopWhenToolCalled('send_email'),
        stopWhenToolCalled('plan_calendar_change'),
        stopWhenToolCalled('commit_calendar_change'),
        stopWhenToolCalled('plan_mcp_action'),
        stopWhenToolCalled('commit_mcp_action'),
        stopWhenToolCalled('cancel_mcp_action'),
      ];

      const isNotificationFlow =
        input.userRequest.startsWith('REMINDER DELIVERY:') ||
        input.userRequest.startsWith('ALERT NOTIFICATION:');
      const providerOptions = isNotificationFlow
        ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
        : undefined;

      const nativeSteerEnabled = isNativeSteeringEnabled(resolvedChannel);
      if (nativeSteerEnabled) {
        requireNativeSteeringRuntime(resolveNativeSteeringRuntime(), {
          op: `${resolvedChannel}.executive`,
        });
      }

      const canCooperativeSteer =
        typeof input.runContext?.consumeSteerEvents === 'function' &&
        typeof input.runContext?.markRunPhase === 'function' &&
        isCooperativeSteeringEnabled(resolvedChannel);

      const exec = canCooperativeSteer
        ? await runSteerableTextWithTools({
            model: models.execAgent(),
            system: promptSystemPrompt,
            messages,
            tools: modelTools,
            timeLeftMs: () => toolAbort!.timeLeftMs(),
            maxSteps: MESSAGING_MAX_STEPS,
            maxToolCallsTotal: MESSAGING_MAX_TOOL_CALLS_TOTAL,
            maxToolCallsPerTool: activeToolBudgets,
            deadlineMs: MESSAGING_DEADLINE_MS,
            stopWhen: stopConditions,
            temperature: 0.7,
            op: `${resolvedChannel}.executive`,
            concurrency: { key: `${resolvedChannel}.executive`, maxConcurrency: 4 },
            retry: { maxAttempts: 3, baseDelayMs: 500 },
            abortSignal: toolAbortSignal,
            providerOptions,
            runContext: input.runContext as unknown as SteerRunContext,
            traceContext: input.traceContext,
          })
        : await callTextWithTools({
            model: models.execAgent(),
            system: promptSystemPrompt,
            messages,
            tools: modelTools,
            maxSteps: MESSAGING_MAX_STEPS,
            maxToolCallsTotal: MESSAGING_MAX_TOOL_CALLS_TOTAL,
            maxToolCallsPerTool: activeToolBudgets,
            deadlineMs: MESSAGING_DEADLINE_MS,
            stopWhen: stopConditions,
            temperature: 0.7,
            op: `${resolvedChannel}.executive`,
            concurrency: { key: `${resolvedChannel}.executive`, maxConcurrency: 4 },
            retry: { maxAttempts: 3, baseDelayMs: 500 },
            abortSignal: toolAbortSignal,
            providerOptions,
            traceContext: input.traceContext,
          });

      const { text, toolCalls, toolResults, steps, toolBudget } = exec;
      const messagesWhenEmpty =
        exec && typeof exec === 'object' && 'messagesWhenEmpty' in exec
          ? (exec as { messagesWhenEmpty?: unknown[] }).messagesWhenEmpty
          : undefined;
      steerMetadata =
        exec && typeof exec === 'object' && 'steer' in exec
          ? ((exec as { steer?: Prisma.InputJsonValue }).steer ?? null)
          : null;

      const toolNames = collectExecutedToolNames({
        toolCalls,
        toolResults,
        steps,
        toolBudget,
        availableToolNames,
      });
      const outOfPackToolNames = collectOutOfPackToolNames({
        toolCalls,
        toolResults,
        steps,
        availableToolNames,
      });
      if (outOfPackToolNames.size > 0) {
        logger.warn('[executiveAgent] Model trace referenced out-of-pack tools', {
          selectedPack,
          availableTools: availableToolNames,
          outOfPackTools: Array.from(outOfPackToolNames),
        });
      }
      logger.info(`[executiveAgent] Tools used: ${Array.from(toolNames).join(', ') || '(none)'}`);
      logger.info(
        `[executiveAgent] Completed in ${Date.now() - startTime}ms totalTools=${toolBudget?.totalCalls ?? 0}`,
      );
      const toolResultCacheStats = toolResultCacheStatsReader.read
        ? toolResultCacheStatsReader.read()
        : undefined;
      if (toolResultCacheStats) {
        logger.info(`[executiveAgent] Tool result cache stats: ${JSON.stringify(toolResultCacheStats)}`);
      }

      let response = (text || '').trim();
      if (!response && steps.length > 0 && Array.isArray(messagesWhenEmpty) && messagesWhenEmpty.length > 0) {
        const synthesisSystem =
          (promptSystemPrompt ?? '') +
          '\n\n[SYSTEM: The user is waiting for a reply. Produce a brief, direct response based on the tool results above. If results were poor or inconclusive, say so and offer to try again. Your reply must be non-empty.]';
        try {
          const synthesis = await callTextWithMessages({
            model: models.execAgent(),
            system: synthesisSystem,
            messages: messagesWhenEmpty,
            temperature: 0.3,
            abortSignal: toolAbortSignal,
            op: `${resolvedChannel}.executive.synthesis`,
            concurrency: { key: `${resolvedChannel}.executive`, maxConcurrency: 4 },
            retry: { maxAttempts: 3, baseDelayMs: 500 },
            providerOptions,
            traceContext: input.traceContext,
          });
          const synthesized = (synthesis.text || '').trim();
          if (synthesized) {
            response = synthesized;
            logger.info(`[executiveAgent] Synthesis produced reply (was empty)`);
          }
        } catch (err) {
          logger.warn(`[executiveAgent] Synthesis failed, using fallback`, { err });
        }
      }
      if (!response) {
        response = buildTerminalFallbackResponse(toolResults, steps, {
          selectedPack,
          workingState: workingStateController?.getState() ?? null,
          turnFeatures,
        });
        logger.info(`[executiveAgent] Empty model text, using fallback: ${response}`);
      }
      const sanitizedResponse = stripInternalMetadataFromAssistantResponse(response);
      if (sanitizedResponse.stripped) {
        logger.warn('[executiveAgent] Stripped leaked internal metadata from assistant response');
      }
      response = sanitizedResponse.response;
      if (!response) {
        response = buildTerminalFallbackResponse(toolResults, steps, {
          selectedPack,
          workingState: workingStateController?.getState() ?? null,
          turnFeatures,
        });
        logger.warn(`[executiveAgent] Sanitized response became empty, using fallback: ${response}`);
      }
      workingStateController.updateFromResponse(response);

      if (!(await isRunCurrent())) {
        throw new Error('superseded_by_newer_message');
      }

      const metadata: Record<string, Prisma.InputJsonValue> = {};
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        metadata.toolCalls = toolCalls as Prisma.InputJsonValue;
      }
      if (Array.isArray(toolResults) && toolResults.length > 0) {
        metadata.toolResults = stripCacheDebugMetadataForPersistence(toolResults) as Prisma.InputJsonValue;
      }
      if (Array.isArray(steps) && steps.length > 0) {
        metadata.steps = stripCacheDebugMetadataForPersistence(steps) as Prisma.InputJsonValue;
      }
      if (toolBudget) {
        metadata.toolBudget = toolBudget as Prisma.InputJsonValue;
      }
      if (toolResultCacheStats) {
        metadata.toolResultCacheStats = toolResultCacheStats as Prisma.InputJsonValue;
      }
      const harnessMetadata = buildHarnessMetadata();
      if (harnessMetadata) {
        metadata.harness = harnessMetadata;
      }
      const orchestrationMetadata = buildOrchestrationMetadata();
      if (orchestrationMetadata) {
        metadata.orchestration = orchestrationMetadata;
      }
      const traceMetadata = buildAiTraceMetadata(input.traceContext);
      if (traceMetadata) {
        metadata.trace = traceMetadata.trace as Prisma.InputJsonValue;
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
      workingStateController?.markFailed();

      const metadata: Record<string, Prisma.InputJsonValue> = {};
      const harnessMetadata = buildHarnessMetadata();
      if (harnessMetadata) {
        metadata.harness = harnessMetadata;
      }
      const orchestrationMetadata = buildOrchestrationMetadata();
      if (orchestrationMetadata) {
        metadata.orchestration = orchestrationMetadata;
      }

      return {
        response: isDeadline
          ? 'I hit a time limit. Should I check your inbox or your calendar?'
          : buildTerminalFallbackResponse([], [], {
              selectedPack,
              workingState: workingStateController?.getState() ?? null,
              turnFeatures,
            }),
        memoryStored,
        status: 'fallback',
        error: message,
        metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonObject) : undefined,
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
