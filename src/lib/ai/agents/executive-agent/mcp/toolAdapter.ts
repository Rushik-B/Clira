import { z } from 'zod';
import { executeMcpTool } from '@/lib/services/mcp/runtime/executor';
import {
  cancelPendingMcpAction,
  commitPendingMcpAction,
  planMcpMutationAction,
} from '@/lib/services/mcp/runtime/mutationFlow';
import { sanitizeMcpInlineText } from '@/lib/services/mcp/security/sanitization';
import type {
  McpToolExposure,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';
import type { ExecutiveRuntimeContext } from '@/lib/ai/agents/executive-agent/types';
import { resolveExecutiveMcpDeadlineMs } from './budgets';
import { summarizeMcpExecutionResultForModel } from './resultSummaries';

function buildToolDescription(tool: McpToolManifestRecord, connectionName: string): string {
  const summary = tool.description
    ? sanitizeMcpInlineText(tool.description, 240)
    : 'Read-only external tool.';
  return `${tool.displayTitle} via ${connectionName}. ${summary}`;
}

function summarizeSchemaFields(tool: McpToolManifestRecord): string {
  const required = Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required.filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (required.length === 0) {
    return `${tool.modelToolName}: structured args`;
  }
  return `${tool.modelToolName}: required ${required.slice(0, 4).join(', ')}`;
}

function buildPlanToolDescription(exposure: McpToolExposure): string {
  const lines = exposure.mutationTools.map((candidate) => {
    return `${candidate.connection.displayName} / ${candidate.tool.displayTitle} (${summarizeSchemaFields(candidate.tool)})`;
  });

  return [
    'Stage one external MCP mutation preview. Never execute an external mutation directly.',
    'Use this only for MCP actions that require preview and confirmation.',
    'If a pending MCP action already exists, this returns the existing preview unless forceNewPlan=true.',
    ...(lines.length > 0 ? [`Allowed targets: ${lines.join('; ')}`] : []),
  ].join(' ');
}

function buildPlanToolSchema(exposure: McpToolExposure): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      toolName: {
        type: 'string',
        enum: exposure.mutationTools.map((candidate) => candidate.tool.modelToolName),
        description: 'The staged MCP mutation target.',
      },
      args: {
        type: 'object',
        properties: {},
        additionalProperties: true,
        description: 'Structured arguments for the selected MCP mutation target.',
      },
      forceNewPlan: {
        type: 'boolean',
        description:
          'Set true only when the user explicitly asks to modify or replace an existing pending MCP action.',
      },
    },
    required: ['toolName', 'args'],
  };
}

function resolveCommitDeadlineMs(context: ExecutiveRuntimeContext): number {
  const timeLeftMs = context.toolAbort.timeLeftMs();
  if (!timeLeftMs || timeLeftMs <= 0) {
    return 15_000;
  }

  return Math.max(2_000, Math.min(timeLeftMs, 15_000));
}

function buildPendingDescription(exposure: McpToolExposure): string {
  if (!exposure.pendingAction) {
    return 'Resolve the latest pending external MCP action.';
  }

  return `Resolve the latest pending external MCP action: ${exposure.pendingAction.displayTitle}.`;
}

export function buildExecutiveMcpTools(params: {
  context: ExecutiveRuntimeContext;
  exposure: McpToolExposure | null;
}): Record<string, unknown> {
  if (!params.exposure) {
    return {};
  }

  const reuseCache = params.context.toolResultCache;

  const tools: Record<string, any> = Object.fromEntries(
    params.exposure.approvedTools.map((candidate) => [
      candidate.tool.modelToolName,
      {
        description: buildToolDescription(candidate.tool, candidate.connection.displayName),
        providerInputSchema: candidate.tool.inputSchema,
        execute: async (args: Record<string, unknown>) => {
          const cached = reuseCache.getMcp(candidate.tool.modelToolName, args);
          if (cached !== null) {
            return cached;
          }

          const result = await executeMcpTool({
            userId: params.context.input.userId,
            connectionId: candidate.connection.id,
            toolName: candidate.tool.modelToolName,
            args,
            deadlineMs: resolveExecutiveMcpDeadlineMs(params.context, candidate.tool),
            requestId: params.context.input.runContext?.runId ?? 'mcp-exec',
            conversationId: params.context.input.conversationId,
          });

          const summarized = summarizeMcpExecutionResultForModel(result);

          if (candidate.tool.actionClass === 'read' && result.ok) {
            reuseCache.setMcp(candidate.tool.modelToolName, args, summarized);
          }

          return summarized;
        },
      },
    ]),
  );

  if (params.exposure.mutationTools.length > 0) {
    tools.plan_mcp_action = {
      description: buildPlanToolDescription(params.exposure),
      providerInputSchema: buildPlanToolSchema(params.exposure),
      execute: async (rawArgs: Record<string, unknown>) => {
        const toolName =
          typeof rawArgs.toolName === 'string' ? rawArgs.toolName : '';
        const toolArgs =
          rawArgs.args && typeof rawArgs.args === 'object' && !Array.isArray(rawArgs.args)
            ? (rawArgs.args as Record<string, unknown>)
            : {};

        return planMcpMutationAction({
          userId: params.context.input.userId,
          conversationId: params.context.input.conversationId,
          modelToolName: toolName,
          args: toolArgs,
          userRequest: params.context.input.userRequest,
          forceNewPlan: rawArgs.forceNewPlan === true,
        });
      },
    };
  }

  if (params.exposure.pendingAction) {
    tools.commit_mcp_action = {
      description: `${buildPendingDescription(params.exposure)} Use only after explicit user confirmation.`,
      inputSchema: z.object({}),
      execute: async () => {
        await params.context.input.runContext?.markRunPhase?.('commit_boundary');

        return commitPendingMcpAction({
          userId: params.context.input.userId,
          conversationId: params.context.input.conversationId,
          requestId: params.context.input.runContext?.runId ?? 'mcp-commit',
          deadlineMs: resolveCommitDeadlineMs(params.context),
        });
      },
    };

    tools.cancel_mcp_action = {
      description: `${buildPendingDescription(params.exposure)} Use when the user explicitly declines or cancels it.`,
      inputSchema: z.object({}),
      execute: async () =>
        cancelPendingMcpAction({
          userId: params.context.input.userId,
          conversationId: params.context.input.conversationId,
        }),
    };
  }

  return tools;
}
