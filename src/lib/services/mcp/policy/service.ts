import type { ProgressUpdateChannel } from '@/lib/ai/progressTypes';
import { isMcpChannelEnabled, isMcpEnabled } from '@/lib/services/mcp/config/featureFlags';
import { loadMcpRegistrySnapshot } from '@/lib/services/mcp/registry/service';
import { getLatestPendingMcpAction } from '@/lib/services/mcp/runtime/mutationFlow';
import type {
  McpPolicyCandidate,
  McpPolicyDecision,
  McpRegistryConnection,
  McpToolExposure,
} from '@/lib/services/mcp/types';

const MAX_APPROVED_TOOLS = 50;

function buildDecision(params: {
  channel: ProgressUpdateChannel;
  connection: McpRegistryConnection['connection'];
  actionClass: string;
  selected: boolean;
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

  if (!params.selected) {
    return {
      visible: false,
      callable: false,
      requiresConfirmation: false,
      reason: 'connection_not_selected',
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

  if (params.actionClass !== 'read') {
    if (params.connection.trustClass === 'third_party') {
      return {
        visible: true,
        callable: false,
        requiresConfirmation: false,
        reason: 'third_party_mutation_blocked',
      };
    }

    return {
      visible: true,
      callable: false,
      requiresConfirmation: true,
      reason: 'preview_required',
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

  return latencyWeight;
}

function buildPromptSummary(params: {
  approvedTools: McpPolicyCandidate[];
  mutationTools: McpPolicyCandidate[];
  degradedTools: McpPolicyCandidate[];
}): McpToolExposure['promptSummary'] {
  const toolSummaryLines = [
    ...params.approvedTools.map((candidate) => {
      return `${candidate.connection.displayName}: ${candidate.tool.displayTitle} (${candidate.tool.actionClass})`;
    }),
    ...params.mutationTools.map((candidate) => {
      return `${candidate.connection.displayName}: ${candidate.tool.displayTitle} (${candidate.tool.actionClass}, preview required)`;
    }),
  ];

  const degradedLines = params.degradedTools.map((candidate) => {
    const reason = candidate.connection.degradedReason ?? candidate.decision.reason;
    return `${candidate.connection.displayName}: ${candidate.tool.displayTitle} unavailable (${reason})`;
  });

  return {
    toolSummaryLines: Array.from(new Set(toolSummaryLines)).slice(0, MAX_APPROVED_TOOLS),
    degradedLines: Array.from(new Set(degradedLines)).slice(0, MAX_APPROVED_TOOLS),
  };
}

export async function resolveMcpToolExposure(params: {
  userId: string;
  conversationId?: string;
  channel: ProgressUpdateChannel;
  selectedConnectionIds: readonly string[];
}): Promise<McpToolExposure> {
  if (!isMcpEnabled()) {
    return {
      selectedConnectionIds: [...params.selectedConnectionIds],
      approvedTools: [],
      mutationTools: [],
      degradedTools: [],
      pendingAction: null,
      promptSummary: {
        toolSummaryLines: [],
        degradedLines: [],
      },
    };
  }

  const pendingAction = params.conversationId
    ? await getLatestPendingMcpAction({
        userId: params.userId,
        conversationId: params.conversationId,
      })
    : null;

  if (params.selectedConnectionIds.length === 0) {
    return {
      selectedConnectionIds: [...params.selectedConnectionIds],
      approvedTools: [],
      mutationTools: [],
      degradedTools: [],
      pendingAction,
      promptSummary: {
        toolSummaryLines: [],
        degradedLines: [],
      },
    };
  }

  const snapshot = await loadMcpRegistrySnapshot(params.userId);
  const connectionSet = new Set(params.selectedConnectionIds);
  const candidates: McpPolicyCandidate[] = [];

  for (const entry of snapshot.connections) {
    for (const tool of entry.tools) {
      const selected = connectionSet.has(entry.connection.id);
      const decision = buildDecision({
        channel: params.channel,
        connection: entry.connection,
        actionClass: tool.actionClass,
        selected,
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
      const titleDelta = left.tool.displayTitle.localeCompare(right.tool.displayTitle);
      if (titleDelta !== 0) return titleDelta;
      return left.tool.modelToolName.localeCompare(right.tool.modelToolName);
    })
    .slice(0, MAX_APPROVED_TOOLS);

  const mutationTools = candidates
    .filter((candidate) => candidate.decision.requiresConfirmation)
    .sort((left, right) => {
      const titleDelta = left.tool.displayTitle.localeCompare(right.tool.displayTitle);
      if (titleDelta !== 0) return titleDelta;
      return left.tool.modelToolName.localeCompare(right.tool.modelToolName);
    })
    .slice(0, MAX_APPROVED_TOOLS);

  const approvedNames = new Set([
    ...approvedTools.map((candidate) => candidate.tool.modelToolName),
    ...mutationTools.map((candidate) => candidate.tool.modelToolName),
  ]);
  const degradedTools = candidates
    .filter((candidate) => !candidate.decision.callable && !approvedNames.has(candidate.tool.modelToolName))
    .slice(0, MAX_APPROVED_TOOLS);

  return {
    selectedConnectionIds: [...params.selectedConnectionIds],
    approvedTools,
    mutationTools,
    degradedTools,
    pendingAction,
    promptSummary: buildPromptSummary({
      approvedTools,
      mutationTools,
      degradedTools,
    }),
  };
}
