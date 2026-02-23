import crypto from 'crypto';
import { logger } from '@/lib/logger';
import {
  buildConversationKey,
  readBurstState,
  updateBurstState,
} from './stateStore';
import { classifyMessageRelevance } from './relevanceClassifier';
import { emitOrchestratorEvent } from './observability';
import type {
  BurstState,
  FinalizeResult,
  FinalizeRunParams,
  OrchestrationDecision,
  OrchestrationChannel,
  PrepareRunParams,
  RelevanceClassification,
  RunContext,
} from './types';
import {
  EA_FOLLOWUP_CONFIDENCE_MAX,
  EA_LONG_TASK_PROGRESS_MS,
  EA_MICRO_BUFFER_MS,
  EA_QUEUE_CAP,
  EA_STEER_WINDOW_MS,
  EA_SUPERSEDE_CONFIDENCE_MIN,
} from './types';

type LocalRunRecord = {
  runId: string;
  revision: number;
  burstId: string;
  channel: OrchestrationChannel;
  conversationId: string;
  conversationKey: string;
  abortController: AbortController;
  startedAt: number;
  windowEndsAt: number;
  hasQueuedFollowup: boolean;
  classifierDecision: RelevanceClassification['decision'] | null;
  droppedSummary: string[];
  stale: boolean;
};

const localRuns = new Map<string, LocalRunRecord>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUserRequest(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : value;
}

function summarizeDroppedMessage(message: string): string {
  const collapsed = message.trim().replace(/\s+/g, ' ');
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

function isEnabled(channel: OrchestrationChannel): boolean {
  if (process.env.EA_ORCHESTRATOR_V2 === 'false') {
    return false;
  }

  const channelOverride = process.env[`EA_ORCHESTRATOR_V2_${channel.toUpperCase()}`];
  if (channelOverride === 'false') {
    return false;
  }

  return true;
}

function shouldSupersede(decision: RelevanceClassification): boolean {
  if (decision.decision === 'supersede') {
    return decision.confidence >= EA_SUPERSEDE_CONFIDENCE_MIN;
  }

  if (decision.decision === 'followup') {
    return decision.confidence <= EA_FOLLOWUP_CONFIDENCE_MAX;
  }

  return false;
}

function isBenignStartConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === 'orchestration_revision_mismatch' ||
    error.message === 'orchestration_active_run_exists'
  );
}

function applyInboundToState(
  state: BurstState,
  userRequest: string,
): BurstState {
  const now = Date.now();
  const next = { ...state };

  if (!next.activeRunId && now > next.windowEndsAt) {
    next.burstId = crypto.randomUUID();
    next.pendingCount = 0;
    next.droppedSummary = [];
    next.queuedIntentText = null;
    next.queuedRevision = null;
  }

  next.revision += 1;
  next.windowEndsAt = now + EA_STEER_WINDOW_MS;
  next.pendingCount += 1;

  if (next.pendingCount > EA_QUEUE_CAP) {
    next.pendingCount = EA_QUEUE_CAP;
    next.droppedSummary = [
      ...next.droppedSummary.slice(-(EA_QUEUE_CAP - 1)),
      summarizeDroppedMessage(userRequest),
    ];
  }

  return next;
}

function markLocalRunQueued(
  conversationKey: string,
  runId: string,
  windowEndsAt: number,
): void {
  const active = localRuns.get(conversationKey);
  if (!active || active.runId !== runId) return;

  active.hasQueuedFollowup = true;
  active.windowEndsAt = windowEndsAt;
}

function clearLocalRun(conversationKey: string, runId: string): void {
  const active = localRuns.get(conversationKey);
  if (!active || active.runId !== runId) return;
  localRuns.delete(conversationKey);
}

function abortLocalRun(
  conversationKey: string,
  runId: string,
  reason: string,
): void {
  const active = localRuns.get(conversationKey);
  if (!active || active.runId !== runId) return;

  active.stale = true;
  active.abortController.abort(reason);
  localRuns.delete(conversationKey);
}

