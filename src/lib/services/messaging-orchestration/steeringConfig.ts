import type {
  OrchestrationChannel,
  RelevanceClassification,
  RunPhase,
} from './types';

const AMBIGUOUS_STEER_CONFIDENCE_MIN =0.30;
const DEFAULT_STEER_MAILBOX_CAP = 8;

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const int = Math.floor(parsed);
  if (int <= 0) return null;
  return int;
}

export function getSteerMailboxCap(): number {
  const cap = parsePositiveInt(process.env.EA_STEER_MAILBOX_CAP);
  if (cap === null) return DEFAULT_STEER_MAILBOX_CAP;
  return Math.min(Math.max(cap, 1), 50);
}

export function isCooperativeSteeringEnabled(channel: OrchestrationChannel): boolean {
  const channelOverride = process.env[`EA_STEER_COOPERATIVE_${channel.toUpperCase()}`];
  if (channelOverride === 'true') return true;
  if (channelOverride === 'false') return false;
  return process.env.EA_STEER_COOPERATIVE === 'true';
}

export function shouldSteerInRun(
  decision: RelevanceClassification,
  params: { runPhase: RunPhase },
): boolean {
  if (params.runPhase !== 'running') return false;
  if (decision.decision !== 'ambiguous') return false;
  return decision.confidence >= AMBIGUOUS_STEER_CONFIDENCE_MIN;
}
