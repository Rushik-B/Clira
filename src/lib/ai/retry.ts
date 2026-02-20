import { classifyLlmError, LlmError } from './errors';
import { logger } from '../logger';

export type RetryOptions = {
  maxAttempts?: number; // total attempts including the first
  baseDelayMs?: number; // base backoff delay
  maxDelayMs?: number; // cap for backoff
  jitter?: boolean; // add random jitter
  isRetryable?: (err: LlmError) => boolean; // custom retryability
  onAttempt?: (args: { attempt: number; error: LlmError }) => void;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    jitter = true,
    isRetryable = defaultRetryable,
    onAttempt,
  } = opts;

  let lastErr: LlmError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = classifyLlmError(e);
      lastErr = err;

      onAttempt?.({ attempt, error: err });

      if (attempt >= maxAttempts || !isRetryable(err)) {
        logger.warn(`[retry] giving up after attempt ${attempt}: ${err.code} ${err.status ?? ''} ${err.message}`);
        throw err;
      }

      const delay = Math.min(maxDelayMs, backoff(baseDelayMs, attempt, jitter));
      logger.info(`[retry] attempt ${attempt} failed (${err.code}${err.status ? ` ${err.status}` : ''}). retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  // Should not reach here
  throw lastErr ?? new LlmError('Unknown error after retries');
}

function backoff(base: number, attempt: number, jitter: boolean): number {
  const exp = base * Math.pow(2, attempt - 1);
  if (!jitter) return exp;
  const rand = Math.random() * 0.25 + 0.75; // 0.75x - 1.0x jitter
  return Math.floor(exp * rand);
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function defaultRetryable(err: LlmError): boolean {
  if (err.code === 'provider') {
    if (err.status == null) return true;
    if (err.status >= 500) return true;
    if (/unknown|temporar|timeout/i.test(err.message)) return true;
  }
  return err.code === 'rate_limit' || err.code === 'overloaded' || err.code === 'network';
}

