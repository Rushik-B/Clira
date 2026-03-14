import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateMcpConnectionSchema } from '@/lib/ai/schemas/mcpSchemas';
import { isUnauthorizedError, requireUserId, unauthorizedResponse } from '@/app/api/user/settings/shared';
import {
  deleteMcpConnection,
  getMcpConnectionForUser,
  updateMcpConnection,
} from '@/lib/services/mcp/connections/service';
import { invalidateConnectionCaches } from '@/lib/services/mcp/registry/cache';
import { enqueueMcpSyncConnectionJob } from '@/lib/services/mcp/workers/queue';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { connectionId } = await context.params;
    const connection = await getMcpConnectionForUser({ connectionId, userId });
    if (!connection) {
      return NextResponse.json(
        { error: 'MCP connection not found', code: 'mcp_connection_not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      connection,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    return NextResponse.json(
      { error: 'Failed to load MCP connection', code: 'mcp_connection_get_failed' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { connectionId } = await context.params;
    const body = updateMcpConnectionSchema.parse(await request.json());
    const connection = await updateMcpConnection({
      connectionId,
      userId,
      ...body,
    });
    invalidateConnectionCaches({ connectionId, userId });

    const syncJob = await enqueueMcpSyncConnectionJob({
      connectionId,
      userId,
      reason: 'updated',
    });

    return NextResponse.json({
      success: true,
      connection,
      sync: syncJob,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid MCP connection update payload',
          code: 'mcp_connection_update_invalid',
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to update MCP connection', code: 'mcp_connection_update_failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { connectionId } = await context.params;
    await deleteMcpConnection({ connectionId, userId });
    invalidateConnectionCaches({ connectionId, userId });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    return NextResponse.json(
      { error: 'Failed to delete MCP connection', code: 'mcp_connection_delete_failed' },
      { status: 500 },
    );
  }
}
