import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { classifyMessageRelevance } from './relevanceClassifier';
import { emitOrchestratorEvent } from './observability';
import {
  ensureAdapterChannel,
} from './channelAdapters';
import type {
  BurstState,
  ChannelAdapter,
  ConsumeSteerEventsResult,
  FinalizeResult,
  FinalizeRunParams,
  OrchestrationDecision,
  OrchestrationChannel,
  PrepareRunParams,
  RelevanceClassification,
  RunContext,
  RunPhase,
  SteerEvent,
} from './types';
import {
  EA_FOLLOWUP_CONFIDENCE_MAX,
  EA_LONG_TASK_PROGRESS_MS,
  EA_MICRO_BUFFER_MS,
  EA_QUEUE_CAP,
  EA_STEER_WINDOW_MS,
  EA_SUPERSEDE_CONFIDENCE_MIN,
} from './types';
import {
  getSteerMailboxCap,
  isCooperativeSteeringEnabled,
  shouldSteerInRun,
} from './steeringConfig';

type OrchestratorEventName = Parameters<typeof emitOrchestratorEvent>[0];
type OrchestratorEventPayload = Parameters<typeof emitOrchestratorEvent>[1];

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
  runPhase: RunPhase;
  stale: boolean;
};

type MessagingOrchestratorDependencies = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  createId: () => string;
  readState: (conversationKey: string) => Promise<BurstState>;
  updateState: (
    conversationKey: string,
    updater: (state: BurstState) => BurstState,
  ) => Promise<{ previous: BurstState; current: BurstState }>;
  classify: typeof classifyMessageRelevance;
  emitEvent: (event: OrchestratorEventName, payload: OrchestratorEventPayload) => void;
};

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

function shouldQueueAsExplicitFollowup(
  decision: RelevanceClassification,
  incomingText: string,
): boolean {
  if (decision.decision !== 'followup') return false;
  if (decision.confidence < 0.85) return false;

  const normalized = incomingText.trim().toLowerCase();
  if (!normalized) return false;

  const explicitSeparateTaskPatterns = [
    /\bseparately\b/,
    /\bseparate (task|request|question)\b/,
    /\bnew (task|request|question)\b/,
    /\banother (task|request|question)\b/,
    /\bdifferent (task|request|question|topic)\b/,
    /\bunrelated\b/,
    /\bafter (that|this)\b/,
    /\bonce (that|this) is done\b/,
    /\bwhen you(?:'re| are) done\b/,
  ];

  return explicitSeparateTaskPatterns.some((pattern) => pattern.test(normalized));
}

function isBenignStartConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === 'orchestration_revision_mismatch' ||
    error.message === 'orchestration_active_run_exists'
  );
}

function buildConversationKey(
  channel: OrchestrationChannel,
  conversationId: string,
): string {
  return `${channel}:${conversationId}`;
}

async function defaultReadState(conversationKey: string): Promise<BurstState> {
  const { readBurstState } = await import('./stateStore');
  return readBurstState(conversationKey);
}

async function defaultUpdateState(
  conversationKey: string,
  updater: (state: BurstState) => BurstState,
): Promise<{ previous: BurstState; current: BurstState }> {
  const { updateBurstState } = await import('./stateStore');
  return updateBurstState(conversationKey, updater);
}

export class MessagingOrchestrator {
  private readonly deps: MessagingOrchestratorDependencies;

  private readonly localRuns = new Map<string, LocalRunRecord>();

  constructor(overrides: Partial<MessagingOrchestratorDependencies> = {}) {
    this.deps = {
      now: Date.now,
      sleep,
      createId: () => crypto.randomUUID(),
      readState: defaultReadState,
      updateState: defaultUpdateState,
      classify: classifyMessageRelevance,
      emitEvent: emitOrchestratorEvent,
      ...overrides,
    };
  }

  async prepareRunWithAdapter(params: {
    adapter: Pick<ChannelAdapter, 'channel' | 'conversationId'>;
    userRequest: string;
    isCommand?: boolean;
  }): Promise<OrchestrationDecision> {
    const conversationId = params.adapter.conversationId();
    ensureAdapterChannel(params.adapter.channel, params.adapter);

    return this.prepareRun({
      channel: params.adapter.channel,
      conversationId,
      userRequest: params.userRequest,
      isCommand: params.isCommand,
    });
  }

