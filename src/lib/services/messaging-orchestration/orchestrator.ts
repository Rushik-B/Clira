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
  RunPackId,
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
const CLASSIFIER_REVALIDATION_MAX_RETRIES = 1;

type ActiveRunSnapshot = {
  activeRunId: string;
  activeRevision: number;
  activeRunPhase: RunPhase;
  latestIntentText: string;
  revision: number;
  burstId: string;
  windowEndsAt: number;
};

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
  priorPack: RunPackId | null;
  selectedPack: RunPackId | null;
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

function captureActiveRunSnapshot(state: BurstState): ActiveRunSnapshot | null {
  if (!state.activeRunId || typeof state.activeRevision !== 'number') {
    return null;
  }

  return {
    activeRunId: state.activeRunId,
    activeRevision: state.activeRevision,
    activeRunPhase: state.activeRunPhase,
    latestIntentText: state.latestIntentText,
    revision: state.revision,
    burstId: state.burstId,
    windowEndsAt: state.windowEndsAt,
  };
}

function matchesActiveRunSnapshot(
  state: BurstState,
  snapshot: ActiveRunSnapshot,
): boolean {
  return (
    state.activeRunId === snapshot.activeRunId &&
    state.activeRevision === snapshot.activeRevision &&
    state.activeRunPhase === snapshot.activeRunPhase &&
    state.revision === snapshot.revision
  );
}

