export type GmailIngestionMode = 'pull' | 'push';

const DEFAULT_INGESTION_MODE: GmailIngestionMode = 'pull';
const DEFAULT_PULL_MAX_MESSAGES = 25;
const DEFAULT_PULL_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_PULL_SHUTDOWN_TIMEOUT_MS = 15_000;

export class GmailIngestionConfigError extends Error {
  readonly code: 'INVALID_ENV' | 'MISSING_ENV';

  constructor(message: string, code: 'INVALID_ENV' | 'MISSING_ENV') {
    super(message);
    this.name = 'GmailIngestionConfigError';
    this.code = code;
  }
}

function readOptional(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function readRequired(name: string): string {
  const value = readOptional(name);
  if (!value) {
    throw new GmailIngestionConfigError(
      `Missing required Gmail ingestion environment variable: ${name}`,
      'MISSING_ENV',
    );
  }

  return value;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = readOptional(name);
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new GmailIngestionConfigError(
      `Invalid value for ${name}. Expected a positive integer, received "${raw}".`,
      'INVALID_ENV',
    );
  }

  return parsed;
}

export function getGmailIngestionMode(): GmailIngestionMode {
  const raw = readOptional('GMAIL_INGESTION_MODE');
  if (!raw) return DEFAULT_INGESTION_MODE;

  const normalized = raw.toLowerCase();
  if (normalized === 'pull' || normalized === 'push') {
    return normalized;
  }

  throw new GmailIngestionConfigError(
    `Invalid GMAIL_INGESTION_MODE "${raw}". Expected "pull" or "push".`,
    'INVALID_ENV',
  );
}

export function getGmailPubSubTopic(): string {
  return readRequired('GMAIL_PUBSUB_TOPIC');
}

export function getGmailPullSubscription(): string {
  if (getGmailIngestionMode() !== 'pull') {
    const configured = readOptional('GMAIL_PUBSUB_PULL_SUBSCRIPTION');
    return configured ?? '';
  }

  return readRequired('GMAIL_PUBSUB_PULL_SUBSCRIPTION');
}

export function getGmailPullMaxMessages(): number {
  return readPositiveInt('GMAIL_PUBSUB_PULL_MAX_MESSAGES', DEFAULT_PULL_MAX_MESSAGES);
}

export function getGmailPullMaxBytes(): number {
  return readPositiveInt('GMAIL_PUBSUB_PULL_MAX_BYTES', DEFAULT_PULL_MAX_BYTES);
}

export function getGmailPullShutdownTimeoutMs(): number {
  return readPositiveInt(
    'GMAIL_PUBSUB_PULL_SHUTDOWN_TIMEOUT_MS',
    DEFAULT_PULL_SHUTDOWN_TIMEOUT_MS,
  );
}

export function getGmailPullRuntimeConfig(): {
  subscription: string;
  maxMessages: number;
  maxBytes: number;
  shutdownTimeoutMs: number;
} {
  return {
    subscription: getGmailPullSubscription(),
    maxMessages: getGmailPullMaxMessages(),
    maxBytes: getGmailPullMaxBytes(),
    shutdownTimeoutMs: getGmailPullShutdownTimeoutMs(),
  };
}
