import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createMcpConnectionSchema,
} from '@/lib/ai/schemas/mcpSchemas';
import { isUnauthorizedError, requireUserId, unauthorizedResponse } from '@/app/api/user/settings/shared';
import {
  createMcpConnection,
  listMcpConnectionListItemsForUser,
} from '@/lib/services/mcp/connections/service';
import { enqueueMcpSyncConnectionJob } from '@/lib/services/mcp/workers/queue';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

export async function GET() {
  try {
    const userId = await requireUserId();
    const connections = await listMcpConnectionListItemsForUser(userId);

    return NextResponse.json({
      success: true,
      connections,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    return NextResponse.json(
      { error: 'Failed to load MCP connections', code: 'mcp_connections_list_failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createMcpConnectionSchema.parse(await request.json());
    const connection = await createMcpConnection({
      userId,
      displayName: body.displayName,
      serverKey: body.serverKey,
      transport: body.transport,
      secrets: body.secrets,
      trustClass: body.trustClass,
    });
    const syncJob = await enqueueMcpSyncConnectionJob({
      connectionId: connection.id,
      userId,
      reason: 'created',
    });

    return NextResponse.json(
      {
        success: true,
        connection,
        sync: syncJob,
      },
      { status: 201 },
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid MCP connection payload',
          code: 'mcp_connection_invalid',
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to create MCP connection', code: 'mcp_connection_create_failed' },
      { status: 500 },
    );
  }
}