function buildRunContext(record: LocalRunRecord): RunContext {
  return {
    runId: record.runId,
    burstId: record.burstId,
    revision: record.revision,
    channel: record.channel,
    conversationId: record.conversationId,
    conversationKey: record.conversationKey,
    classifierDecision: record.classifierDecision,
    droppedSummary: record.droppedSummary,
    abortSignal: record.abortController.signal,
    isRunCurrent: async () => {
      const local = localRuns.get(record.conversationKey);
      if (!local || local.runId !== record.runId || local.stale) {
        return false;
      }

      if (!isEnabled(record.channel)) {
        return true;
      }

      const state = await readBurstState(record.conversationKey);
      return state.activeRunId === record.runId && state.activeRevision === record.revision;
    },
    isBurstStable: () => {
      const local = localRuns.get(record.conversationKey);
      if (!local || local.runId !== record.runId || local.stale) {
        return false;
      }

      return Date.now() >= local.windowEndsAt && !local.hasQueuedFollowup;
    },
    canEmitProgress: () => {
      const local = localRuns.get(record.conversationKey);
      if (!local || local.runId !== record.runId || local.stale) {
        return false;
      }

      return (
        (Date.now() >= local.windowEndsAt && !local.hasQueuedFollowup) ||
        Date.now() - local.startedAt >= EA_LONG_TASK_PROGRESS_MS
      );
    },
  };
}

function registerLocalRun(params: {
  channel: OrchestrationChannel;
  conversationId: string;
  conversationKey: string;
  runId: string;
  revision: number;
  burstId: string;
  windowEndsAt: number;
  classifierDecision: RelevanceClassification['decision'] | null;
  droppedSummary: string[];
}): RunContext {
  const previous = localRuns.get(params.conversationKey);
  if (previous && previous.runId !== params.runId) {
    emitOrchestratorEvent('orchestrator.run.superseded', {
      channel: params.channel,
      conversationId: params.conversationId,
      conversationKey: params.conversationKey,
      supersededRunId: previous.runId,
      replacementRunId: params.runId,
      reason: 'superseded_by_new_run',
    });
    abortLocalRun(params.conversationKey, previous.runId, 'superseded_by_new_run');
  }

  const record: LocalRunRecord = {
    runId: params.runId,
    revision: params.revision,
    burstId: params.burstId,
    channel: params.channel,
    conversationId: params.conversationId,
    conversationKey: params.conversationKey,
    abortController: new AbortController(),
    startedAt: Date.now(),
    windowEndsAt: params.windowEndsAt,
    hasQueuedFollowup: false,
    classifierDecision: params.classifierDecision,
    droppedSummary: [...params.droppedSummary],
    stale: false,
  };

  localRuns.set(params.conversationKey, record);
  return buildRunContext(record);
}

