import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { mcpConnectionIdSchema } from '@/lib/ai/schemas/mcpSchemas';
import { isUnauthorizedError, requireUserId, unauthorizedResponse } from '@/app/api/user/settings/shared';
import { getMcpConnectionForUser, listMcpConnectionsForUser } from '@/lib/services/mcp/connections/service';
import { enqueueMcpHealthcheckConnectionJob } from '@/lib/services/mcp/workers/queue';

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const connectionId = request.nextUrl.searchParams.get('connectionId');

    if (connectionId) {
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
        healthy:
          connection.status === 'synced' &&
          (!connection.circuitOpenUntil || connection.circuitOpenUntil.getTime() <= Date.now()),
      });
    }

    const connections = await listMcpConnectionsForUser(userId);
    return NextResponse.json({
      success: true,
      connections: connections.map((connection) => ({
        ...connection,
        healthy:
          connection.status === 'synced' &&
          (!connection.circuitOpenUntil || connection.circuitOpenUntil.getTime() <= Date.now()),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    return NextResponse.json(
      { error: 'Failed to load MCP health', code: 'mcp_health_get_failed' },
      { status: 500 },
    );
  }
}

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

    const healthJob = await enqueueMcpHealthcheckConnectionJob({
      connectionId: body.connectionId,
      userId,
      reason: 'manual',
    });

    return NextResponse.json({
      success: true,
      healthcheck: healthJob,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid healthcheck request', code: 'mcp_health_invalid', details: error.flatten() },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to enqueue MCP healthcheck', code: 'mcp_health_failed' },
      { status: 500 },
    );
  }
}