  async prepareRun(params: PrepareRunParams): Promise<OrchestrationDecision> {
    const channel = params.channel;
    const conversationId = params.conversationId;
    const conversationKey = buildConversationKey(channel, conversationId);
    const userRequest = normalizeUserRequest(params.userRequest);

    if (!isEnabled(channel)) {
      const runId = this.deps.createId();
      const runContext = this.registerLocalRun({
        channel,
        conversationId,
        conversationKey,
        runId,
        revision: this.deps.now(),
        burstId: this.deps.createId(),
        windowEndsAt: this.deps.now(),
        classifierDecision: null,
        droppedSummary: [],
        runPhase: 'running',
      });

      return {
        kind: 'start',
        runContext,
        userRequest,
      };
    }

    const { previous: stateBeforeInbound, current: stateAfterInbound } = await this.deps.updateState(
      conversationKey,
      (state) => this.applyInboundToState(state, userRequest),
    );

    if (stateBeforeInbound.burstId !== stateAfterInbound.burstId) {
      this.deps.emitEvent('orchestrator.burst.started', {
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
      this.deps.emitEvent('orchestrator.queue.overflow_summary', {
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
        this.deps.emitEvent('orchestrator.run.superseded', {
          channel,
          conversationId,
          conversationKey,
          supersededRunId: activeRunId,
          reason: 'command_bypass',
        });
        this.abortLocalRun(conversationKey, activeRunId, 'superseded_by_command');
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
      const classifierDecision = await this.deps.classify({
        activeIntentText: stateAfterInbound.latestIntentText,
        incomingText: userRequest,
      });

      this.deps.emitEvent('orchestrator.classifier.decision', {
        channel,
        conversationId,
        conversationKey,
        runId: stateAfterInbound.activeRunId,
        decision: classifierDecision.decision,
        confidence: classifierDecision.confidence,
        explanation: classifierDecision.explanation,
      });

      if (shouldSupersede(classifierDecision)) {
        this.deps.emitEvent('orchestrator.run.superseded', {
          channel,
          conversationId,
          conversationKey,
          supersededRunId: stateAfterInbound.activeRunId,
          reason: 'classifier_supersede',
          decision: classifierDecision.decision,
          confidence: classifierDecision.confidence,
        });
        this.abortLocalRun(
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

      const cooperativeSteeringEnabled = isCooperativeSteeringEnabled(channel);
      const activeRunPhase = stateAfterInbound.activeRunPhase ?? 'running';
      const steerCandidateDecision = shouldSteerInRun(classifierDecision, { runPhase: 'running' });
      const explicitFollowupQueue = shouldQueueAsExplicitFollowup(
        classifierDecision,
        userRequest,
      );

      if (
        cooperativeSteeringEnabled &&
        steerCandidateDecision &&
        !explicitFollowupQueue &&
        activeRunPhase === 'commit_boundary'
      ) {
        this.deps.emitEvent('orchestrator.steer.blocked_commit_boundary', {
          channel,
          conversationId,
          conversationKey,
          runId: stateAfterInbound.activeRunId,
          burstId: stateAfterInbound.burstId,
          runPhase: activeRunPhase,
          decision: classifierDecision.decision,
          confidence: classifierDecision.confidence,
        });

        this.deps.emitEvent('orchestrator.run.superseded', {
          channel,
          conversationId,
          conversationKey,
          supersededRunId: stateAfterInbound.activeRunId,
          reason: 'steer_blocked_commit_boundary',
          decision: classifierDecision.decision,
          confidence: classifierDecision.confidence,
        });
        this.abortLocalRun(
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

      if (
        cooperativeSteeringEnabled &&
        steerCandidateDecision &&
        !explicitFollowupQueue &&
        activeRunPhase === 'running'
      ) {
        const cap = getSteerMailboxCap();
        const appendedAt = this.deps.now();
        let steerPersisted = false;
        const { current } = await this.deps.updateState(conversationKey, (state) => {
          if (state.activeRunId !== stateAfterInbound.activeRunId) {
            return state;
          }
          if (state.activeRevision !== stateAfterInbound.activeRevision) {
            return state;
          }

          steerPersisted = true;
          const nextSeq = (state.steerSeq ?? 0) + 1;
          const nextEvent: SteerEvent = {
            seq: nextSeq,
            revision: state.revision,
            receivedAt: appendedAt,
            text: userRequest,
            decision: classifierDecision.decision,
            confidence: classifierDecision.confidence,
          };

          const mailbox = Array.isArray(state.steerMailbox) ? [...state.steerMailbox, nextEvent] : [nextEvent];
          const droppedSummary = Array.isArray(state.steerDroppedSummary) ? [...state.steerDroppedSummary] : [];

          if (mailbox.length > cap) {
            const overflow = mailbox.splice(0, mailbox.length - cap);
            for (const dropped of overflow) {
              droppedSummary.push(summarizeDroppedMessage(dropped.text));
            }
          }

          return {
            ...state,
            classifierDecision: classifierDecision.decision,
            latestIntentText: classifierDecision.latestIntentText,
            steerSeq: nextSeq,
            steerMailbox: mailbox,
            steerDroppedSummary: droppedSummary,
          };
        });

        if (steerPersisted) {
          this.deps.emitEvent('orchestrator.steer.enqueued', {
            channel,
            conversationId,
            conversationKey,
            runId: stateAfterInbound.activeRunId,
            burstId: current.burstId,
            runPhase: activeRunPhase,
            seq: current.steerSeq,
            cap,
            mailboxSize: current.steerMailbox.length,
            droppedSummaryCount: current.steerDroppedSummary.length,
          });

          this.markLocalRunSteered(conversationKey, stateAfterInbound.activeRunId, stateAfterInbound.windowEndsAt);

          return {
            kind: 'skip',
            reason: 'steered_in_run',
            classifierDecision,
          };
        }

        const latestState = await this.deps.readState(conversationKey);
        if (latestState.revision !== stateAfterInbound.revision) {
          return {
            kind: 'skip',
            reason: 'superseded_by_newer_message',
            classifierDecision,
          };
        }

        if (latestState.activeRunId) {
          await this.deps.updateState(conversationKey, (state) => {
            if (state.revision !== stateAfterInbound.revision || !state.activeRunId) {
              return state;
            }
            return {
              ...state,
              classifierDecision: classifierDecision.decision,
              queuedIntentText: userRequest,
              queuedRevision: state.revision,
            };
          });

          this.markLocalRunQueued(
            conversationKey,
            latestState.activeRunId,
            latestState.windowEndsAt,
          );

          return {
            kind: 'skip',
            reason: 'queued_followup',
            classifierDecision,
          };
        }

        const start = await this.startRun({
          channel,
          conversationId,
          conversationKey,
          userRequest,
          expectedRevision: latestState.revision,
          forceReplace: false,
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

      await this.deps.updateState(conversationKey, (state) => ({
        ...state,
        classifierDecision: classifierDecision.decision,
        queuedIntentText: userRequest,
        queuedRevision: state.revision,
      }));

      this.markLocalRunQueued(
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

    await this.deps.sleep(EA_MICRO_BUFFER_MS);

    const currentState = await this.deps.readState(conversationKey);
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
      this.clearLocalRun(conversationKey, runContext.runId);
      return {};
    }

    const state = await this.deps.readState(conversationKey);
    if (state.activeRunId !== runContext.runId || state.activeRevision !== runContext.revision) {
      this.clearLocalRun(conversationKey, runContext.runId);
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
        nextBurstId: this.deps.createId(),
      }).catch((error) => {
        if (isBenignStartConflict(error)) {
          return null;
        }
        throw error;
      });

      this.clearLocalRun(conversationKey, runContext.runId);
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

    const { previous, current } = await this.deps.updateState(conversationKey, (current) => {
      if (current.activeRunId !== runContext.runId || current.activeRevision !== runContext.revision) {
        return current;
      }

      return {
        ...current,
        activeRunId: null,
        activeRevision: null,
        activeRunPhase: 'completed',
        classifierDecision: null,
        pendingCount: 0,
        steerSeq: 0,
        steerMailbox: [],
        steerDroppedSummary: [],
      };
    });

    if (
      previous.activeRunId === runContext.runId &&
      previous.activeRevision === runContext.revision &&
      previous.activeRunPhase !== current.activeRunPhase &&
      current.activeRunPhase === 'completed'
    ) {
      this.deps.emitEvent('orchestrator.run.phase.changed', {
        channel: runContext.channel,
        conversationId: runContext.conversationId,
        conversationKey,
        runId: runContext.runId,
        burstId: runContext.burstId,
        fromPhase: previous.activeRunPhase,
        toPhase: current.activeRunPhase,
        reason: 'finalize_run',
      });
    }

    this.clearLocalRun(conversationKey, runContext.runId);
    return {};
  }

  private applyInboundToState(
    state: BurstState,
    userRequest: string,
  ): BurstState {
    const now = this.deps.now();
    const next = { ...state };

    if (!next.activeRunId && now > next.windowEndsAt) {
      next.burstId = this.deps.createId();
      next.pendingCount = 0;
      next.droppedSummary = [];
      next.queuedIntentText = null;
      next.queuedRevision = null;
      next.activeRunPhase = 'running';
      next.steerSeq = 0;
      next.steerMailbox = [];
      next.steerDroppedSummary = [];
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

  private markLocalRunQueued(
    conversationKey: string,
    runId: string,
    windowEndsAt: number,
  ): void {
    const active = this.localRuns.get(conversationKey);
    if (!active || active.runId !== runId) return;

    active.hasQueuedFollowup = true;
    active.windowEndsAt = windowEndsAt;
  }

  private markLocalRunSteered(
    conversationKey: string,
    runId: string,
    windowEndsAt: number,
  ): void {
    const active = this.localRuns.get(conversationKey);
    if (!active || active.runId !== runId) return;

    active.windowEndsAt = windowEndsAt;
  }

  private clearLocalRun(conversationKey: string, runId: string): void {
    const active = this.localRuns.get(conversationKey);
    if (!active || active.runId !== runId) return;
    this.localRuns.delete(conversationKey);
  }

  private abortLocalRun(
    conversationKey: string,
    runId: string,
    reason: string,
  ): void {
    const active = this.localRuns.get(conversationKey);
    if (!active || active.runId !== runId) return;

    active.stale = true;
    active.abortController.abort(reason);
    this.localRuns.delete(conversationKey);
  }

  private buildRunContext(record: LocalRunRecord): RunContext {
    const emptyConsume = async (afterSeq: number): Promise<ConsumeSteerEventsResult> => ({
      events: [],
      nextSeq: afterSeq,
      droppedSummary: [],
    });

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
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return false;
        }

        if (!isEnabled(record.channel)) {
          return true;
        }

        const state = await this.deps.readState(record.conversationKey);
        return state.activeRunId === record.runId && state.activeRevision === record.revision;
      },
      isBurstStable: () => {
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return false;
        }

        return this.deps.now() >= local.windowEndsAt && !local.hasQueuedFollowup;
      },
      canEmitProgress: () => {
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return false;
        }

        return (
          (this.deps.now() >= local.windowEndsAt && !local.hasQueuedFollowup) ||
          this.deps.now() - local.startedAt >= EA_LONG_TASK_PROGRESS_MS
        );
      },
      consumeSteerEvents: async (afterSeq: number) => {
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return emptyConsume(afterSeq);
        }

        if (!isEnabled(record.channel) || !isCooperativeSteeringEnabled(record.channel)) {
          return emptyConsume(afterSeq);
        }

        let consumed: SteerEvent[] = [];
        let droppedSummary: string[] = [];
        let nextSeq = afterSeq;
        let burstId = record.burstId;
        let runPhase: RunPhase = local.runPhase;

        await this.deps.updateState(record.conversationKey, (state) => {
          if (state.activeRunId !== record.runId || state.activeRevision !== record.revision) {
            return state;
          }

          burstId = state.burstId;
          runPhase = state.activeRunPhase ?? runPhase;
          const mailbox = Array.isArray(state.steerMailbox) ? state.steerMailbox : [];
          consumed = mailbox.filter((event) => event.seq > afterSeq);
          droppedSummary = Array.isArray(state.steerDroppedSummary) ? state.steerDroppedSummary : [];
          nextSeq =
            consumed.length > 0 ? consumed[consumed.length - 1]!.seq : afterSeq;

          const remaining = mailbox.filter((event) => event.seq > nextSeq);

          return {
            ...state,
            steerMailbox: remaining,
            steerDroppedSummary: [],
          };
        });

        if (consumed.length > 0 || droppedSummary.length > 0) {
          this.deps.emitEvent('orchestrator.steer.applied', {
            channel: record.channel,
            conversationId: record.conversationId,
            conversationKey: record.conversationKey,
            runId: record.runId,
            burstId,
            runPhase,
            fromSeq: afterSeq,
            toSeq: nextSeq,
            appliedEvents: consumed.length,
            appliedDroppedSummary: droppedSummary.length,
          });
        }

        return { events: consumed, nextSeq, droppedSummary };
      },
      hasPendingSteer: async (afterSeq: number) => {
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return false;
        }

        if (!isEnabled(record.channel) || !isCooperativeSteeringEnabled(record.channel)) {
          return false;
        }

        const state = await this.deps.readState(record.conversationKey);
        if (state.activeRunId !== record.runId || state.activeRevision !== record.revision) {
          return false;
        }

        const mailbox = Array.isArray(state.steerMailbox) ? state.steerMailbox : [];
        if (mailbox.some((event) => event.seq > afterSeq)) return true;

        const dropped = Array.isArray(state.steerDroppedSummary) ? state.steerDroppedSummary : [];
        return dropped.length > 0;
      },
      markRunPhase: async (phase: RunPhase) => {
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return;
        }

        const previousLocalPhase = local.runPhase;
        local.runPhase = phase;

        if (!isEnabled(record.channel)) {
          if (previousLocalPhase !== phase) {
            this.deps.emitEvent('orchestrator.run.phase.changed', {
              channel: record.channel,
              conversationId: record.conversationId,
              conversationKey: record.conversationKey,
              runId: record.runId,
              burstId: record.burstId,
              fromPhase: previousLocalPhase,
              toPhase: phase,
              reason: 'mark_run_phase',
            });
          }
          return;
        }

        const { previous, current } = await this.deps.updateState(record.conversationKey, (state) => {
          if (state.activeRunId !== record.runId || state.activeRevision !== record.revision) {
            return state;
          }

          return {
            ...state,
            activeRunPhase: phase,
          };
        });

        if (
          previous.activeRunId === record.runId &&
          previous.activeRevision === record.revision &&
          previous.activeRunPhase !== current.activeRunPhase
        ) {
          this.deps.emitEvent('orchestrator.run.phase.changed', {
            channel: record.channel,
            conversationId: record.conversationId,
            conversationKey: record.conversationKey,
            runId: record.runId,
            burstId: current.burstId,
            fromPhase: previous.activeRunPhase,
            toPhase: current.activeRunPhase,
            reason: 'mark_run_phase',
          });
        }
      },
      getRunPhase: async () => {
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return 'completed';
        }

        if (!isEnabled(record.channel)) {
          return local.runPhase;
        }

        const state = await this.deps.readState(record.conversationKey);
        if (state.activeRunId !== record.runId || state.activeRevision !== record.revision) {
          return 'completed';
        }

        return state.activeRunPhase ?? local.runPhase;
      },
    };
  }

  private registerLocalRun(params: {
    channel: OrchestrationChannel;
    conversationId: string;
    conversationKey: string;
    runId: string;
    revision: number;
    burstId: string;
    windowEndsAt: number;
    classifierDecision: RelevanceClassification['decision'] | null;
    droppedSummary: string[];
    runPhase: RunPhase;
  }): RunContext {
    const previous = this.localRuns.get(params.conversationKey);
    if (previous && previous.runId !== params.runId) {
      this.deps.emitEvent('orchestrator.run.superseded', {
        channel: params.channel,
        conversationId: params.conversationId,
        conversationKey: params.conversationKey,
        supersededRunId: previous.runId,
        replacementRunId: params.runId,
        reason: 'superseded_by_new_run',
      });
      this.abortLocalRun(params.conversationKey, previous.runId, 'superseded_by_new_run');
    }

    const record: LocalRunRecord = {
      runId: params.runId,
      revision: params.revision,
      burstId: params.burstId,
      channel: params.channel,
      conversationId: params.conversationId,
      conversationKey: params.conversationKey,
      abortController: new AbortController(),
      startedAt: this.deps.now(),
      windowEndsAt: params.windowEndsAt,
      hasQueuedFollowup: false,
      classifierDecision: params.classifierDecision,
      droppedSummary: [...params.droppedSummary],
      runPhase: params.runPhase,
      stale: false,
    };

    this.localRuns.set(params.conversationKey, record);
    return this.buildRunContext(record);
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
    const runId = this.deps.createId();

    const { current } = await this.deps.updateState(params.conversationKey, (state) => {
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
        activeRunPhase: 'running',
        latestIntentText: params.userRequest,
        classifierDecision: params.classifierDecision?.decision ?? state.classifierDecision,
        pendingCount: 0,
        queuedIntentText: null,
        queuedRevision: null,
        steerSeq: 0,
        steerMailbox: [],
        steerDroppedSummary: [],
      };
    });

    const runContext = this.registerLocalRun({
      channel: params.channel,
      conversationId: params.conversationId,
      conversationKey: params.conversationKey,
      runId,
      revision: current.activeRevision ?? current.revision,
      burstId: current.burstId,
      windowEndsAt: current.windowEndsAt,
      classifierDecision: current.classifierDecision,
      droppedSummary: current.droppedSummary,
      runPhase: current.activeRunPhase ?? 'running',
    });

    if (params.nextBurstId) {
      this.deps.emitEvent('orchestrator.burst.started', {
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
