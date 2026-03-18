import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@/lib/logger';
import {
  McpServiceError,
  type McpConnectionRecord,
  type McpSecretConfig,
} from '@/lib/services/mcp/types';

export interface McpTransportClient {
  listTools(): Promise<Tool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
    ): Promise<{
      content?: unknown[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    }>;
  readResource(
    uri: string,
    options?: { timeoutMs?: number },
  ): Promise<{
    contents: Array<{
      uri: string;
      text?: string;
      blob?: string;
      mimeType?: string;
      _meta?: Record<string, unknown>;
    }>;
  }>;
  close(): Promise<void>;
}

function toStructuredContent(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

type ClientBundle = {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
};

function createSdkClientBundle(
  connection: McpConnectionRecord,
  secrets: McpSecretConfig,
): ClientBundle {
  const client = new Client(
    { name: 'clira-mcp-client', version: '1.0.0' },
    { capabilities: {} },
  );

  if (connection.transport.type === 'stdio') {
    const envSource =
      connection.transport.inheritEnv === false
        ? { ...(secrets.env ?? {}) }
        : { ...process.env, ...(secrets.env ?? {}) };
    const env = Object.fromEntries(
      Object.entries(envSource).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );

    const transport = new StdioClientTransport({
      command: connection.transport.command,
      args: connection.transport.args,
      cwd: connection.transport.cwd ?? undefined,
      env,
      stderr: 'pipe',
    });

    const stderr = transport.stderr;
    if (stderr) {
      stderr.on('data', (chunk) => {
        logger.debug('[MCP] stdio stderr', {
          connectionId: connection.id,
          serverKey: connection.serverKey,
          chunk: String(chunk).slice(0, 500),
        });
      });
    }

    return { client, transport };
  }

  const headers = new Headers(connection.transport.headers ?? {});
  if (secrets.authMode === 'bearer_token') {
    headers.set('Authorization', `Bearer ${secrets.bearerToken}`);
  } else if (secrets.authMode === 'static_header') {
    headers.set(secrets.headerName, secrets.headerValue);
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(connection.transport.endpoint),
    {
      requestInit: {
        headers,
      },
    },
  );

  return {
    client,
    transport,
  };
}

export async function createMcpTransportClient(params: {
  connection: McpConnectionRecord;
  secrets: McpSecretConfig;
  timeoutMs?: number;
}): Promise<McpTransportClient> {
  const bundle = createSdkClientBundle(params.connection, params.secrets);

  try {
    await bundle.client.connect(bundle.transport, {
      timeout: params.timeoutMs,
    });
  } catch (error) {
    await bundle.transport.close().catch(() => {});
    throw new McpServiceError('Failed to connect to MCP server.', {
      retryable: true,
      errorClass: 'connect_failed',
      cause: error,
    });
  }

  return {
    listTools: async () => {
      const tools: Tool[] = [];
      let cursor: string | undefined;

      do {
        const response = await bundle.client.listTools(
          cursor ? { cursor } : undefined,
          { timeout: params.timeoutMs },
        );
        tools.push(...response.tools);
        cursor = response.nextCursor;
      } while (cursor);

      return tools;
    },
    callTool: async (name, args, options) => {
      const result = await bundle.client.callTool(
        { name, arguments: args },
        undefined,
        {
          timeout: options?.timeoutMs ?? params.timeoutMs,
          maxTotalTimeout: options?.timeoutMs ?? params.timeoutMs,
          resetTimeoutOnProgress: true,
        },
      );

      if ('content' in result) {
        return {
          content: Array.isArray(result.content) ? result.content : [],
          structuredContent: toStructuredContent(result.structuredContent),
          isError: typeof result.isError === 'boolean' ? result.isError : undefined,
        };
      }

      return {
        content: [],
        structuredContent:
          result.toolResult && typeof result.toolResult === 'object'
            ? (result.toolResult as Record<string, unknown>)
            : undefined,
        isError: false,
      };
    },
    readResource: async (uri, options) => {
      const result = await bundle.client.readResource(
        { uri },
        {
          timeout: options?.timeoutMs ?? params.timeoutMs,
          maxTotalTimeout: options?.timeoutMs ?? params.timeoutMs,
          resetTimeoutOnProgress: true,
        },
      );

      return {
        contents: Array.isArray(result.contents) ? result.contents : [],
      };
    },
    close: async () => {
      await bundle.client.close().catch(() => {});
      if (bundle.transport instanceof StreamableHTTPClientTransport) {
        await bundle.transport.terminateSession().catch(() => {});
      }
      await bundle.transport.close().catch(() => {});
    },
  };
}
