import { executeMcpTool } from '@/lib/services/mcp/runtime/executor';
import { sanitizeMcpText } from '@/lib/services/mcp/security/sanitization';
import type {
  McpToolExposure,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';
import type { ExecutiveRuntimeContext } from '@/lib/ai/agents/executive-agent/types';
import { resolveExecutiveMcpDeadlineMs } from './budgets';

function buildToolDescription(tool: McpToolManifestRecord, connectionName: string): string {
  const summary = tool.description ? sanitizeMcpText(tool.description, 240) : 'Read-only external tool.';
  return `${tool.displayTitle} via ${connectionName}. ${summary}`;
}

export function buildExecutiveMcpTools(params: {
  context: ExecutiveRuntimeContext;
  exposure: McpToolExposure | null;
}): Record<string, unknown> {
  if (!params.exposure || params.exposure.approvedTools.length === 0) {
    return {};
  }

  return Object.fromEntries(
    params.exposure.approvedTools.map((candidate) => [
      candidate.tool.modelToolName,
      {
        description: buildToolDescription(candidate.tool, candidate.connection.displayName),
        providerInputSchema: candidate.tool.inputSchema,
        execute: async (args: Record<string, unknown>) =>
          executeMcpTool({
            userId: params.context.input.userId,
            connectionId: candidate.connection.id,
            toolName: candidate.tool.modelToolName,
            args,
            deadlineMs: resolveExecutiveMcpDeadlineMs(params.context, candidate.tool),
            requestId: params.context.input.runContext?.runId ?? 'mcp-exec',
            conversationId: params.context.input.conversationId,
          }),
      },
    ]),
  );
}
