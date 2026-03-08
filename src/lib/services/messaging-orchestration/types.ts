import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';

export type OrchestrationChannel = ProgressUpdateChannel;

export const EA_MICRO_BUFFER_MS = 250;
export const EA_STEER_WINDOW_MS = 3_000;
export const EA_QUEUE_CAP = 20;
export const EA_DROP_POLICY = 'summarize';
export const EA_SUPERSEDE_CONFIDENCE_MIN = 0.7;
export const EA_FOLLOWUP_CONFIDENCE_MAX = 0.35;
export const EA_STATE_TTL_SECONDS = 30 * 60;
export const EA_LONG_TASK_PROGRESS_MS = 6_000;

export type RelevanceDecision = 'supersede' | 'followup' | 'ambiguous';

export type RelevanceClassification = {
  decision: RelevanceDecision;
  confidence: number;
  explanation: string;
  latestIntentText: string;
};

export type RunPhase = 'running' | 'commit_boundary' | 'completed';

export type RunPackId =
  | 'core_recall_pack'
  | 'inbox_context_pack'
  | 'calendar_query_pack'
  | 'calendar_mutation_pack'
  | 'reminder_alert_pack'
  | 'email_send_pack';

export type SteerEvent = {
  seq: number;
  revision: number;
  receivedAt: number;
  text: string;
  decision: RelevanceDecision;
  confidence: number;
};

export type ConsumeSteerEventsResult = {
  events: SteerEvent[];
  nextSeq: number;
  droppedSummary: string[];
};

export type BurstState = {
  burstId: string;
  activeRunId: string | null;
  activeRevision: number | null;
  activeRunPhase: RunPhase;
  revision: number;
  windowEndsAt: number;
  pendingCount: number;
  droppedSummary: string[];
  latestIntentText: string;
  classifierDecision: RelevanceDecision | null;
  queuedIntentText: string | null;
  queuedRevision: number | null;
  steerSeq: number;
  steerMailbox: SteerEvent[];
  steerDroppedSummary: string[];
  updatedAt: number;
};

export type RunContext = {
  runId: string;
  burstId: string;
  revision: number;
  conversationKey: string;
  channel: OrchestrationChannel;
  conversationId: string;
  classifierDecision: RelevanceDecision | null;
  priorPack: RunPackId | null;
  droppedSummary: string[];
  abortSignal: AbortSignal;
  setSelectedPack: (packId: RunPackId) => void;
  isRunCurrent: () => Promise<boolean>;
  isBurstStable: () => boolean;
  canEmitProgress: () => boolean;
  consumeSteerEvents: (afterSeq: number) => Promise<ConsumeSteerEventsResult>;
  hasPendingSteer: (afterSeq: number) => Promise<boolean>;
  markRunPhase: (phase: RunPhase) => Promise<void>;
  getRunPhase: () => Promise<RunPhase>;
};

export type RunStart = {
  kind: 'start';
  runContext: RunContext;
  userRequest: string;
  classifierDecision?: RelevanceClassification;
};

export type RunSkipReason =
  | 'queued_followup'
  | 'steered_in_run'
  | 'superseded_by_newer_message';

export type RunSkip = {
  kind: 'skip';
  reason: RunSkipReason;
  classifierDecision?: RelevanceClassification;
};

export type OrchestrationDecision = RunStart | RunSkip;

export type FinalizeResult = {
  nextRun?: {
    runContext: RunContext;
    userRequest: string;
  };
};

export type PrepareRunParams = {
  channel: OrchestrationChannel;
  conversationId: string;
  userRequest: string;
  isCommand?: boolean;
};

export type FinalizeRunParams = {
  runContext: RunContext;
};

export interface ChannelAdapter {
  channel: OrchestrationChannel;
  conversationId: () => string;
  messageIdForDedupe: () => string | null;
  persistInbound: () => Promise<void>;
  sendFinal: (text: string) => Promise<{ externalId?: string }>;
  sendProgress: (text: string) => Promise<{ externalId?: string }>;
}