export class MessagingOrchestrator {
  async prepareRun(params: PrepareRunParams): Promise<OrchestrationDecision> {
    const channel = params.channel;
    const conversationId = params.conversationId;
    const conversationKey = buildConversationKey(channel, conversationId);
    const userRequest = normalizeUserRequest(params.userRequest);

    if (!isEnabled(channel)) {
      const runId = crypto.randomUUID();
      const runContext = registerLocalRun({
        channel,
        conversationId,
        conversationKey,
        runId,
        revision: Date.now(),
        burstId: crypto.randomUUID(),
        windowEndsAt: Date.now(),
        classifierDecision: null,
        droppedSummary: [],
      });

      return {
        kind: 'start',
        runContext,
        userRequest,
      };
    }

    const { previous: stateBeforeInbound, current: stateAfterInbound } = await updateBurstState(conversationKey, (state) =>
      applyInboundToState(state, userRequest),
    );

    if (stateBeforeInbound.burstId !== stateAfterInbound.burstId) {
      emitOrchestratorEvent('orchestrator.burst.started', {
        channel,
        conversationId,
        conversationKey,
        burstId: stateAfterInbound.burstId,
        revision: stateAfterInbound.revision,
      });
    }

    if (stateAfterInbound.droppedSummary.length > stateBeforeInbound.droppedSummary.length) {
      const overflowEntries = stateAfterInbound.droppedSummary.slice(
        stateBeforeInbound.droppedSummary.length,
      );
      emitOrchestratorEvent('orchestrator.queue.overflow_summary', {
        channel,
        conversationId,
        conversationKey,
        burstId: stateAfterInbound.burstId,
        droppedCount: stateAfterInbound.droppedSummary.length,
        overflowAdded: overflowEntries.length,
        overflowSummary: overflowEntries,
      });
    }

    if (params.isCommand) {
      const activeRunId = stateAfterInbound.activeRunId;
      if (activeRunId) {
        emitOrchestratorEvent('orchestrator.run.superseded', {
          channel,
          conversationId,
          conversationKey,
          supersededRunId: activeRunId,
          reason: 'command_bypass',
        });
        abortLocalRun(conversationKey, activeRunId, 'superseded_by_command');
      }

      const start = await this.startRun({
        channel,
        conversationId,
        conversationKey,
        userRequest,
        expectedRevision: stateAfterInbound.revision,
        forceReplace: true,
      }).catch((error) => {
        if (isBenignStartConflict(error)) {
          return null;
        }
        throw error;
      });

      if (!start) {
        return {
          kind: 'skip',
          reason: 'superseded_by_newer_message',
        };
      }

      return {
        kind: 'start',
        runContext: start.runContext,
        userRequest,
      };
    }

    if (stateAfterInbound.activeRunId) {
      const classifierDecision = await classifyMessageRelevance({
        activeIntentText: stateAfterInbound.latestIntentText,
        incomingText: userRequest,
      });

      emitOrchestratorEvent('orchestrator.classifier.decision', {
        channel,
        conversationId,
        conversationKey,
        runId: stateAfterInbound.activeRunId,
        decision: classifierDecision.decision,
        confidence: classifierDecision.confidence,
        explanation: classifierDecision.explanation,
      });

      if (shouldSupersede(classifierDecision)) {
        emitOrchestratorEvent('orchestrator.run.superseded', {
          channel,
          conversationId,
          conversationKey,
          supersededRunId: stateAfterInbound.activeRunId,
          reason: 'classifier_supersede',
          decision: classifierDecision.decision,
          confidence: classifierDecision.confidence,
        });
        abortLocalRun(
          conversationKey,
          stateAfterInbound.activeRunId,
          'superseded_by_newer_message',
        );

        const start = await this.startRun({
          channel,
          conversationId,
          conversationKey,
          userRequest,
          expectedRevision: stateAfterInbound.revision,
          forceReplace: true,
          classifierDecision,
        }).catch((error) => {
          if (isBenignStartConflict(error)) {
            return null;
          }
          throw error;
        });

        if (!start) {
          return {
            kind: 'skip',
            reason: 'superseded_by_newer_message',
            classifierDecision,
          };
        }

        return {
          kind: 'start',
          runContext: start.runContext,
          userRequest,
          classifierDecision,
        };
      }

      await updateBurstState(conversationKey, (state) => ({
        ...state,
        classifierDecision: classifierDecision.decision,
        queuedIntentText: userRequest,
        queuedRevision: state.revision,
      }));

      markLocalRunQueued(
        conversationKey,
        stateAfterInbound.activeRunId,
        stateAfterInbound.windowEndsAt,
      );

      return {
        kind: 'skip',
        reason: 'queued_followup',
        classifierDecision,
      };
    }

    await sleep(EA_MICRO_BUFFER_MS);

    const currentState = await readBurstState(conversationKey);
    if (currentState.revision !== stateAfterInbound.revision || currentState.activeRunId) {
      return {
        kind: 'skip',
        reason: 'superseded_by_newer_message',
      };
    }

    const start = await this.startRun({
      channel,
      conversationId,
      conversationKey,
      userRequest,
      expectedRevision: stateAfterInbound.revision,
      forceReplace: false,
    }).catch((error) => {
      if (isBenignStartConflict(error)) {
        return null;
      }
      throw error;
    });

    if (!start) {
      return {
        kind: 'skip',
        reason: 'superseded_by_newer_message',
      };
    }

    return {
      kind: 'start',
      runContext: start.runContext,
      userRequest,
    };
  }

