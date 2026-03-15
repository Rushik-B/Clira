import crypto from 'crypto';
import {
  McpActionClass as PrismaMcpActionClass,
  McpTrustClass as PrismaMcpTrustClass,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getMcpManifestByModelToolName } from '@/lib/services/mcp/registry/service';
import { executeMcpTool } from '@/lib/services/mcp/runtime/executor';
import {
  sanitizeMcpInlineText,
  stringifySanitizedMcpJson,
} from '@/lib/services/mcp/security/sanitization';
import { validateMcpArgsAgainstSchema } from '@/lib/services/mcp/security/schemaValidation';
import { toPrismaJsonObject } from '@/lib/services/mcp/utils/prismaJson';
import {
  type McpActionClass,
  type McpPendingActionRecord,
  type McpPendingActionStatus,
  type McpTrustClass,
} from '@/lib/services/mcp/types';

const PENDING_MCP_ACTION_TTL_MS = 12 * 60 * 60 * 1000;
const PENDING_ACTION_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  CONSUMED: 'CONSUMED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;

const PENDING_ACTION_SELECT = {
  id: true,
  userId: true,
  conversationId: true,
  connectionId: true,
  toolName: true,
  modelToolName: true,
  displayTitle: true,
  actionClass: true,
  trustClass: true,
  userRequest: true,
  args: true,
  previewText: true,
  previewSummary: true,
  status: true,
  idempotencyKey: true,
  expiresAt: true,
  consumedAt: true,
  cancelledAt: true,
  resultSummary: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PendingActionRow = Prisma.PendingMcpActionGetPayload<{
  select: typeof PENDING_ACTION_SELECT;
}>;

function fromPrismaActionClass(value: PrismaMcpActionClass): McpActionClass {
  switch (value) {
    case 'READ':
      return 'read';
    case 'WRITE':
      return 'write';
    case 'DELETE':
      return 'delete';
    default:
      return 'side_effectful';
  }
}

function fromPrismaTrustClass(value: PrismaMcpTrustClass): McpTrustClass {
  switch (value) {
    case 'FIRST_PARTY':
      return 'first_party';
    case 'THIRD_PARTY':
      return 'third_party';
    default:
      return 'user_configured';
  }
}

function toPrismaActionClass(value: McpActionClass): PrismaMcpActionClass {
  switch (value) {
    case 'read':
      return 'READ';
    case 'write':
      return 'WRITE';
    case 'delete':
      return 'DELETE';
    default:
      return 'SIDE_EFFECTFUL';
  }
}

function toPrismaTrustClass(value: McpTrustClass): PrismaMcpTrustClass {
  switch (value) {
    case 'first_party':
      return 'FIRST_PARTY';
    case 'third_party':
      return 'THIRD_PARTY';
    default:
      return 'USER_CONFIGURED';
  }
}

function fromPrismaPendingStatus(
  value: (typeof PENDING_ACTION_STATUS)[keyof typeof PENDING_ACTION_STATUS],
): McpPendingActionStatus {
  switch (value) {
    case 'IN_PROGRESS':
      return 'in_progress';
    case 'CONSUMED':
      return 'consumed';
    case 'CANCELLED':
      return 'cancelled';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'pending';
  }
}

function toPendingActionRecord(row: PendingActionRow): McpPendingActionRecord {
  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    connectionId: row.connectionId,
    toolName: row.toolName,
    modelToolName: row.modelToolName,
    displayTitle: row.displayTitle,
    actionClass: fromPrismaActionClass(row.actionClass),
    trustClass: fromPrismaTrustClass(row.trustClass),
    userRequest: row.userRequest,
    args: row.args as Record<string, unknown>,
    previewText: row.previewText,
    previewSummary: row.previewSummary as Record<string, unknown> | null,
    status: fromPrismaPendingStatus(row.status),
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    cancelledAt: row.cancelledAt,
    resultSummary: row.resultSummary as Record<string, unknown> | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function buildMcpActionIdempotencyKey(params: {
  userId: string;
  conversationId: string;
  connectionId: string;
  modelToolName: string;
  args: Record<string, unknown>;
}): string {
  const hash = crypto.createHash('sha256');
  hash.update(params.userId);
  hash.update(':');
  hash.update(params.conversationId);
  hash.update(':');
  hash.update(params.connectionId);
  hash.update(':');
  hash.update(params.modelToolName);
  hash.update(':');
  hash.update(stableStringify(params.args));
  return hash.digest('hex');
}

function buildPreviewText(params: {
  connectionDisplayName: string;
  displayTitle: string;
  actionClass: McpActionClass;
  trustClass: McpTrustClass;
  args: Record<string, unknown>;
}): string {
  const actionLine =
    params.actionClass === 'delete'
      ? 'delete'
      : params.actionClass === 'write'
        ? 'update'
        : 'run';

  return [
    '**Ready to run external action**',
    '',
    `${params.displayTitle} via ${params.connectionDisplayName}`,
    `Effect: ${actionLine}`,
    `Trust: ${params.trustClass}`,
    `Args: ${stringifySanitizedMcpJson(params.args, 3, 420)}`,
    '',
    "Reply **confirm** and I'll run it. Reply **cancel** to drop it.",
  ].join('\n');
}

function buildPendingActionEnvelope(record: McpPendingActionRecord) {
  return {
    pendingId: record.id,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    status: record.status,
    actionClass: record.actionClass,
    modelToolName: record.modelToolName,
  };
}

function buildStoredResultMessage(
  record: McpPendingActionRecord,
  fallback: string,
): string {
  const storedMessage = record.resultSummary?.message;
  return typeof storedMessage === 'string' && storedMessage.trim()
    ? storedMessage
    : fallback;
}

async function getLatestPendingAction(params: {
  userId: string;
  conversationId: string;
}): Promise<McpPendingActionRecord | null> {
  const row = await prisma.pendingMcpAction.findFirst({
    where: {
      userId: params.userId,
      conversationId: params.conversationId,
      status: {
        in: [
          PENDING_ACTION_STATUS.PENDING,
          PENDING_ACTION_STATUS.IN_PROGRESS,
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: PENDING_ACTION_SELECT,
  });

  return row ? toPendingActionRecord(row) : null;
}

async function getLatestPendingOrResolvedAction(params: {
  userId: string;
  conversationId: string;
}): Promise<McpPendingActionRecord | null> {
  const row = await prisma.pendingMcpAction.findFirst({
    where: {
      userId: params.userId,
      conversationId: params.conversationId,
      status: {
        in: [
          PENDING_ACTION_STATUS.PENDING,
          PENDING_ACTION_STATUS.IN_PROGRESS,
          PENDING_ACTION_STATUS.CONSUMED,
          PENDING_ACTION_STATUS.CANCELLED,
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: PENDING_ACTION_SELECT,
  });

  return row ? toPendingActionRecord(row) : null;
}

export async function getLatestPendingMcpAction(params: {
  userId: string;
  conversationId: string;
}): Promise<McpPendingActionRecord | null> {
  return getLatestPendingAction(params);
}

export async function planMcpMutationAction(params: {
  userId: string;
  conversationId: string;
  modelToolName: string;
  args: Record<string, unknown>;
  userRequest: string;
  forceNewPlan?: boolean;
}): Promise<Record<string, unknown>> {
  const registryEntry = await getMcpManifestByModelToolName({
    userId: params.userId,
    modelToolName: params.modelToolName,
  });

  if (!registryEntry) {
    return {
      ok: false,
      error: 'tool_not_found',
      message: 'That MCP action is no longer available. Please refresh and try again.',
    };
  }

  if (registryEntry.tool.actionClass === 'read') {
    return {
      ok: false,
      error: 'mutation_required',
      message: 'That MCP tool is read-only and does not need confirmation.',
    };
  }

  if (registryEntry.connection.trustClass === 'third_party') {
    return {
      ok: false,
      error: 'third_party_mutation_blocked',
      message: 'Third-party MCP mutations are blocked in this stage.',
    };
  }

  const validationIssues = validateMcpArgsAgainstSchema({
    args: params.args,
    schema: registryEntry.tool.inputSchema,
  });
  if (validationIssues.length > 0) {
    return {
      ok: false,
      error: 'invalid_arguments',
      message: sanitizeMcpInlineText(
        `Invalid MCP arguments: ${validationIssues
          .slice(0, 3)
          .map((issue) => `${issue.path} ${issue.message}`)
          .join('; ')}`,
        320,
      ),
    };
  }

  const existingPending = await getLatestPendingAction({
    userId: params.userId,
    conversationId: params.conversationId,
  });

  if (existingPending && !params.forceNewPlan) {
    if (existingPending.status === 'in_progress') {
      return {
        ok: false,
        error: 'pending_action_in_progress',
        message: 'An external action is already being processed. Please wait a moment.',
        pendingAction: buildPendingActionEnvelope(existingPending),
      };
    }

    return {
      ok: true,
      previewText: existingPending.previewText,
      pendingAction: buildPendingActionEnvelope(existingPending),
      note: 'Pending MCP action already exists. Confirm, cancel, or explicitly re-plan it.',
    };
  }

  if (existingPending && params.forceNewPlan) {
    await prisma.pendingMcpAction.updateMany({
      where: {
        userId: params.userId,
        conversationId: params.conversationId,
        status: {
          in: [
            PENDING_ACTION_STATUS.PENDING,
            PENDING_ACTION_STATUS.IN_PROGRESS,
          ],
        },
      },
      data: {
        status: PENDING_ACTION_STATUS.CANCELLED,
        cancelledAt: new Date(),
      },
    });
  }

  const idempotencyKey = buildMcpActionIdempotencyKey({
    userId: params.userId,
    conversationId: params.conversationId,
    connectionId: registryEntry.connection.id,
    modelToolName: registryEntry.tool.modelToolName,
    args: params.args,
  });

  const previewSummary = {
    connectionDisplayName: registryEntry.connection.displayName,
    displayTitle: registryEntry.tool.displayTitle,
    actionClass: registryEntry.tool.actionClass,
    trustClass: registryEntry.connection.trustClass,
    argsPreview: stringifySanitizedMcpJson(params.args, 3, 300),
  } satisfies Prisma.InputJsonObject;

  const previewText = buildPreviewText({
    connectionDisplayName: registryEntry.connection.displayName,
    displayTitle: registryEntry.tool.displayTitle,
    actionClass: registryEntry.tool.actionClass,
    trustClass: registryEntry.connection.trustClass,
    args: params.args,
  });

  const created = await prisma.pendingMcpAction.create({
    data: {
      userId: params.userId,
      conversationId: params.conversationId,
      connectionId: registryEntry.connection.id,
      toolName: registryEntry.tool.toolName,
      modelToolName: registryEntry.tool.modelToolName,
      displayTitle: registryEntry.tool.displayTitle,
      actionClass: toPrismaActionClass(registryEntry.tool.actionClass),
      trustClass: toPrismaTrustClass(registryEntry.connection.trustClass),
      userRequest: params.userRequest,
      args: toPrismaJsonObject(params.args),
      previewText,
      previewSummary: toPrismaJsonObject(previewSummary),
      idempotencyKey,
      expiresAt: new Date(Date.now() + PENDING_MCP_ACTION_TTL_MS),
    },
    select: PENDING_ACTION_SELECT,
  });

  const pendingAction = toPendingActionRecord(created);
  return {
    ok: true,
    previewText,
    pendingAction: buildPendingActionEnvelope(pendingAction),
  };
}

export async function commitPendingMcpAction(params: {
  userId: string;
  conversationId: string;
  requestId: string;
  deadlineMs: number;
}): Promise<Record<string, unknown>> {
  const latestPending = await getLatestPendingOrResolvedAction({
    userId: params.userId,
    conversationId: params.conversationId,
  });

  if (!latestPending) {
    return {
      ok: false,
      error: 'pending_action_missing',
      message: 'No pending external action found. Please plan it again first.',
    };
  }

  if (latestPending.status === 'consumed') {
    return {
      ok: true,
      status: 'consumed',
      replayed: true,
      message: buildStoredResultMessage(
        latestPending,
        'That external action already completed.',
      ),
      pendingAction: buildPendingActionEnvelope(latestPending),
    };
  }

  if (latestPending.status === 'cancelled') {
    return {
      ok: true,
      status: 'cancelled',
      replayed: true,
      message: buildStoredResultMessage(
        latestPending,
        'That external action was already cancelled.',
      ),
      pendingAction: buildPendingActionEnvelope(latestPending),
    };
  }

  if (Date.now() > latestPending.expiresAt.getTime()) {
    await prisma.pendingMcpAction.updateMany({
      where: {
        id: latestPending.id,
        status: {
          in: [
            PENDING_ACTION_STATUS.PENDING,
            PENDING_ACTION_STATUS.IN_PROGRESS,
          ],
        },
      },
      data: {
        status: PENDING_ACTION_STATUS.EXPIRED,
      },
    });

    return {
      ok: false,
      error: 'pending_action_expired',
      message: 'That external action preview expired. Please stage it again.',
    };
  }

  if (latestPending.status === 'in_progress') {
    return {
      ok: false,
      error: 'pending_action_in_progress',
      message: 'That external action is already being processed. Please wait a moment.',
    };
  }

  const claim = await prisma.pendingMcpAction.updateMany({
    where: {
      id: latestPending.id,
      status: PENDING_ACTION_STATUS.PENDING,
    },
    data: {
      status: PENDING_ACTION_STATUS.IN_PROGRESS,
    },
  });

  if (claim.count !== 1) {
    return {
      ok: false,
      error: 'pending_action_in_progress',
      message: 'That external action is already being processed.',
    };
  }

  const releasePending = async (resultSummary: Prisma.InputJsonObject) => {
    await prisma.pendingMcpAction.update({
      where: { id: latestPending.id },
      data: {
        status: PENDING_ACTION_STATUS.PENDING,
        resultSummary: toPrismaJsonObject(resultSummary),
      },
    });
  };

  const cancelPending = async (resultSummary: Prisma.InputJsonObject) => {
    await prisma.pendingMcpAction.update({
      where: { id: latestPending.id },
      data: {
        status: PENDING_ACTION_STATUS.CANCELLED,
        cancelledAt: new Date(),
        resultSummary: toPrismaJsonObject(resultSummary),
      },
    });
  };

  const consumePending = async (resultSummary: Prisma.InputJsonObject) => {
    await prisma.pendingMcpAction.update({
      where: { id: latestPending.id },
      data: {
        status: PENDING_ACTION_STATUS.CONSUMED,
        consumedAt: new Date(),
        resultSummary: toPrismaJsonObject(resultSummary),
      },
    });
  };

  const executionResult = await executeMcpTool({
    userId: params.userId,
    connectionId: latestPending.connectionId,
    toolName: latestPending.modelToolName,
    args: latestPending.args,
    deadlineMs: params.deadlineMs,
    requestId: params.requestId,
    conversationId: params.conversationId,
    idempotencyKey: latestPending.idempotencyKey,
    mutationApproval: 'confirmed',
  });

  if (!executionResult.ok) {
    const failureMessage =
      executionResult.userFacingDegradedReason ??
      'I could not complete that external action.';
    const resultSummary = {
      ok: false,
      message: failureMessage,
      errorClass: executionResult.errorClass ?? 'execution_failed',
    } satisfies Prisma.InputJsonObject;

    if (
      executionResult.errorClass === 'tool_not_found' ||
      executionResult.errorClass === 'connection_not_found'
    ) {
      await cancelPending(resultSummary);
      return {
        ok: false,
        status: 'cancelled',
        error: executionResult.errorClass ?? 'execution_failed',
        message: failureMessage,
      };
    }

    await releasePending(resultSummary);
    return {
      ok: false,
      status: 'failed',
      error: executionResult.errorClass ?? 'execution_failed',
      message: failureMessage,
    };
  }

  const successMessage = sanitizeMcpInlineText(
    `${latestPending.displayTitle} completed via ${executionResult.displayName}.`,
    220,
  );
  const resultSummary = {
    ok: true,
    message: successMessage,
    displayName: executionResult.displayName,
    toolName: latestPending.modelToolName,
  } satisfies Prisma.InputJsonObject;
  await consumePending(resultSummary);

  return {
    ok: true,
    status: 'consumed',
    message: successMessage,
    pendingAction: buildPendingActionEnvelope(latestPending),
  };
}

export async function cancelPendingMcpAction(params: {
  userId: string;
  conversationId: string;
}): Promise<Record<string, unknown>> {
  const latestPending = await getLatestPendingOrResolvedAction({
    userId: params.userId,
    conversationId: params.conversationId,
  });

  if (!latestPending) {
    return {
      ok: false,
      error: 'pending_action_missing',
      message: 'No pending external action found to cancel.',
    };
  }

  if (latestPending.status === 'cancelled') {
    return {
      ok: true,
      status: 'cancelled',
      replayed: true,
      message: buildStoredResultMessage(
        latestPending,
        'That external action was already cancelled.',
      ),
    };
  }

  if (latestPending.status === 'consumed') {
    return {
      ok: false,
      error: 'pending_action_already_completed',
      message: buildStoredResultMessage(
        latestPending,
        'That external action already completed and can no longer be cancelled.',
      ),
    };
  }

  if (latestPending.status === 'in_progress') {
    return {
      ok: false,
      error: 'pending_action_in_progress',
      message: 'That external action is already being processed and cannot be cancelled now.',
    };
  }

  const cancelMessage = 'Okay, I cancelled that pending external action.';
  await prisma.pendingMcpAction.update({
    where: { id: latestPending.id },
    data: {
      status: PENDING_ACTION_STATUS.CANCELLED,
      cancelledAt: new Date(),
      resultSummary: toPrismaJsonObject({
        ok: true,
        message: cancelMessage,
      }),
    },
  });

  return {
    ok: true,
    status: 'cancelled',
    message: cancelMessage,
    pendingAction: buildPendingActionEnvelope(latestPending),
  };
}
