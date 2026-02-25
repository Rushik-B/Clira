import {
  createSendProgressUpdateTool,
} from '@/lib/ai/tools/sendProgressUpdate';
import type {
  ExecutiveRuntimeContext,
} from './types';
import { buildContextTools } from './tools/context-tools';
import { buildCalendarMutationTools } from './tools/calendar-mutation-tools';
import { buildMessagingTools } from './tools/messaging-tools';

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

  if (context.input.progressContext) {
    tools.send_progress_update = createSendProgressUpdateTool({
      ...context.input.progressContext,
      canEmitProgress:
        context.input.progressContext.canEmitProgress ??
        (() => context.isBurstStable()),
    });
  }

  return tools;
}
