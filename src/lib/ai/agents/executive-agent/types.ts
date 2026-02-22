import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type {
  ProgressUpdateContext,
} from '@/lib/ai/tools/sendProgressUpdate';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import type { Prisma, PendingCalendarChangeStatus } from '@prisma/client';

export interface ExecutiveAgentInput {
  userId: string;
  userEmail: string;
  userRequest: string;
  conversationId: string;
  conversationHistory: ConversationMessageDTO[];
  abortSignal?: AbortSignal;
  progressContext?: ProgressUpdateContext;
}

export interface ExecutiveAgentOutput {
  response: string;
  memoryStored: boolean;
  status: 'ok' | 'fallback';
  error?: string;
  metadata?: Prisma.InputJsonObject;
}

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
  prompt: string;
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
  onMemoryStored: () => void;
};
