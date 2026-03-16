import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import type { ContentReference } from '@/lib/services/content-ingestion/types';

export type McpActionClass = 'read' | 'write' | 'delete' | 'side_effectful';
export type McpLatencyClass = 'fast' | 'standard' | 'slow';
export type McpTransportKind = 'stdio' | 'streamable_http';
export type McpAuthMode = 'none' | 'bearer_token' | 'static_header';
export type McpTrustClass = 'first_party' | 'user_configured' | 'third_party';
export type McpConnectionStatus = 'pending' | 'synced' | 'degraded' | 'disabled';
export type McpConnectionId = string;
export type McpServerPackId = string;

export type McpTransportConfig =
  | {
      type: 'stdio';
      command: string;
      args: string[];
      cwd?: string | null;
      inheritEnv?: boolean;
    }
  | {
      type: 'streamable_http';
      endpoint: string;
      headers?: Record<string, string>;
    };

export type McpSecretConfig =
  | {
      authMode: 'none';
      env?: Record<string, string>;
    }
  | {
      authMode: 'bearer_token';
      bearerToken: string;
      env?: Record<string, string>;
    }
  | {
      authMode: 'static_header';
      headerName: string;
      headerValue: string;
      env?: Record<string, string>;
    };

export type McpConnectionRecord = {
  id: string;
  userId: string;
  serverKey: string;
  displayName: string;
  packDescription: string | null;
  disabledToolNames: string[];
  transport: McpTransportConfig;
  authMode: McpAuthMode;
  status: McpConnectionStatus;
  trustClass: McpTrustClass;
  degradedReason: string | null;
  syncDiagnostics: unknown;
  healthDiagnostics: unknown;
  lastSyncedAt: Date | null;
  lastHealthCheckedAt: Date | null;
  consecutiveFailures: number;
  circuitOpenedAt: Date | null;
  circuitOpenUntil: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type McpToolManifestRecord = {
  id: string;
  connectionId: string;
  toolName: string;
  toolSlug: string;
  modelToolName: string;
  displayTitle: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
  actionClass: McpActionClass;
  latencyClass: McpLatencyClass;
  safeForAutoUse: boolean;
  syncDiagnostics: unknown;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type McpRegistryConnection = {
  connection: McpConnectionRecord;
  tools: McpToolManifestRecord[];
};

export type McpRegistrySnapshot = {
  userId: string;
  fetchedAt: Date;
  connections: McpRegistryConnection[];
};

export type McpServerPackSelection = {
  connectionIds: string[];
};

export type McpPolicyDecision = {
  visible: boolean;
  callable: boolean;
  requiresConfirmation: boolean;
  reason: string;
};

export type McpPolicyCandidate = {
  connection: McpConnectionRecord;
  tool: McpToolManifestRecord;
  decision: McpPolicyDecision;
};

export type McpPendingActionStatus =
  | 'pending'
  | 'in_progress'
  | 'consumed'
  | 'cancelled'
  | 'expired';

export type McpPendingActionRecord = {
  id: string;
  userId: string;
  conversationId: string;
  connectionId: string;
  toolName: string;
  modelToolName: string;
  displayTitle: string;
  actionClass: McpActionClass;
  trustClass: McpTrustClass;
  userRequest: string;
  args: Record<string, unknown>;
  previewText: string;
  previewSummary: Record<string, unknown> | null;
  status: McpPendingActionStatus;
  idempotencyKey: string;
  expiresAt: Date;
  consumedAt: Date | null;
  cancelledAt: Date | null;
  resultSummary: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type McpExecutionRequest = {
  userId: string;
  connectionId: string;
  toolName: string;
  args: Record<string, unknown>;
  deadlineMs: number;
  requestId: string;
  conversationId?: string;
  idempotencyKey?: string;
  mutationApproval?: 'confirmed';
};

export type McpExecutionFreshness = {
  cacheTtlMs: number;
  cachedAt: string;
  connectionLastSyncedAt: string | null;
};

export type McpExecutionResult = {
  ok: boolean;
  toolName: string;
  modelToolName: string;
  connectionId: string;
  displayName: string;
  content: unknown[];
  contentRefs?: ContentReference[];
  structuredContent?: Record<string, unknown>;
  degraded: boolean;
  latencyMs: number;
  cache: 'hit' | 'miss';
  freshness: McpExecutionFreshness;
  errorClass?: string;
  userFacingDegradedReason?: string | null;
};

export type McpPromptSummary = {
  toolSummaryLines: string[];
  degradedLines: string[];
};

export type McpToolExposure = {
  selectedConnectionIds: string[];
  approvedTools: McpPolicyCandidate[];
  mutationTools: McpPolicyCandidate[];
  degradedTools: McpPolicyCandidate[];
  pendingAction: McpPendingActionRecord | null;
  promptSummary: McpPromptSummary;
};

export type McpTurnContext = {
  userId: string;
  channel: ProgressUpdateChannel;
  packIds: readonly string[];
  selectedConnectionIds: readonly string[];
};

export class McpServiceError extends Error {
  readonly retryable: boolean;
  readonly errorClass: string;

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      errorClass?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'McpServiceError';
    this.retryable = options?.retryable ?? false;
    this.errorClass = options?.errorClass ?? 'unknown';
  }
}
