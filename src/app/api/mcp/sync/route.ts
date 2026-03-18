import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { mcpConnectionIdSchema } from '@/lib/ai/schemas/mcpSchemas';
import { isUnauthorizedError, requireUserId, unauthorizedResponse } from '@/app/api/user/settings/shared';
import { getMcpConnectionForUser } from '@/lib/services/mcp/connections/service';
import { enqueueMcpSyncConnectionJob } from '@/lib/services/mcp/workers/queue';

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = mcpConnectionIdSchema.parse(await request.json());
    const connection = await getMcpConnectionForUser({
      connectionId: body.connectionId,
      userId,
    });
    if (!connection) {
      return NextResponse.json(
        { error: 'MCP connection not found', code: 'mcp_connection_not_found' },
        { status: 404 },
      );
    }

    const syncJob = await enqueueMcpSyncConnectionJob({
      connectionId: body.connectionId,
      userId,
      reason: 'manual',
    });

    return NextResponse.json({
      success: true,
      sync: syncJob,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid sync request', code: 'mcp_sync_invalid', details: error.flatten() },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to enqueue MCP sync', code: 'mcp_sync_failed' },
      { status: 500 },
    );
  }
}
