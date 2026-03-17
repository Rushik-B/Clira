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
  resolveExecAgentThinkingLevel,
} from './constants';
import {
  buildTerminalFallbackResponse,
  collectExecutedToolNames,
  collectOutOfPackToolNames,
  collectToolNamesFromExecution,
  extractRequestedPackIdsFromExecution,
  extractRequestedMcpConnectionIdsFromExecution,
  resolveProgressChannel,
  resolveRetrievalProfile,
  stripInternalMetadataFromAssistantResponse,
  stopWhenToolCalled,
  wrapToolsWithTimingMetadata,
} from './helpers';
import {
  buildExecutiveAgentPrompt,
  EXECUTIVE_AGENT_PROMPT_VERSION,
  resolveUserCalendarTimezone,
} from './prompt';
import { runSteerableTextWithTools, type SteerRunContext } from './steerableLoop';
import { buildExecutiveAgentTools } from './tools';
import {
  expandExposurePlanForRepair,
  extractExecutiveTurnFeatures,
  hasDeterministicActionIntent,
  selectExecutiveToolPackForTurn,
} from './selector';
import { buildExecutiveMcpPromptFragments } from './mcp/promptFragments';
import {
  EXECUTIVE_AGENT_PACK_VERSION,
  getActionPackRequestSummary,
  listRequestableActionPackIds,
} from './toolPacks';
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
import {
  buildHarnessMetadata,
  buildOrchestrationMetadata,
  summarizeMcpServersForLogs,
  summarizeToolInventoryForLogs,
} from './diagnostics';
import type {
  ExecutiveAgentInput,
  ExecutiveAgentOutput,
  ToolExposurePlan,
  ExecutiveTurnFeatures,
  PendingCalendarChangeRecord,
  ToolPackId,
} from './types';
import {
  listSelectableMcpServerPacks,
  resolveMcpToolExposure,
} from '@/lib/services/mcp/policy/service';

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
    let primaryPack: ToolPackId | null = null;
    let packIds: ToolPackId[] = [];
    let exposureReasons: string[] = [];
    let turnFeatures: ExecutiveTurnFeatures | null = null;
    let mcpToolExposure: Awaited<ReturnType<typeof resolveMcpToolExposure>> | null = null;
    let workingStateController: ReturnType<typeof createWorkingStateController> | null = null;
    let steerMetadata: Prisma.InputJsonValue | null = null;
    let repairAttempted = false;
    let repairReason: string | null = null;
    let repairExpandedPacks: ToolPackId[] = [];
    let repairExpandedMcpConnectionIds: string[] = [];

    try {
      const resolvedUserTimezone = await resolveUserCalendarTimezone(input.userId);
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
      const pendingTimezone = pendingRecord?.userTimezone || resolvedUserTimezone;
      const pendingCalendarInstruction = pendingRecord && pendingPayload
        ? `Active pending calendar change exists (pendingId=${pendingRecord.id}, action=${pendingPayload.plan.action}, expiresAt=${formatDateTimeInTimeZone(pendingRecord.expiresAt, pendingTimezone)}).`
        : pendingRecord
          ? `Active pending calendar change exists (pendingId=${pendingRecord.id}), but its details need to be re-planned before execution.`
          : 'No active pending calendar change exists.';

      const activeTurnFeatures = extractExecutiveTurnFeatures({
        input,
        pendingCalendarChangePresent: Boolean(pendingRecord),
      });
      turnFeatures = activeTurnFeatures;
      const requestableActionPackIds = listRequestableActionPackIds(activeTurnFeatures);
      const selectableMcpServerPacks = await listSelectableMcpServerPacks({
        userId: input.userId,
        channel: activeTurnFeatures.channel,
      });
      let exposurePlan = await selectExecutiveToolPackForTurn({
        input,
        features: activeTurnFeatures,
        mcpServerPacks: selectableMcpServerPacks,
      });

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
      const stopConditions = [
        stopWhenToolCalled('send_email'),
        stopWhenToolCalled('plan_calendar_change'),
        stopWhenToolCalled('commit_calendar_change'),
        stopWhenToolCalled('request_tool_pack_exposure'),
        stopWhenToolCalled('request_mcp_server_tools'),
        stopWhenToolCalled('plan_mcp_action'),
        stopWhenToolCalled('commit_mcp_action'),
        stopWhenToolCalled('cancel_mcp_action'),
      ];

      const isNotificationFlow =
        input.userRequest.startsWith('REMINDER DELIVERY:') ||
        input.userRequest.startsWith('ALERT NOTIFICATION:');
      const providerOptions = isNotificationFlow
        ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
        : { google: { thinkingConfig: { thinkingLevel: resolveExecAgentThinkingLevel() } } };

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
      const executePass = async (plan: ToolExposurePlan, passIndex: number) => {
        input.runContext?.setSelectedPack?.(plan.primaryPack);
        primaryPack = plan.primaryPack;
        packIds = plan.packIds;
        exposureReasons = plan.reasons;

        const activeMcpToolExposure = await resolveMcpToolExposure({
          userId: input.userId,
          conversationId: input.conversationId,
          channel: resolvedChannel,
          selectedConnectionIds: plan.mcpConnectionIds,
        });
        mcpToolExposure = activeMcpToolExposure;

        const mcpServersForLogs = summarizeMcpServersForLogs(
          activeMcpToolExposure,
          plan.mcpConnectionIds,
        );
        const mcpPromptFragments = buildExecutiveMcpPromptFragments(
          activeMcpToolExposure,
          selectableMcpServerPacks,
        );
        const actionPackSummaryLines = requestableActionPackIds
          .filter((packId) => !plan.packIds.includes(packId))
          .map((packId) => `${packId}: ${getActionPackRequestSummary(packId)}`);

        logger.info('[executiveAgent] harness.selection', {
          passIndex,
          primaryPack,
          packIds,
          mcpServers: mcpServersForLogs,
          exposureReasons,
          repairAttempted: plan.repairAttempted,
          draftCandidatePresent: activeTurnFeatures.draftCandidatePresent,
          draftCandidateReason: activeTurnFeatures.draftCandidateReason,
          pendingCalendarChangePresent: activeTurnFeatures.pendingCalendarChangePresent,
          hasRecentPendingCalendarPreview: activeTurnFeatures.hasRecentPendingCalendarPreview,
          classifierDecision: input.runContext?.classifierDecision ?? null,
          channel: activeTurnFeatures.channel,
        });

        workingStateController = createWorkingStateController(
          createInitialWorkingState({
            goal: input.userRequest,
            selectedPack: plan.primaryPack,
            features: activeTurnFeatures,
            pendingCalendarChangeId: pendingRecord?.id,
          }),
        );

        const promptContext = await buildExecutiveAgentPrompt(input, resolvedChannel, {
          pendingCalendarInstruction,
          harnessReminders: [
            ...plan.reminders,
            ...mcpPromptFragments.reminderLines,
          ],
          actionPackSummaryLines,
          mcpToolSummaryLines: mcpPromptFragments.toolSummaryLines,
          mcpDegradedSummaryLines: mcpPromptFragments.degradedSummaryLines,
          mcpAvailableServerLines: mcpPromptFragments.availableServerLines,
        });
        const {
          systemPrompt: promptSystemPrompt,
          messages,
          userTimezone,
          currentTimeUtc,
          currentTimeUserTz,
          dayOfWeek,
        } = promptContext;

        const tools = buildExecutiveAgentTools({
          input,
          channel: resolvedChannel,
          retrievalProfile,
          selectedPack: plan.primaryPack,
          selectedPacks: plan.packIds,
          exposureReasons: plan.reasons,
          turnFeatures: activeTurnFeatures,
          userTimezone,
          currentTimeUtc,
          currentTimeUserTz,
          dayOfWeek,
          toolAbort: toolAbort!,
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
          mcpToolExposure: activeMcpToolExposure,
          mcpSelectableServerPacks: selectableMcpServerPacks,
          requestableActionPackIds,
        });

        logger.info('[executiveAgent] harness.pack_tools', {
          passIndex,
          primaryPack,
          packIds,
          ...summarizeToolInventoryForLogs({
            tools,
            mcpServers: mcpServersForLogs,
          }),
        });
        const availableToolNames = Object.keys(tools);

        const activeToolBudgets = Object.fromEntries(
          Object.keys(tools).map((toolName) => [
            toolName,
            MESSAGING_TOOL_BUDGETS_BASE[toolName] ?? 15,
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
            passIndex,
            primaryPack: plan.primaryPack,
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
        let responseSource: 'model' | 'synthesis' | 'fallback' = 'model';
        if (
          !response &&
          steps.length > 0 &&
          Array.isArray(messagesWhenEmpty) &&
          messagesWhenEmpty.length > 0
        ) {
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
              responseSource = 'synthesis';
              logger.info(`[executiveAgent] Synthesis produced reply (was empty)`);
            }
          } catch (err) {
            logger.warn(`[executiveAgent] Synthesis failed, using fallback`, { err });
          }
        }
        if (!response) {
          response = buildTerminalFallbackResponse(toolResults, steps, {
            selectedPack: plan.primaryPack,
            workingState: workingStateController?.getState() ?? null,
            turnFeatures,
          });
          responseSource = 'fallback';
          logger.info(`[executiveAgent] Empty model text, using fallback: ${response}`);
        }
        const sanitizedResponse = stripInternalMetadataFromAssistantResponse(response);
        if (sanitizedResponse.stripped) {
          logger.warn('[executiveAgent] Stripped leaked internal metadata from assistant response');
        }
        if (sanitizedResponse.claimedToolHistoryNames.length > 0) {
          const actualToolNames = collectToolNamesFromExecution({ toolCalls, toolResults, steps });
          const fabricated = sanitizedResponse.claimedToolHistoryNames.filter(
            (name) => !actualToolNames.has(name),
          );
          if (fabricated.length > 0) {
            logger.error('[executiveAgent] FABRICATED_TOOL_HISTORY: model claimed tool usage that did not occur', {
              fabricatedToolNames: fabricated,
              claimedToolHistory: sanitizedResponse.claimedToolHistoryNames,
              actualToolNames: Array.from(actualToolNames),
              primaryPack: plan.primaryPack,
              packIds: plan.packIds,
            });
          }
        }
        response = sanitizedResponse.response;
        if (!response) {
          response = buildTerminalFallbackResponse(toolResults, steps, {
            selectedPack: plan.primaryPack,
            workingState: workingStateController?.getState() ?? null,
            turnFeatures,
          });
          responseSource = 'fallback';
          logger.warn(`[executiveAgent] Sanitized response became empty, using fallback: ${response}`);
        }
        workingStateController.updateFromResponse(response);

        if (!(await isRunCurrent())) {
          throw new Error('superseded_by_newer_message');
        }

        return {
          response,
          responseSource,
          toolCalls,
          toolResults,
          steps,
          toolBudget,
          toolResultCacheStats,
          toolNames,
          outOfPackToolNames,
          selectedConnectionIds: activeMcpToolExposure.selectedConnectionIds,
          workingState: workingStateController.getState(),
        };
      };

      let passResult = await executePass(exposurePlan, 1);
      const requestedPackIds = extractRequestedPackIdsFromExecution({
        toolResults: passResult.toolResults,
        steps: passResult.steps,
      }).filter((packId) => !exposurePlan.packIds.includes(packId));
      const requestedMcpConnectionIds = extractRequestedMcpConnectionIdsFromExecution({
        toolResults: passResult.toolResults,
        steps: passResult.steps,
      }).filter((connectionId) => !exposurePlan.mcpConnectionIds.includes(connectionId));

      if (requestedPackIds.length > 0) {
        repairAttempted = true;
        repairReason = 'requested_tool_pack_exposure';
        repairExpandedPacks = requestedPackIds;
        exposurePlan = {
          ...exposurePlan,
          primaryPack: requestedPackIds[0] ?? exposurePlan.primaryPack,
          packIds: Array.from(
            new Set([...exposurePlan.packIds, ...requestedPackIds]),
          ),
          repairAttempted: true,
        };

        logger.info('[executiveAgent] harness.action_pack_rerun', {
          repairReason,
          repairExpandedPacks,
        });

        passResult = await executePass(exposurePlan, 2);
      } else if (requestedMcpConnectionIds.length > 0) {
        repairAttempted = true;
        repairReason = 'requested_mcp_server_tools';
        repairExpandedMcpConnectionIds = requestedMcpConnectionIds;
        exposurePlan = {
          ...exposurePlan,
          mcpConnectionIds: Array.from(
            new Set([...exposurePlan.mcpConnectionIds, ...requestedMcpConnectionIds]),
          ),
          repairAttempted: true,
        };

        logger.info('[executiveAgent] harness.mcp_selection_rerun', {
          repairReason,
          repairExpandedMcpConnectionIds,
        });

        passResult = await executePass(exposurePlan, 2);
      } else {
        const zeroToolActionStall =
          passResult.toolNames.size === 0 &&
          hasDeterministicActionIntent(activeTurnFeatures) &&
          passResult.responseSource !== 'model';

        if (passResult.outOfPackToolNames.size > 0 || zeroToolActionStall) {
          repairAttempted = true;
          repairReason =
            passResult.outOfPackToolNames.size > 0
              ? 'out_of_pack_tool_reference'
              : 'zero_tool_action_stall';

          const repairExpansion = await expandExposurePlanForRepair({
            input,
            features: activeTurnFeatures,
            plan: exposurePlan,
            outOfPackToolNames: [...passResult.outOfPackToolNames],
            reason:
              passResult.outOfPackToolNames.size > 0
                ? 'missing_tools'
                : 'action_intent_stall',
            mcpServerPacks: selectableMcpServerPacks,
          });

          repairExpandedPacks = repairExpansion.expandedPackIds;
          repairExpandedMcpConnectionIds = repairExpansion.expandedMcpConnectionIds;
          exposurePlan = repairExpansion.plan;

          logger.info('[executiveAgent] harness.repair_rerun', {
            repairReason,
            repairExpandedPacks,
            repairExpandedMcpConnectionIds,
          });

          passResult = await executePass(exposurePlan, 2);
        }
      }

      const metadata: Record<string, Prisma.InputJsonValue> = {};
      if (Array.isArray(passResult.toolCalls) && passResult.toolCalls.length > 0) {
        metadata.toolCalls = passResult.toolCalls as Prisma.InputJsonValue;
      }
      if (Array.isArray(passResult.toolResults) && passResult.toolResults.length > 0) {
        metadata.toolResults = stripCacheDebugMetadataForPersistence(
          passResult.toolResults,
        ) as Prisma.InputJsonValue;
      }
      if (Array.isArray(passResult.steps) && passResult.steps.length > 0) {
        metadata.steps = stripCacheDebugMetadataForPersistence(
          passResult.steps,
        ) as Prisma.InputJsonValue;
      }
      if (passResult.toolBudget) {
        metadata.toolBudget = passResult.toolBudget as Prisma.InputJsonValue;
      }
      if (passResult.toolResultCacheStats) {
        metadata.toolResultCacheStats = passResult.toolResultCacheStats as Prisma.InputJsonValue;
      }
      const harnessMetadata = buildHarnessMetadata({
        primaryPack,
        packIds,
        mcpConnectionIds: passResult.selectedConnectionIds,
        exposureReasons,
        repairAttempted,
        repairReason,
        repairExpandedPacks,
        repairExpandedMcpConnectionIds,
        workingState: passResult.workingState,
        promptVersion: EXECUTIVE_AGENT_PROMPT_VERSION,
        packVersion: EXECUTIVE_AGENT_PACK_VERSION,
      });
      if (harnessMetadata) {
        metadata.harness = harnessMetadata;
      }
      const orchestrationMetadata = buildOrchestrationMetadata({
        runContext: input.runContext,
        steerMetadata,
      });
      if (orchestrationMetadata) {
        metadata.orchestration = orchestrationMetadata;
      }
      const traceMetadata = buildAiTraceMetadata(input.traceContext);
      if (traceMetadata) {
        metadata.trace = traceMetadata.trace as Prisma.InputJsonValue;
      }

      return {
        response: passResult.response,
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
      const currentWorkingStateController =
        workingStateController as ReturnType<typeof createWorkingStateController> | null;
      const currentMcpToolExposure =
        mcpToolExposure as Awaited<ReturnType<typeof resolveMcpToolExposure>> | null;
      currentWorkingStateController?.markFailed();

      const metadata: Record<string, Prisma.InputJsonValue> = {};
      const harnessMetadata = buildHarnessMetadata({
        primaryPack,
        packIds,
        mcpConnectionIds: currentMcpToolExposure?.selectedConnectionIds ?? [],
        exposureReasons,
        repairAttempted,
        repairReason,
        repairExpandedPacks,
        repairExpandedMcpConnectionIds,
        workingState: currentWorkingStateController?.getState() ?? null,
        promptVersion: EXECUTIVE_AGENT_PROMPT_VERSION,
        packVersion: EXECUTIVE_AGENT_PACK_VERSION,
      });
      if (harnessMetadata) {
        metadata.harness = harnessMetadata;
      }
      const orchestrationMetadata = buildOrchestrationMetadata({
        runContext: input.runContext,
        steerMetadata,
      });
      if (orchestrationMetadata) {
        metadata.orchestration = orchestrationMetadata;
      }

      return {
        response: isDeadline
          ? 'I hit a time limit. Should I check your inbox or your calendar?'
          : buildTerminalFallbackResponse([], [], {
              selectedPack: primaryPack,
              workingState: currentWorkingStateController?.getState() ?? null,
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
