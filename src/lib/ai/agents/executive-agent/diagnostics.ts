import type { Prisma } from '@prisma/client';
import { stripUndefined } from './helpers';
import type {
  ExecutiveWorkingState,
} from './types';
import type {
  McpToolExposure,
} from '@/lib/services/mcp/types';

export type McpServerLogEntry = {
  connectionId: string;
  serverKey: string;
  displayName: string;
  status: string;
  approvedToolCount: number;
  mutationToolCount: number;
  degradedToolCount: number;
};

export function summarizeMcpServersForLogs(
  exposure: McpToolExposure | null,
  selectedConnectionIds: readonly string[],
): McpServerLogEntry[] {
  if (!exposure) {
    return [];
  }

  const byConnectionId = new Map<string, McpServerLogEntry>();

  const ensure = (
    candidate:
      | McpToolExposure['approvedTools'][number]
      | McpToolExposure['mutationTools'][number]
      | McpToolExposure['degradedTools'][number],
  ): McpServerLogEntry => {
    const existing = byConnectionId.get(candidate.connection.id);
    if (existing) {
      return existing;
    }

    const created: McpServerLogEntry = {
      connectionId: candidate.connection.id,
      serverKey: candidate.connection.serverKey,
      displayName: candidate.connection.displayName,
      status: selectedConnectionIds.includes(candidate.connection.id)
        ? candidate.connection.status
        : 'not_selected',
      approvedToolCount: 0,
      mutationToolCount: 0,
      degradedToolCount: 0,
    };
    byConnectionId.set(candidate.connection.id, created);
    return created;
  };

  for (const candidate of exposure.approvedTools) {
    ensure(candidate).approvedToolCount += 1;
  }

  for (const candidate of exposure.mutationTools) {
    ensure(candidate).mutationToolCount += 1;
  }

  for (const candidate of exposure.degradedTools) {
    ensure(candidate).degradedToolCount += 1;
  }

  return [...byConnectionId.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

export function summarizeToolInventoryForLogs(params: {
  tools: Record<string, unknown>;
  mcpServers: readonly McpServerLogEntry[];
}) {
  const allToolNames = Object.keys(params.tools).sort();
  const mcpToolNames = allToolNames.filter((name) => name.startsWith('mcp__'));
  const mcpWrapperToolNames = allToolNames.filter((name) =>
    ['plan_mcp_action', 'commit_mcp_action', 'cancel_mcp_action'].includes(name),
  );
  const nativeToolNames = allToolNames.filter(
    (name) => !mcpToolNames.includes(name) && !mcpWrapperToolNames.includes(name),
  );

  return {
    toolCount: allToolNames.length,
    nativeToolCount: nativeToolNames.length,
    mcpToolCount: mcpToolNames.length,
    mcpWrapperToolCount: mcpWrapperToolNames.length,
    nativeTools: nativeToolNames,
    mcpToolPreview: mcpToolNames.slice(0, 12),
    mcpToolOverflowCount: Math.max(0, mcpToolNames.length - 12),
    mcpServers: params.mcpServers,
  };
}

export function buildHarnessMetadata(params: {
  selectedPack: string | null;
  selectedPacks: readonly string[];
  mcpConnectionIds: readonly string[];
  selectorReasons: readonly string[];
  workingState: ExecutiveWorkingState | null;
  promptVersion: string;
  packVersion: string;
}): Prisma.InputJsonValue | undefined {
  if (!params.selectedPack || !params.workingState) {
    return undefined;
  }

  return stripUndefined({
    selectedPack: params.selectedPack,
    selectedPacks: params.selectedPacks,
    mcpConnectionIds: params.mcpConnectionIds,
    selectorReasons: params.selectorReasons,
    workingState: params.workingState,
    promptVersion: params.promptVersion,
    packVersion: params.packVersion,
  }) as unknown as Prisma.InputJsonValue;
}

export function buildOrchestrationMetadata(params: {
  runContext?: {
    runId: string;
    burstId: string;
    classifierDecision?: 'supersede' | 'followup' | 'ambiguous' | null;
    droppedSummary?: string[];
  } | null;
  steerMetadata: Prisma.InputJsonValue | null;
}): Prisma.InputJsonValue | undefined {
  if (!params.runContext) {
    return undefined;
  }

  return {
    runId: params.runContext.runId,
    burstId: params.runContext.burstId,
    classifierDecision: params.runContext.classifierDecision ?? null,
    queueOverflowSummary:
      (params.runContext.droppedSummary ?? []).length > 0
        ? {
            droppedCount: (params.runContext.droppedSummary ?? []).length,
            droppedMessages: params.runContext.droppedSummary ?? [],
          }
        : null,
    steer: params.steerMetadata,
  } as Prisma.InputJsonValue;
}
