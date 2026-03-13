export type AiTraceCaptureMode = 'full' | 'summary' | 'off';
export type AiTraceRunStatus = 'PENDING' | 'OK' | 'ERROR' | 'FALLBACK' | 'ABORTED';
export type AiTraceSpanKind = 'ROOT' | 'INGRESS' | 'STAGE' | 'LLM' | 'TOOL' | 'EGRESS' | 'ERROR';
export type AiTraceSpanStatus = 'RUNNING' | 'OK' | 'ERROR' | 'FALLBACK' | 'ABORTED';

export type AiTraceRootInput = {
  runId?: string;
  pipeline: string;
  userId: string;
  channel?: string | null;
  conversationId?: string | null;
  emailId?: string | null;
  mailboxId?: string | null;
  externalMessageId?: string | null;
  label?: string | null;
  inputPreview?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AiTraceContext = {
  enabled: boolean;
  captureMode: AiTraceCaptureMode;
  runId: string;
  pipeline: string;
  userId: string;
  channel?: string | null;
  conversationId?: string | null;
  emailId?: string | null;
  mailboxId?: string | null;
  externalMessageId?: string | null;
  label?: string | null;
  artifactPath?: string | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  rootStartedAtMs?: number;
};

export type AiTraceUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type AiTraceSpanInput = {
  kind: AiTraceSpanKind;
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown> | null;
};

export type AiTraceSpanHandle = {
  spanId: string;
  context: AiTraceContext;
  finish: (params?: {
    status?: AiTraceSpanStatus;
    output?: unknown;
    metadata?: Record<string, unknown> | null;
    errorMessage?: string | null;
    usage?: AiTraceUsage | null;
  }) => Promise<void>;
};

export type AiTraceRunFinishInput = {
  status: AiTraceRunStatus;
  outputPreview?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
};