function buildSnapshotMismatchReason(
  state: BurstState,
  snapshot: ActiveRunSnapshot,
): string {
  if (!state.activeRunId || typeof state.activeRevision !== 'number') {
    return 'active_run_missing_after_classify';
  }
  if (state.activeRunId !== snapshot.activeRunId) {
    return 'active_run_replaced_during_classify';
  }
  if (state.activeRevision !== snapshot.activeRevision) {
    return 'active_revision_changed_during_classify';
  }
  if (state.activeRunPhase !== snapshot.activeRunPhase) {
    return 'active_run_phase_changed_during_classify';
  }
  if (state.revision !== snapshot.revision) {
    return 'burst_revision_changed_during_classify';
  }
  return 'active_run_state_changed_during_classify';
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

  private async startFreshRunFromState(params: {
    channel: OrchestrationChannel;
    conversationId: string;
    conversationKey: string;
    userRequest: string;
    state: BurstState;
    classifierDecision?: RelevanceClassification;
    priorPack?: RunPackId | null;
    nextBurstId?: string;
  }): Promise<OrchestrationDecision | null> {
    const start = await this.startRun({
      channel: params.channel,
      conversationId: params.conversationId,
      conversationKey: params.conversationKey,
      userRequest: params.userRequest,
      expectedRevision: params.state.revision,
      forceReplace: false,
      classifierDecision: params.classifierDecision,
      priorPack: params.priorPack,
      nextBurstId: params.nextBurstId,
    }).catch((error) => {
      if (isBenignStartConflict(error)) {
        return null;
      }
      throw error;
    });

    if (!start) {
      return null;
    }

    return {
      kind: 'start',
      runContext: start.runContext,
      userRequest: params.userRequest,
      classifierDecision: params.classifierDecision,
    };
  }

  private emitClassifierDiscarded(params: {
    channel: OrchestrationChannel;
    conversationId: string;
    conversationKey: string;
    snapshot: ActiveRunSnapshot;
    currentState: BurstState;
    classifierDecision: RelevanceClassification;
    reason: string;
    retryAttempt: number;
  }): void {
    this.deps.emitEvent('orchestrator.classifier.discarded', {
      channel: params.channel,
      conversationId: params.conversationId,
      conversationKey: params.conversationKey,
      runId: params.snapshot.activeRunId,
      burstId: params.snapshot.burstId,
      reason: params.reason,
      decision: params.classifierDecision.decision,
      confidence: params.classifierDecision.confidence,
      retryAttempt: params.retryAttempt,
      latestRunId: params.currentState.activeRunId,
      latestRevision: params.currentState.revision,
      latestRunPhase: params.currentState.activeRunPhase,
    });
  }

  private async queueFollowupForSnapshot(params: {
    channel: OrchestrationChannel;
    conversationId: string;
    conversationKey: string;
    snapshot: ActiveRunSnapshot;
    userRequest: string;
    classifierDecision?: RelevanceClassification;
  }): Promise<{ queued: boolean; current: BurstState }> {
    let queued = false;
    const { current } = await this.deps.updateState(params.conversationKey, (state) => {
      if (!matchesActiveRunSnapshot(state, params.snapshot)) {
        return state;
      }

      queued = true;
      return {
        ...state,
        classifierDecision: params.classifierDecision?.decision ?? state.classifierDecision,
        queuedIntentText: params.userRequest,
        queuedRevision: state.revision,
      };
    });

    if (!queued) {
      this.deps.emitEvent('orchestrator.queue.write_rejected', {
        channel: params.channel,
        conversationId: params.conversationId,
        conversationKey: params.conversationKey,
        runId: params.snapshot.activeRunId,
        burstId: params.snapshot.burstId,
        reason: 'active_run_snapshot_stale',
        queuedRevision: current.queuedRevision,
        latestRunId: current.activeRunId,
        latestRevision: current.revision,
        latestRunPhase: current.activeRunPhase,
      });
    }

    return { queued, current };
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
        priorPack: null,
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
      const priorPack =
        activeRunId ? this.readLocalRunSelectedPack(conversationKey, activeRunId) : null;
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
        priorPack,
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

    let decisionState = stateAfterInbound;
    let classifierRetryCount = 0;
    let skipMicroBuffer = false;

    // Invariant: any branch that classifies against an active run must
    // revalidate the full active-run snapshot before writing back state.
    while (true) {
      const activeSnapshot = captureActiveRunSnapshot(decisionState);
      if (!activeSnapshot) {
        break;
      }

      const classifierDecision = await this.deps.classify({
        activeIntentText: activeSnapshot.latestIntentText,
        incomingText: userRequest,
      });

      const revalidatedState = await this.deps.readState(conversationKey);
      if (!matchesActiveRunSnapshot(revalidatedState, activeSnapshot)) {
        const reason = buildSnapshotMismatchReason(revalidatedState, activeSnapshot);
        this.emitClassifierDiscarded({
          channel,
          conversationId,
          conversationKey,
          snapshot: activeSnapshot,
          currentState: revalidatedState,
          classifierDecision,
          reason,
          retryAttempt: classifierRetryCount,
        });

        decisionState = revalidatedState;
        skipMicroBuffer = true;

        if (!decisionState.activeRunId) {
          this.deps.emitEvent('orchestrator.classifier.promoted_to_fresh_run', {
            channel,
            conversationId,
            conversationKey,
            priorRunId: activeSnapshot.activeRunId,
            priorBurstId: activeSnapshot.burstId,
            reason,
          });

          const promoted = await this.startFreshRunFromState({
            channel,
            conversationId,
            conversationKey,
            userRequest,
            state: decisionState,
          });
          if (promoted) {
            return promoted;
          }

          return {
            kind: 'skip',
            reason: 'superseded_by_newer_message',
          };
        }

        if (classifierRetryCount < CLASSIFIER_REVALIDATION_MAX_RETRIES) {
          classifierRetryCount += 1;
          continue;
        }

        const fallbackSnapshot = captureActiveRunSnapshot(decisionState);
        if (!fallbackSnapshot) {
          continue;
        }

        const queuedFallback = await this.queueFollowupForSnapshot({
          channel,
          conversationId,
          conversationKey,
          snapshot: fallbackSnapshot,
          userRequest,
        });
        if (queuedFallback.queued) {
          this.markLocalRunQueued(
            conversationKey,
            fallbackSnapshot.activeRunId,
            fallbackSnapshot.windowEndsAt,
          );
          return {
            kind: 'skip',
            reason: 'queued_followup',
          };
        }

        decisionState = queuedFallback.current;
        if (!decisionState.activeRunId) {
          this.deps.emitEvent('orchestrator.classifier.promoted_to_fresh_run', {
            channel,
            conversationId,
            conversationKey,
            priorRunId: activeSnapshot.activeRunId,
            priorBurstId: activeSnapshot.burstId,
            reason: 'queue_write_rejected_after_classifier_discard',
          });

          const promoted = await this.startFreshRunFromState({
            channel,
            conversationId,
            conversationKey,
            userRequest,
            state: decisionState,
          });
          if (promoted) {
            return promoted;
          }
        }

        return {
          kind: 'skip',
          reason: 'superseded_by_newer_message',
        };
      }

      decisionState = revalidatedState;
      this.deps.emitEvent('orchestrator.classifier.decision', {
        channel,
        conversationId,
        conversationKey,
        runId: activeSnapshot.activeRunId,
        decision: classifierDecision.decision,
        confidence: classifierDecision.confidence,
        explanation: classifierDecision.explanation,
      });

      if (shouldSupersede(classifierDecision)) {
        const priorPack = this.readLocalRunSelectedPack(
          conversationKey,
          activeSnapshot.activeRunId,
        );
        this.deps.emitEvent('orchestrator.run.superseded', {
          channel,
          conversationId,
          conversationKey,
          supersededRunId: activeSnapshot.activeRunId,
          reason: 'classifier_supersede',
          decision: classifierDecision.decision,
          confidence: classifierDecision.confidence,
        });
        this.abortLocalRun(
          conversationKey,
          activeSnapshot.activeRunId,
          'superseded_by_newer_message',
        );

        const start = await this.startRun({
          channel,
          conversationId,
          conversationKey,
          userRequest,
          expectedRevision: activeSnapshot.revision,
          forceReplace: true,
          classifierDecision,
          priorPack,
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
      const steerCandidateDecision = shouldSteerInRun(classifierDecision, { runPhase: 'running' });
      const explicitFollowupQueue = shouldQueueAsExplicitFollowup(
        classifierDecision,
        userRequest,
      );

      if (
        cooperativeSteeringEnabled &&
        steerCandidateDecision &&
        !explicitFollowupQueue &&
        activeSnapshot.activeRunPhase === 'commit_boundary'
      ) {
        const priorPack = this.readLocalRunSelectedPack(
          conversationKey,
          activeSnapshot.activeRunId,
        );
        this.deps.emitEvent('orchestrator.steer.blocked_commit_boundary', {
          channel,
          conversationId,
          conversationKey,
          runId: activeSnapshot.activeRunId,
          burstId: activeSnapshot.burstId,
          runPhase: activeSnapshot.activeRunPhase,
          decision: classifierDecision.decision,
          confidence: classifierDecision.confidence,
        });

        this.deps.emitEvent('orchestrator.run.superseded', {
          channel,
          conversationId,
          conversationKey,
          supersededRunId: activeSnapshot.activeRunId,
          reason: 'steer_blocked_commit_boundary',
          decision: classifierDecision.decision,
          confidence: classifierDecision.confidence,
        });
        this.abortLocalRun(
          conversationKey,
          activeSnapshot.activeRunId,
          'superseded_by_newer_message',
        );

        const start = await this.startRun({
          channel,
          conversationId,
          conversationKey,
          userRequest,
          expectedRevision: activeSnapshot.revision,
          forceReplace: true,
          classifierDecision,
          priorPack,
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
        activeSnapshot.activeRunPhase === 'running'
      ) {
        const cap = getSteerMailboxCap();
        const appendedAt = this.deps.now();
        let steerPersisted = false;
        const { current } = await this.deps.updateState(conversationKey, (state) => {
          if (!matchesActiveRunSnapshot(state, activeSnapshot)) {
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

          const mailbox = Array.isArray(state.steerMailbox)
            ? [...state.steerMailbox, nextEvent]
            : [nextEvent];
          const droppedSummary = Array.isArray(state.steerDroppedSummary)
            ? [...state.steerDroppedSummary]
            : [];

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
            runId: activeSnapshot.activeRunId,
            burstId: current.burstId,
            runPhase: activeSnapshot.activeRunPhase,
            seq: current.steerSeq,
            cap,
            mailboxSize: current.steerMailbox.length,
            droppedSummaryCount: current.steerDroppedSummary.length,
          });

          this.markLocalRunSteered(
            conversationKey,
            activeSnapshot.activeRunId,
            activeSnapshot.windowEndsAt,
          );

          return {
            kind: 'skip',
            reason: 'steered_in_run',
            classifierDecision,
          };
        }

        decisionState = await this.deps.readState(conversationKey);
        skipMicroBuffer = true;

        if (!decisionState.activeRunId) {
          this.deps.emitEvent('orchestrator.classifier.promoted_to_fresh_run', {
            channel,
            conversationId,
            conversationKey,
            priorRunId: activeSnapshot.activeRunId,
            priorBurstId: activeSnapshot.burstId,
            reason: 'active_run_missing_before_followup_queue',
          });

          const promoted = await this.startFreshRunFromState({
            channel,
            conversationId,
            conversationKey,
            userRequest,
            state: decisionState,
          });
          if (promoted) {
            return promoted;
          }

          return {
            kind: 'skip',
            reason: 'superseded_by_newer_message',
          };
        }

        if (classifierRetryCount < CLASSIFIER_REVALIDATION_MAX_RETRIES) {
          classifierRetryCount += 1;
          continue;
        }

        const latestActiveSnapshot = captureActiveRunSnapshot(decisionState);
        if (!latestActiveSnapshot) {
          continue;
        }

        const queuedFallback = await this.queueFollowupForSnapshot({
          channel,
          conversationId,
          conversationKey,
          snapshot: latestActiveSnapshot,
          userRequest,
        });
        if (queuedFallback.queued) {
          this.markLocalRunQueued(
            conversationKey,
            latestActiveSnapshot.activeRunId,
            latestActiveSnapshot.windowEndsAt,
          );
          return {
            kind: 'skip',
            reason: 'queued_followup',
          };
        }

        return {
          kind: 'skip',
          reason: 'superseded_by_newer_message',
        };
      }

      const queued = await this.queueFollowupForSnapshot({
        channel,
        conversationId,
        conversationKey,
        snapshot: activeSnapshot,
        userRequest,
        classifierDecision,
      });

      if (queued.queued) {
        this.markLocalRunQueued(
          conversationKey,
          activeSnapshot.activeRunId,
          activeSnapshot.windowEndsAt,
        );

        return {
          kind: 'skip',
          reason: 'queued_followup',
          classifierDecision,
        };
      }

      decisionState = queued.current;
      skipMicroBuffer = true;

      if (!decisionState.activeRunId) {
        this.deps.emitEvent('orchestrator.classifier.promoted_to_fresh_run', {
          channel,
          conversationId,
          conversationKey,
          priorRunId: activeSnapshot.activeRunId,
          priorBurstId: activeSnapshot.burstId,
          reason: 'queue_write_rejected_after_classify',
        });

        const promoted = await this.startFreshRunFromState({
          channel,
          conversationId,
          conversationKey,
          userRequest,
          state: decisionState,
        });
        if (promoted) {
          return promoted;
        }
      }

      if (classifierRetryCount < CLASSIFIER_REVALIDATION_MAX_RETRIES) {
        classifierRetryCount += 1;
        continue;
      }

      return {
        kind: 'skip',
        reason: 'superseded_by_newer_message',
      };
    }

    if (!skipMicroBuffer) {
      await this.deps.sleep(EA_MICRO_BUFFER_MS);
      decisionState = await this.deps.readState(conversationKey);
      if (decisionState.revision !== stateAfterInbound.revision || decisionState.activeRunId) {
        return {
          kind: 'skip',
          reason: 'superseded_by_newer_message',
        };
      }
    }

    const start = await this.startFreshRunFromState({
      channel,
      conversationId,
      conversationKey,
      userRequest,
      state: decisionState,
    });

    if (!start) {
      return {
        kind: 'skip',
        reason: 'superseded_by_newer_message',
      };
    }

    return start;
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
      const priorPack = this.readLocalRunSelectedPack(conversationKey, runContext.runId);
      const start = await this.startRun({
        channel: runContext.channel,
        conversationId: runContext.conversationId,
        conversationKey,
        userRequest: queuedText,
        expectedRevision: state.revision,
        forceReplace: true,
        priorPack,
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

  private readLocalRunSelectedPack(
    conversationKey: string,
    runId: string,
  ): RunPackId | null {
    const active = this.localRuns.get(conversationKey);
    if (!active || active.runId !== runId || active.stale) {
      return null;
    }
    return active.selectedPack;
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
      priorPack: record.priorPack,
      droppedSummary: record.droppedSummary,
      abortSignal: record.abortController.signal,
      setSelectedPack: (packId: RunPackId) => {
        const local = this.localRuns.get(record.conversationKey);
        if (!local || local.runId !== record.runId || local.stale) {
          return;
        }
        local.selectedPack = packId;
      },
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
    priorPack: RunPackId | null;
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
      priorPack: params.priorPack,
      selectedPack: null,
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
    priorPack?: RunPackId | null;
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
        latestIntentText: params.classifierDecision?.latestIntentText ?? params.userRequest,
        classifierDecision: params.classifierDecision?.decision ?? null,
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
      priorPack: params.priorPack ?? null,
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
