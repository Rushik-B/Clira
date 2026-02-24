import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import { logger } from '@/lib/logger';

export type NativeSteeringRuntime =
  | { kind: 'supported'; steer: (text: string) => Promise<void> }
  | { kind: 'unsupported'; reason: string };

export function isNativeSteeringEnabled(channel: ProgressUpdateChannel): boolean {
  if (process.env.EA_STEER_NATIVE === 'false') {
    return false;
  }

  const channelOverride = process.env[`EA_STEER_NATIVE_${channel.toUpperCase()}`];
  if (channelOverride === 'false') {
    return false;
  }

  return process.env.EA_STEER_NATIVE === 'true' || channelOverride === 'true';
}

/**
 * Phase 2 scaffold: "native" in-flight steering only makes sense when the underlying
 * provider/runtime exposes a long-lived session handle that supports injecting
 * text while tokens are streaming.
 *
 * Today, Clira's Executive Agent uses discrete `generateText(...)` calls, so there
 * is no stable in-flight session primitive to steer.
 */
export function resolveNativeSteeringRuntime(): NativeSteeringRuntime {
  return {
    kind: 'unsupported',
    reason:
      'No runtime session steering primitive is wired (generateText-only execution).',
  };
}

export function requireNativeSteeringRuntime(
  runtime: NativeSteeringRuntime,
  params: { op: string },
): { steer: (text: string) => Promise<void> } {
  if (runtime.kind === 'supported') return runtime;

  logger.warn('[steeringRuntime] native_steer_unsupported', {
    op: params.op,
    reason: runtime.reason,
  });
  throw new Error('native_steer_unsupported');
}

