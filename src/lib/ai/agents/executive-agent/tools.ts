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
import { buildPackToolAllowlistForSelection } from './toolPacks';
import { buildExecutiveMcpTools } from './mcp/toolAdapter';

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

function orderToolsDeterministically(
  tools: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(tools).sort(([left], [right]) => left.localeCompare(right)),
  );
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
    }),
  };

  allTools.send_progress_update = context.input.progressContext
    ? createSendProgressUpdateTool({
        ...context.input.progressContext,
        canEmitProgress:
          context.input.progressContext.canEmitProgress ??
          (() => context.isBurstStable()),
      })
    : buildUnavailableProgressUpdateTool(context);

  const allowlist = new Set<string>(
    buildPackToolAllowlistForSelection(context.selectedPacks, context.turnFeatures),
  );
  for (const candidate of context.mcpToolExposure?.approvedTools ?? []) {
    allowlist.add(candidate.tool.modelToolName);
  }
  if ((context.mcpToolExposure?.mutationTools.length ?? 0) > 0) {
    allowlist.add('plan_mcp_action');
  }
  if (context.mcpToolExposure?.pendingAction) {
    allowlist.add('commit_mcp_action');
    allowlist.add('cancel_mcp_action');
  }

  const filteredTools = Object.fromEntries(
    Object.entries(allTools).filter(([toolName]) => allowlist.has(toolName)),
  );

  return orderToolsDeterministically(filteredTools);
}
