export type LlmErrorCode =
  | 'rate_limit'
  | 'overloaded'
  | 'invalid_output'
  | 'provider'
  | 'abort'
  | 'network'
  | 'unknown';

export class LlmError extends Error {
  public readonly code: LlmErrorCode;
  public readonly status?: number;
  public readonly provider?: string;
  public readonly model?: string;
  public readonly requestId?: string;
  public readonly cause?: unknown;

  constructor(
    message: string,
    {
      code = 'unknown',
      status,
      provider,
      model,
      requestId,
      cause,
    }: {
      code?: LlmErrorCode;
      status?: number;
      provider?: string;
      model?: string;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
    this.provider = provider;
    this.model = model;
    this.requestId = requestId;
    this.cause = cause;
  }
}

export function classifyLlmError(err: unknown): LlmError {
  // Normalize common error shapes coming from fetch/providers/AI SDK
  const anyErr = err as any;
  const message: string =
    typeof err === 'string'
      ? err
      : (anyErr?.message as string | undefined) || 'Unknown LLM error';
  const status: number | undefined = anyErr?.status ?? anyErr?.response?.status;
  const name: string = typeof err === 'object' && err != null ? anyErr?.name || '' : '';

  // Abort
  if (
    name === 'AbortError' ||
    /aborted|abort|cancel|superseded/i.test(message) ||
    /deadline exceeded/i.test(message)
  ) {
    return new LlmError(message, { code: 'abort', cause: err });
  }

  // Rate limit / overloaded
  if (
    status === 429 ||
    /rate.?limit/i.test(message) ||
    /quota/i.test(message)
  ) {
    return new LlmError(message, { code: 'rate_limit', status, cause: err });
  }

  if (status === 503 || /overloaded|unavailable|temporar/i.test(message)) {
    return new LlmError(message, { code: 'overloaded', status, cause: err });
  }

  // Network
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|network error/i.test(message)) {
    return new LlmError(message, { code: 'network', status, cause: err });
  }

  // Provider error bucket (default non-structured provider errors)
  return new LlmError(message, { code: 'provider', status, cause: err });
}

