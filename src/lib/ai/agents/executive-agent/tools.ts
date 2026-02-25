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

const progressUpdateInputSchema = z.object({
  kind: z.enum(progressUpdateKinds).describe('Progress update category'),
  text: z.string().min(1).max(200).describe('Short, one-sentence update in Clira voice'),
});

function buildUnavailableProgressUpdateTool(context: ExecutiveRuntimeContext) {
  return {
    description:
      'Send a short, human progress update to the user. ' +
      'Use for quick acknowledgments, deep-search updates, or long-running tasks.',
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

export function buildExecutiveAgentTools(context: ExecutiveRuntimeContext): Record<string, unknown> {
  let subagentCallIndex = 0;
  const nextSubagentCallIndex = () => {
    const index = subagentCallIndex;
    subagentCallIndex += 1;
    return index;
  };

  const tools: Record<string, unknown> = {
    ...buildContextTools({ context, nextSubagentCallIndex }),
    ...buildCalendarMutationTools({ context, nextSubagentCallIndex }),
    ...buildMessagingTools({ context }),
  };

  tools.send_progress_update = context.input.progressContext
    ? createSendProgressUpdateTool({
        ...context.input.progressContext,
        canEmitProgress:
          context.input.progressContext.canEmitProgress ??
          (() => context.isBurstStable()),
      })
    : buildUnavailableProgressUpdateTool(context);

  return tools;
}
