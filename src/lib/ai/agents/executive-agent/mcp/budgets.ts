import type { ExecutiveRuntimeContext } from '@/lib/ai/agents/executive-agent/types';
import type { McpToolManifestRecord } from '@/lib/services/mcp/types';

export function resolveExecutiveMcpDeadlineMs(
  context: ExecutiveRuntimeContext,
  tool: McpToolManifestRecord,
): number {
  const timeLeft = context.toolAbort.timeLeftMs() ?? 20_000;
  const cappedByLatency =
    tool.latencyClass === 'fast'
      ? 10_000
      : tool.latencyClass === 'standard'
        ? 15_000
        : 20_000;

  return Math.max(5_000, Math.min(timeLeft, cappedByLatency));
}
