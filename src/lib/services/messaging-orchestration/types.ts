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

export type BurstState = {
  burstId: string;
  activeRunId: string | null;
  activeRevision: number | null;
  revision: number;
  windowEndsAt: number;
  pendingCount: number;
  droppedSummary: string[];
  latestIntentText: string;
  classifierDecision: RelevanceDecision | null;
  queuedIntentText: string | null;
  queuedRevision: number | null;
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
  droppedSummary: string[];
  abortSignal: AbortSignal;
  isRunCurrent: () => Promise<boolean>;
  isBurstStable: () => boolean;
  canEmitProgress: () => boolean;
};

export type RunStart = {
  kind: 'start';
  runContext: RunContext;
  userRequest: string;
  classifierDecision?: RelevanceClassification;
};

export type RunSkipReason = 'queued_followup' | 'superseded_by_newer_message';

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
