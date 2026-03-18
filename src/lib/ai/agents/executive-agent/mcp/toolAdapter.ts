import { z } from 'zod';
import { executeMcpTool } from '@/lib/services/mcp/runtime/executor';
import { readContentReference } from '@/lib/services/content-ingestion/referenceRuntime';
import {
  cancelPendingMcpAction,
  commitPendingMcpAction,
  planMcpMutationAction,
} from '@/lib/services/mcp/runtime/mutationFlow';
import { sanitizeMcpInlineText } from '@/lib/services/mcp/security/sanitization';
import type { ContentReference } from '@/lib/services/content-ingestion/types';
import type {
  McpToolExposure,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';
import type { ExecutiveRuntimeContext } from '@/lib/ai/agents/executive-agent/types';
import type { McpSelectableServerPack } from '@/lib/services/mcp/policy/service';
import { resolveExecutiveMcpDeadlineMs } from './budgets';
import { summarizeMcpExecutionResultForModel } from './resultSummaries';

function buildToolDescription(tool: McpToolManifestRecord, connectionName: string): string {
  const summary = tool.description
    ? sanitizeMcpInlineText(tool.description, 240)
    : 'Read-only external tool.';
  return `${tool.displayTitle} via ${connectionName}. ${summary} Parallelism: call this in the same step as any other independent tool calls. Every sequential step adds latency.`;
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

function resolveContentReferenceDeadlineMs(context: ExecutiveRuntimeContext): number {
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

const contentReferenceSchema = z.object({
  sourceKind: z.string().min(1),
  locator: z.string().min(1),
  displayName: z.string().trim().min(1).nullable().optional(),
  mimeHint: z.string().trim().min(1).nullable().optional(),
  trustClass: z.enum([
    'trusted_internal',
    'user_provided',
    'third_party',
    'untrusted_external',
  ]),
  requiresApproval: z.boolean(),
  capability: z.enum(['document', 'container', 'list', 'link', 'binary']),
  contentRefId: z.string().min(1),
  provenance: z.object({
    sourceLabel: z.string().min(1),
    sourceKind: z.string().trim().min(1).nullable().optional(),
    channel: z.string().trim().min(1).nullable().optional(),
    conversationId: z.string().trim().min(1).nullable().optional(),
    runId: z.string().trim().min(1).nullable().optional(),
    messageId: z.string().trim().min(1).nullable().optional(),
    attachmentId: z.string().trim().min(1).nullable().optional(),
    originUri: z.string().trim().min(1).nullable().optional(),
  }),
});

const readContentReferenceInputSchema = z.object({
  reference: contentReferenceSchema.describe(
    'A content reference copied from an earlier tool result contentRefs array.',
  ),
});

function buildReadContentReferenceDescription(): string {
  return [
    'Resolve a previously returned contentRef and extract readable text from it.',
    'Use this only with a complete reference object copied from an earlier tool result.',
    'Do not invent or modify the reference fields.',
    'IMPORTANT: When you need to read multiple content references, call this tool for ALL of them in the same step so they run in parallel. Do not read them one at a time.',
    'Only use this when inline snippets from the original MCP tool result are insufficient for the question.',
  ].join(' ');
}

function buildRequestMcpServerToolsDescription(
  selectableServerPacks: readonly McpSelectableServerPack[],
): string {
  const candidateSummary = selectableServerPacks
    .map((pack) => `${pack.displayName} (${pack.serverKey})`)
    .join('; ');

  return [
    'Request MCP server tools for the next pass when native tools are insufficient and you need an external integration.',
    'Use this only after deciding which available MCP server pack actually fits the user request.',
    `Available MCP server packs: ${candidateSummary}.`,
  ].join(' ');
}

function buildRequestMcpServerToolsSchema(
  selectableServerPacks: readonly McpSelectableServerPack[],
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      connectionIds: {
        type: 'array',
        items: {
          type: 'string',
          enum: selectableServerPacks.map((pack) => pack.connectionId),
        },
        uniqueItems: true,
        minItems: 1,
        maxItems: 2,
        description: 'One or two MCP server packs to expose on the next pass.',
      },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: 240,
        description: 'Short reason for why these MCP tools are needed.',
      },
    },
    required: ['connectionIds'],
  };
}

export function buildExecutiveMcpTools(params: {
  context: ExecutiveRuntimeContext;
  exposure: McpToolExposure | null;
  selectableServerPacks?: readonly McpSelectableServerPack[] | null;
}): Record<string, unknown> {
  const reuseCache = params.context.toolResultCache;
  const selectedConnectionIds = new Set(params.exposure?.selectedConnectionIds ?? []);
  const selectableServerPacks = (params.selectableServerPacks ?? []).filter(
    (pack) => !selectedConnectionIds.has(pack.connectionId),
  );
  const tools: Record<string, any> = {};

  if (selectableServerPacks.length > 0) {
    tools.request_mcp_server_tools = {
      description: buildRequestMcpServerToolsDescription(selectableServerPacks),
      providerInputSchema: buildRequestMcpServerToolsSchema(selectableServerPacks),
      execute: async (rawArgs: Record<string, unknown>) => {
        const args =
          rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
            ? rawArgs
            : {};
        const allowedConnectionIds = new Set(
          selectableServerPacks.map((pack) => pack.connectionId),
        );
        const requestedConnectionIds = Array.isArray(args.connectionIds)
          ? args.connectionIds.filter(
              (value): value is string =>
                typeof value === 'string' && allowedConnectionIds.has(value),
            )
          : [];
        const uniqueRequestedConnectionIds = Array.from(new Set(requestedConnectionIds));

        if (uniqueRequestedConnectionIds.length === 0) {
          return {
            ok: false,
            error: 'invalid_mcp_server_selection',
            message: 'Select at least one available MCP server pack.',
          };
        }

        const requestedPacks = selectableServerPacks.filter((pack) =>
          uniqueRequestedConnectionIds.includes(pack.connectionId),
        );

        return {
          ok: true,
          requestedConnectionIds: uniqueRequestedConnectionIds,
          requestedServerKeys: requestedPacks.map((pack) => pack.serverKey),
          requestedDisplayNames: requestedPacks.map((pack) => pack.displayName),
          reason:
            typeof args.reason === 'string' && args.reason.trim().length > 0
              ? args.reason.trim()
              : null,
          rerunRequired: true,
        };
      },
    };
  }

  if (!params.exposure) {
    return tools;
  }

  Object.assign(
    tools,
    Object.fromEntries(
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
    ),
  );

  tools.read_content_reference = {
    description: buildReadContentReferenceDescription(),
    inputSchema: readContentReferenceInputSchema,
    execute: async (rawArgs: Record<string, unknown>) => {
      const parsed = readContentReferenceInputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          ok: false,
          error: 'invalid_content_reference_arguments',
          message: 'A complete content reference object is required.',
        };
      }

      return readContentReference({
        userId: params.context.input.userId,
        reference: parsed.data.reference as ContentReference,
        conversationId: params.context.input.conversationId,
        runId: params.context.input.runContext?.runId ?? 'mcp-content-ref',
        deadlineMs: resolveContentReferenceDeadlineMs(params.context),
      });
    },
  };

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
