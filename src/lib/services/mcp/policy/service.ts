import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import { isMcpChannelEnabled, isMcpEnabled } from '@/lib/services/mcp/config/featureFlags';
import { loadMcpRegistrySnapshot } from '@/lib/services/mcp/registry/service';
import type {
  McpCapabilityIntent,
  McpPolicyCandidate,
  McpPolicyDecision,
  McpRegistryConnection,
  McpToolExposure,
} from '@/lib/services/mcp/types';

const MAX_APPROVED_TOOLS = 6;

function buildDecision(params: {
  channel: ProgressUpdateChannel;
  connection: McpRegistryConnection['connection'];
  actionClass: string;
  matchedIntent: boolean;
  safeForAutoUse: boolean;
}): McpPolicyDecision {
  if (!isMcpEnabled()) {
    return {
      visible: false,
      callable: false,
      requiresConfirmation: false,
      reason: 'mcp_disabled',
    };
  }

  if (!isMcpChannelEnabled(params.channel)) {
    return {
      visible: false,
      callable: false,
      requiresConfirmation: false,
      reason: 'channel_disabled',
    };
  }

  if (!params.matchedIntent) {
    return {
      visible: false,
      callable: false,
      requiresConfirmation: false,
      reason: 'intent_mismatch',
    };
  }

  if (params.connection.disabledAt || params.connection.status === 'disabled') {
    return {
      visible: true,
      callable: false,
      requiresConfirmation: false,
      reason: 'connection_disabled',
    };
  }

  if (params.actionClass !== 'read' || !params.safeForAutoUse) {
    return {
      visible: true,
      callable: false,
      requiresConfirmation: false,
      reason: 'read_only_phase',
    };
  }

  if (params.connection.circuitOpenUntil && params.connection.circuitOpenUntil.getTime() > Date.now()) {
    return {
      visible: true,
      callable: false,
      requiresConfirmation: false,
      reason: 'circuit_open',
    };
  }

  if (params.connection.status !== 'synced') {
    return {
      visible: true,
      callable: false,
      requiresConfirmation: false,
      reason: 'connection_not_ready',
    };
  }

  return {
    visible: true,
    callable: true,
    requiresConfirmation: false,
    reason: 'approved',
  };
}

function candidateRank(candidate: McpPolicyCandidate): number {
  const latencyWeight =
    candidate.tool.latencyClass === 'fast'
      ? 0
      : candidate.tool.latencyClass === 'standard'
        ? 1
        : 2;

  const capabilityWeight = candidate.tool.capabilityId === 'generic_read' ? 2 : 0;
  return latencyWeight + capabilityWeight;
}

function buildPromptSummary(params: {
  approvedTools: McpPolicyCandidate[];
  degradedTools: McpPolicyCandidate[];
}): McpToolExposure['promptSummary'] {
  const capabilityLines = params.approvedTools.map((candidate) => {
    return `${candidate.connection.displayName}: ${candidate.tool.capabilityId} via ${candidate.tool.displayTitle}`;
  });

  const degradedLines = params.degradedTools.map((candidate) => {
    const reason = candidate.connection.degradedReason ?? candidate.decision.reason;
    return `${candidate.connection.displayName}: ${candidate.tool.capabilityId} unavailable (${reason})`;
  });

  return {
    capabilityLines: Array.from(new Set(capabilityLines)).slice(0, MAX_APPROVED_TOOLS),
    degradedLines: Array.from(new Set(degradedLines)).slice(0, MAX_APPROVED_TOOLS),
  };
}

export async function resolveMcpToolExposure(params: {
  userId: string;
  channel: ProgressUpdateChannel;
  capabilityIntents: readonly McpCapabilityIntent[];
}): Promise<McpToolExposure> {
  if (params.capabilityIntents.length === 0 || !isMcpEnabled()) {
    return {
      capabilityIntents: [...params.capabilityIntents],
      approvedTools: [],
      degradedTools: [],
      promptSummary: {
        capabilityLines: [],
        degradedLines: [],
      },
    };
  }

  const snapshot = await loadMcpRegistrySnapshot(params.userId);
  const intentSet = new Set(params.capabilityIntents);
  const candidates: McpPolicyCandidate[] = [];

  for (const entry of snapshot.connections) {
    for (const tool of entry.tools) {
      const matchedIntent = intentSet.has(tool.capabilityId);
      const decision = buildDecision({
        channel: params.channel,
        connection: entry.connection,
        actionClass: tool.actionClass,
        matchedIntent,
        safeForAutoUse: tool.safeForAutoUse,
      });

      if (!decision.visible) {
        continue;
      }

      candidates.push({
        connection: entry.connection,
        tool,
        decision,
      });
    }
  }

  const approvedTools = candidates
    .filter((candidate) => candidate.decision.callable)
    .sort((left, right) => {
      const rankDelta = candidateRank(left) - candidateRank(right);
      if (rankDelta !== 0) return rankDelta;
      return left.tool.modelToolName.localeCompare(right.tool.modelToolName);
    })
    .slice(0, MAX_APPROVED_TOOLS);

  const approvedNames = new Set(approvedTools.map((candidate) => candidate.tool.modelToolName));
  const degradedTools = candidates
    .filter((candidate) => !candidate.decision.callable && !approvedNames.has(candidate.tool.modelToolName))
    .slice(0, MAX_APPROVED_TOOLS);

  return {
    capabilityIntents: [...params.capabilityIntents],
    approvedTools,
    degradedTools,
    promptSummary: buildPromptSummary({
      approvedTools,
      degradedTools,
    }),
  };
}
