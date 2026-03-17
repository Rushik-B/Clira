import { z } from 'zod';
import { progressUpdateKinds } from '@/lib/ai/progressTypes';
import {
  createSendProgressUpdateTool,
} from '@/lib/ai/tools/sendProgressUpdate';
import type {
  ExecutiveRuntimeContext,
} from './types';
import { buildContextTools } from './tools/context-tools';
import { buildCalendarMutationTools } from './tools/calendar-mutation-tools';
import { buildMessagingTools } from './tools/messaging-tools';
import {
  buildPackToolAllowlistForSelection,
  getActionPackRequestSummary,
} from './toolPacks';
import { buildExecutiveMcpTools } from './mcp/toolAdapter';
import type { ToolPackId } from './types';

const progressUpdateInputSchema = z.object({
  kind: z.enum(progressUpdateKinds).describe('Progress update category'),
  text: z.string().min(1).max(200).describe(
    'Short, one-sentence update in natural Clira voice, only when the wait is noticeable',
  ),
});

function buildUnavailableProgressUpdateTool(context: ExecutiveRuntimeContext) {
  return {
    description:
      'Send a short, human progress update only when the user would otherwise be left waiting. ' +
      'Use for genuinely long-running or multi-step work, or when escalating after a weak first result. ' +
      'Do not use for quick single-lookups.',
    inputSchema: progressUpdateInputSchema,
    execute: async () => ({
      sent: false,
      persisted: false,
      droppedReason: 'no_channel' as const,
      requestId: context.input.runContext?.runId ?? 'unavailable',
      channel: context.channel,
    }),
  };
}

function buildRequestToolPackExposureDescription(
  packIds: readonly Exclude<ToolPackId, 'safe_context_pack'>[],
): string {
  const summaries = packIds.map((packId) => `${packId}: ${getActionPackRequestSummary(packId)}`);
  return [
    'Request one or more native action packs for the next pass when safe context is not enough and you need action tools.',
    'Use this only after deciding which action pack actually fits the user request.',
    `Available action packs: ${summaries.join(' ')}`,
  ].join(' ');
}

function buildRequestToolPackExposureSchema(
  packIds: readonly Exclude<ToolPackId, 'safe_context_pack'>[],
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      packIds: {
        type: 'array',
        items: {
          type: 'string',
          enum: packIds,
        },
        uniqueItems: true,
        minItems: 1,
        maxItems: 3,
        description: 'One or more action packs to expose on the next pass.',
      },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: 240,
        description: 'Short reason for why these action tools are needed.',
      },
    },
    required: ['packIds'],
  };
}

function buildRequestToolPackExposureTool(
  context: ExecutiveRuntimeContext,
) {
  const requestableActionPackIds = (context.requestableActionPackIds ?? []).filter(
    (packId) => !context.selectedPacks.includes(packId),
  );

  if (requestableActionPackIds.length === 0) {
    return null;
  }

  return {
    description: buildRequestToolPackExposureDescription(requestableActionPackIds),
    providerInputSchema: buildRequestToolPackExposureSchema(requestableActionPackIds),
    execute: async (rawArgs: Record<string, unknown>) => {
      const args =
        rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
          ? rawArgs
          : {};
      const allowedPackIds = new Set(requestableActionPackIds);
      const requestedPackIds = Array.isArray(args.packIds)
        ? args.packIds.filter(
            (value): value is Exclude<ToolPackId, 'safe_context_pack'> =>
              typeof value === 'string' && allowedPackIds.has(value as Exclude<ToolPackId, 'safe_context_pack'>),
          )
        : [];
      const uniqueRequestedPackIds = Array.from(new Set(requestedPackIds));

      if (uniqueRequestedPackIds.length === 0) {
        return {
          ok: false,
          error: 'invalid_action_pack_selection',
          message: 'Select at least one available action pack.',
        };
      }

      return {
        ok: true,
        requestedPackIds: uniqueRequestedPackIds,
        reason:
          typeof args.reason === 'string' && args.reason.trim().length > 0
            ? args.reason.trim()
            : null,
        rerunRequired: true,
      };
    },
  };
}

function buildOrderedToolNames(context: ExecutiveRuntimeContext): string[] {
  const nativeToolNames = buildPackToolAllowlistForSelection(
    context.selectedPacks,
    context.turnFeatures,
  );
  const nativeWrapperNames: string[] = [];
  const mcpWrapperNames: string[] = [];
  const mcpToolNames: string[] = [];
  const selectableMcpServerPacks = context.mcpSelectableServerPacks ?? [];
  const selectedConnectionIds = new Set(
    context.mcpToolExposure?.selectedConnectionIds ?? [],
  );
  const requestableActionPackIds = (context.requestableActionPackIds ?? []).filter(
    (packId) => !context.selectedPacks.includes(packId),
  );

  if (requestableActionPackIds.length > 0) {
    nativeWrapperNames.push('request_tool_pack_exposure');
  }

  if (
    selectableMcpServerPacks.some(
      (pack) => !selectedConnectionIds.has(pack.connectionId),
    )
  ) {
    mcpWrapperNames.push('request_mcp_server_tools');
  }

  if ((context.mcpToolExposure?.selectedConnectionIds.length ?? 0) > 0) {
    mcpWrapperNames.push('read_content_reference');
  }
  if ((context.mcpToolExposure?.mutationTools.length ?? 0) > 0) {
    mcpWrapperNames.push('plan_mcp_action');
  }
  if (context.mcpToolExposure?.pendingAction) {
    mcpWrapperNames.push('commit_mcp_action', 'cancel_mcp_action');
  }

  for (const candidate of context.mcpToolExposure?.approvedTools ?? []) {
    mcpToolNames.push(candidate.tool.modelToolName);
  }

  return [
    ...nativeToolNames,
    ...nativeWrapperNames,
    ...mcpWrapperNames,
    ...mcpToolNames.sort((left, right) => left.localeCompare(right)),
  ];
}

export function buildExecutiveAgentTools(context: ExecutiveRuntimeContext): Record<string, unknown> {
  let subagentCallIndex = 0;
  const nextSubagentCallIndex = () => {
    const index = subagentCallIndex;
    subagentCallIndex += 1;
    return index;
  };

  const allTools: Record<string, unknown> = {
    ...buildContextTools({ context, nextSubagentCallIndex }),
    ...buildCalendarMutationTools({ context, nextSubagentCallIndex }),
    ...buildMessagingTools({ context }),
    ...buildExecutiveMcpTools({
      context,
      exposure: context.mcpToolExposure ?? null,
      selectableServerPacks: context.mcpSelectableServerPacks ?? [],
    }),
  };
  const requestToolPackExposure = buildRequestToolPackExposureTool(context);
  if (requestToolPackExposure) {
    allTools.request_tool_pack_exposure = requestToolPackExposure;
  }

  allTools.send_progress_update = context.input.progressContext
    ? createSendProgressUpdateTool({
        ...context.input.progressContext,
        canEmitProgress:
          context.input.progressContext.canEmitProgress ??
          (() => context.isBurstStable()),
      })
    : buildUnavailableProgressUpdateTool(context);

  const orderedToolNames = buildOrderedToolNames(context);

  return Object.fromEntries(
    orderedToolNames
      .filter((toolName) => toolName in allTools)
      .map((toolName) => [toolName, allTools[toolName]!]),
  );
}
