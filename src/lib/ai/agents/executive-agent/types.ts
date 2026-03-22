import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type { ProgressEmitter } from '@/lib/ai/progressEmitter';
import type {
  ProgressUpdateContext,
} from '@/lib/ai/tools/sendProgressUpdate';
import type {
  InboxSearchToolArgs,
  ListInboxEmailsToolArgs,
} from '@/lib/services/inbox-search/types';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import type { Prisma, PendingCalendarChangeStatus } from '@prisma/client';
import type {
  ConsumeSteerEventsResult,
  RunPhase,
} from '@/lib/services/messaging-orchestration/types';
import type {
  ExecutiveToolResultReuseCache,
  ExecutiveToolResultCacheStats,
} from './toolResultReuseCache';
import type { AiTraceContext } from '@/lib/ai/tracing';
import type {
  McpToolExposure,
} from '@/lib/services/mcp/types';
import type {
  McpSelectableServerPack,
} from '@/lib/services/mcp/policy/service';
import type {
  SelectableSkill,
  SkillExposure,
} from '@/lib/services/skills';

export interface ExecutiveAgentInput {
  userId: string;
  userEmail: string;
  userRequest: string;
  conversationId: string;
  channel: ProgressUpdateChannel;
  conversationHistory: ConversationMessageDTO[];
  abortSignal?: AbortSignal;
  progressContext?: ProgressUpdateContext;
  traceContext?: AiTraceContext;
  runContext?: {
    runId: string;
    burstId: string;
    classifierDecision?: 'supersede' | 'followup' | 'ambiguous' | null;
    priorPack?:
      | 'safe_context_pack'
      | 'calendar_mutation_pack'
      | 'reminder_alert_pack'
      | 'media_delivery_pack'
      | 'settings_mutation_pack'
      | 'email_send_pack'
      | null;
    droppedSummary?: string[];
    setSelectedPack?: (packId: ToolPackId) => void;
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
  status: 'ok' | 'degraded' | 'fallback';
  error?: string;
  metadata?: Prisma.InputJsonObject;
}

export type ToolPackId =
  | 'safe_context_pack'
  | 'calendar_mutation_pack'
  | 'reminder_alert_pack'
  | 'media_delivery_pack'
  | 'settings_mutation_pack'
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
  | 'context'
  | 'calendar'
  | 'reminder'
  | 'delivery'
  | 'settings'
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
    pendingMcpActionId?: string;
    lastTool?: string;
    lastToolSummary?: string;
    lastUserFacingText?: string;
    draftCandidatePresent?: boolean;
  };
}

export interface ExecutiveTurnFeatures {
  explicitSendApproval: boolean;
  draftCandidatePresent: boolean;
  pendingCalendarChangePresent: boolean;
  channel: ProgressUpdateChannel;
  hasRecentPendingCalendarPreview: boolean;
  pendingCalendarConfirmIntent: boolean;
  pendingCalendarCancelIntent: boolean;
  draftCandidateReason: string | null;
}

export interface ToolExposurePlan {
  primaryPack: ToolPackId;
  packIds: ToolPackId[];
  mcpConnectionIds: string[];
  skillIds: string[];
  reasons: string[];
  reminders: string[];
  repairAttempted: boolean;
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

export type SearchInboxContextArgs = InboxSearchToolArgs;
export type ListInboxEmailsArgs = ListInboxEmailsToolArgs;
export type ReadEmailAttachmentContentArgs = {
  messageId: string;
  mailboxId?: string;
  mailboxEmail?: string;
  attachmentId?: string;
  attachmentFilename?: string;
};
export type ReadEmailPdfAttachmentArgs = {
  messageId: string;
  mailboxId?: string;
  mailboxEmail?: string;
  attachmentId?: string;
  attachmentFilename?: string;
};

export type RetrievalProfile = 'default' | 'messaging';

export type ExecutiveRuntimeContext = {
  input: ExecutiveAgentInput;
  channel: ProgressUpdateChannel;
  retrievalProfile: RetrievalProfile;
  selectedPack: ToolPackId;
  selectedPacks: ToolPackId[];
  exposureReasons: string[];
  turnFeatures: ExecutiveTurnFeatures;
  userTimezone: string;
  currentTimeUtc: string;
  currentTimeUserTz: string;
  dayOfWeek: string;
  progressEmitter?: ProgressEmitter | null;
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
  toolResultCache: ExecutiveToolResultReuseCache;
  mcpToolExposure?: McpToolExposure | null;
  mcpSelectableServerPacks?: readonly McpSelectableServerPack[] | null;
  skillExposure?: SkillExposure | null;
  selectableSkills?: readonly SelectableSkill[] | null;
  requestableActionPackIds?: readonly Exclude<ToolPackId, 'safe_context_pack'>[] | null;
};