  async finalizeRun(params: FinalizeRunParams): Promise<FinalizeResult> {
    const runContext = params.runContext;
    const conversationKey = runContext.conversationKey;

    if (!isEnabled(runContext.channel)) {
      clearLocalRun(conversationKey, runContext.runId);
      return {};
    }

    const state = await readBurstState(conversationKey);
    if (state.activeRunId !== runContext.runId || state.activeRevision !== runContext.revision) {
      clearLocalRun(conversationKey, runContext.runId);
      return {};
    }

    const queuedText = state.queuedIntentText?.trim() || null;
    const queuedRevision = state.queuedRevision;

    if (queuedText && queuedRevision && queuedRevision > runContext.revision) {
      const start = await this.startRun({
        channel: runContext.channel,
        conversationId: runContext.conversationId,
        conversationKey,
        userRequest: queuedText,
        expectedRevision: state.revision,
        forceReplace: true,
        nextBurstId: crypto.randomUUID(),
      }).catch((error) => {
        if (isBenignStartConflict(error)) {
          return null;
        }
        throw error;
      });

      clearLocalRun(conversationKey, runContext.runId);
      if (!start) {
        return {};
      }

      return {
        nextRun: {
          runContext: start.runContext,
          userRequest: queuedText,
        },
      };
    }

    await updateBurstState(conversationKey, (current) => {
      if (current.activeRunId !== runContext.runId || current.activeRevision !== runContext.revision) {
        return current;
      }

      return {
        ...current,
        activeRunId: null,
        activeRevision: null,
        classifierDecision: null,
        pendingCount: 0,
      };
    });

    clearLocalRun(conversationKey, runContext.runId);
    return {};
  }

  private async startRun(params: {
    channel: OrchestrationChannel;
    conversationId: string;
    conversationKey: string;
    userRequest: string;
    expectedRevision: number;
    forceReplace: boolean;
    classifierDecision?: RelevanceClassification;
    nextBurstId?: string;
  }): Promise<{ runContext: RunContext }> {
    const runId = crypto.randomUUID();

    const { current } = await updateBurstState(params.conversationKey, (state) => {
      if (state.revision !== params.expectedRevision) {
        throw new Error('orchestration_revision_mismatch');
      }

      if (state.activeRunId && !params.forceReplace) {
        throw new Error('orchestration_active_run_exists');
      }

      return {
        ...state,
        burstId: params.nextBurstId ?? state.burstId,
        activeRunId: runId,
        activeRevision: state.revision,
        latestIntentText: params.userRequest,
        classifierDecision: params.classifierDecision?.decision ?? state.classifierDecision,
        pendingCount: 0,
        queuedIntentText: null,
        queuedRevision: null,
      };
    });

    const runContext = registerLocalRun({
      channel: params.channel,
      conversationId: params.conversationId,
      conversationKey: params.conversationKey,
      runId,
      revision: current.activeRevision ?? current.revision,
      burstId: current.burstId,
      windowEndsAt: current.windowEndsAt,
      classifierDecision: current.classifierDecision,
      droppedSummary: current.droppedSummary,
    });

    if (params.nextBurstId) {
      emitOrchestratorEvent('orchestrator.burst.started', {
        channel: params.channel,
        conversationId: params.conversationId,
        conversationKey: params.conversationKey,
        burstId: current.burstId,
        revision: current.activeRevision ?? current.revision,
        reason: 'queued_followup',
      });
    }

    logger.info('[messagingOrchestration] run started', {
      conversationKey: params.conversationKey,
      runId,
      burstId: current.burstId,
      revision: current.activeRevision ?? current.revision,
    });

    return { runContext };
  }
}

let orchestratorInstance: MessagingOrchestrator | null = null;

export function getMessagingOrchestrator(): MessagingOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new MessagingOrchestrator();
  }

  return orchestratorInstance;
}
