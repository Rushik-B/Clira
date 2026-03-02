import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type {
  ProgressUpdateContext,
} from '@/lib/ai/tools/sendProgressUpdate';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import type { Prisma, PendingCalendarChangeStatus } from '@prisma/client';
import type {
  ConsumeSteerEventsResult,
  RunPhase,
} from '@/lib/services/messaging-orchestration/types';
import type {
  ExecutiveToolResultCacheStats,
} from './toolResultReuseCache';

export interface ExecutiveAgentInput {
  userId: string;
  userEmail: string;
  userRequest: string;
  conversationId: string;
  channel: ProgressUpdateChannel;
  conversationHistory: ConversationMessageDTO[];
  abortSignal?: AbortSignal;
  progressContext?: ProgressUpdateContext;
  runContext?: {
    runId: string;
    burstId: string;
    classifierDecision?: 'supersede' | 'followup' | 'ambiguous' | null;
    droppedSummary?: string[];
    isRunCurrent: () => Promise<boolean>;
    isBurstStable: () => boolean;
    consumeSteerEvents?: (afterSeq: number) => Promise<ConsumeSteerEventsResult>;
    hasPendingSteer?: (afterSeq: number) => Promise<boolean>;
    markRunPhase?: (phase: RunPhase) => Promise<void>;
    getRunPhase?: () => Promise<RunPhase>;
  };
}

export interface ExecutiveAgentOutput {
  response: string;
  memoryStored: boolean;
  status: 'ok' | 'fallback';
  error?: string;
  metadata?: Prisma.InputJsonObject;
}

export type ToolPackId =
  | 'core_recall_pack'
  | 'inbox_context_pack'
  | 'calendar_query_pack'
  | 'calendar_mutation_pack'
  | 'reminder_alert_pack'
  | 'email_send_pack';

export type ExecutiveWorkingStatePhase =
  | 'understand'
  | 'retrieve'
  | 'clarify'
  | 'draft'
  | 'await_approval'
  | 'act'
  | 'complete'
  | 'failed';

export type ExecutivePrimaryDomain =
  | 'memory'
  | 'inbox'
  | 'calendar'
  | 'reminder'
  | 'email_send';

export interface ExecutiveWorkingState {
  goal: string;
  selectedPack: ToolPackId;
  phase: ExecutiveWorkingStatePhase;
  primaryDomain: ExecutivePrimaryDomain;
  completedSteps: string[];
  nextStep: string | null;
  factsLearned: string[];
  artifacts: {
    pendingCalendarChangeId?: string;
    lastTool?: string;
    lastToolSummary?: string;
    draftCandidatePresent?: boolean;
  };
}

export interface ExecutiveTurnFeatures {
  explicitSendApproval: boolean;
  explicitSendDecline: boolean;
  draftCandidatePresent: boolean;
  pendingCalendarChangePresent: boolean;
  calendarMutationIntent: boolean;
  calendarQueryIntent: boolean;
  workloadOverviewIntent: boolean;
  emailIntent: boolean;
  reminderIntent: boolean;
  alertIntent: boolean;
  recallIntent: boolean;
  classifierDecision: 'supersede' | 'followup' | 'ambiguous' | null;
  channel: ProgressUpdateChannel;
  hasRecentSendSuccess: boolean;
  hasRecentPendingCalendarPreview: boolean;
  pendingCalendarConfirmIntent: boolean;
  pendingCalendarCancelIntent: boolean;
  pendingCalendarModifyIntent: boolean;
  ambiguousCalendarLike: boolean;
  ambiguousEmailLike: boolean;
  draftCandidateReason: string | null;
}

export interface PackSelection {
  packId: ToolPackId;
  reasons: string[];
  reminders: string[];
}

export type ExecutivePromptMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type PendingCalendarChangeRecord = {
  id: string;
  plan: Prisma.JsonValue;
  resolvedTarget: Prisma.JsonValue | null;
  userTimezone: string;
  userRequest: string;
  expiresAt: Date;
  status: PendingCalendarChangeStatus;
  createdAt: Date;
};

export interface PromptContext {
  systemPrompt: string;
  messages: ExecutivePromptMessage[];
  userTimezone: string;
  currentTimeUtc: string;
  currentTimeUserTz: string;
  dayOfWeek: string;
  currentDateUserTzDateOnly: string;
}

export type SearchInboxContextArgs = {
  mode?: 'quick' | 'deep';
  intent: string;
  constraints?: {
    sender?: string;
    recipient?: string;
    keywords?: string[];
    subject?: string;
    timeWindow?: 'recent' | 'last_month' | 'last_year' | 'all_time';
    startDate?: string;
    endDate?: string;
    hasAttachment?: boolean;
  };
};

export type RetrievalProfile = 'default' | 'messaging';

export type ExecutiveRuntimeContext = {
  input: ExecutiveAgentInput;
  channel: ProgressUpdateChannel;
  retrievalProfile: RetrievalProfile;
  selectedPack: ToolPackId;
  selectorReasons: string[];
  turnFeatures: ExecutiveTurnFeatures;
  userTimezone: string;
  currentTimeUtc: string;
  currentTimeUserTz: string;
  dayOfWeek: string;
  toolAbort: {
    deadlineAt?: number;
    signal?: AbortSignal;
    timeLeftMs: () => number | null;
  };
  toolAbortSignal?: AbortSignal;
  isRunCurrent: () => Promise<boolean>;
  isBurstStable: () => boolean;
  onMemoryStored: () => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  registerToolResultCacheStatsReader?: (
    readStats: () => ExecutiveToolResultCacheStats,
  ) => void;
};
