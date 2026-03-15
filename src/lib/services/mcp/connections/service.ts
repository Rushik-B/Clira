import {
  McpAuthMode as PrismaMcpAuthMode,
  McpConnectionStatus as PrismaMcpConnectionStatus,
  McpTransportType as PrismaMcpTransportType,
  McpTrustClass as PrismaMcpTrustClass,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptSecret, encryptSecret } from '@/lib/security/tokenCrypto';
import { slugifyMcpSegment } from '@/lib/services/mcp/manifests/normalization';
import { toPrismaNullableJsonValue } from '@/lib/services/mcp/utils/prismaJson';
import {
  McpServiceError,
  type McpAuthMode,
  type McpConnectionRecord,
  type McpConnectionStatus,
  type McpSecretConfig,
  type McpTransportConfig,
  type McpTrustClass,
} from '@/lib/services/mcp/types';

export type CreateMcpConnectionInput = {
  userId: string;
  displayName: string;
  serverKey?: string;
  transport: McpTransportConfig;
  secrets: McpSecretConfig;
  trustClass?: McpTrustClass;
};

export type UpdateMcpConnectionInput = {
  connectionId: string;
  userId: string;
  displayName?: string;
  serverKey?: string;
  transport?: McpTransportConfig;
  secrets?: McpSecretConfig;
  trustClass?: McpTrustClass;
  disabled?: boolean;
};

export type McpConnectionListItem = McpConnectionRecord & {
  toolCount: number;
  healthy: boolean;
};

type McpConnectionRow = Prisma.McpConnectionGetPayload<{
  select: {
    id: true;
    userId: true;
    serverKey: true;
    displayName: true;
    packDescription: true;
    transportType: true;
    transportConfig: true;
    authMode: true;
    encryptedSecrets: true;
    status: true;
    trustClass: true;
    degradedReason: true;
    syncDiagnostics: true;
    healthDiagnostics: true;
    lastSyncedAt: true;
    lastHealthCheckedAt: true;
    consecutiveFailures: true;
    circuitOpenedAt: true;
    circuitOpenUntil: true;
    disabledAt: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

const CONNECTION_SELECT = {
  id: true,
  userId: true,
  serverKey: true,
  displayName: true,
  packDescription: true,
  transportType: true,
  transportConfig: true,
  authMode: true,
  encryptedSecrets: true,
  status: true,
  trustClass: true,
  degradedReason: true,
  syncDiagnostics: true,
  healthDiagnostics: true,
  lastSyncedAt: true,
  lastHealthCheckedAt: true,
  consecutiveFailures: true,
  circuitOpenedAt: true,
  circuitOpenUntil: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toPrismaTransportType(type: McpTransportConfig['type']): PrismaMcpTransportType {
  return type === 'stdio' ? 'STDIO' : 'STREAMABLE_HTTP';
}

function fromPrismaTransportType(type: PrismaMcpTransportType): McpTransportConfig['type'] {
  return type === 'STDIO' ? 'stdio' : 'streamable_http';
}

function toPrismaAuthMode(mode: McpAuthMode): PrismaMcpAuthMode {
  switch (mode) {
    case 'bearer_token':
      return 'BEARER_TOKEN';
    case 'static_header':
      return 'STATIC_HEADER';
    default:
      return 'NONE';
  }
}

function fromPrismaAuthMode(mode: PrismaMcpAuthMode): McpAuthMode {
  switch (mode) {
    case 'BEARER_TOKEN':
      return 'bearer_token';
    case 'STATIC_HEADER':
      return 'static_header';
    default:
      return 'none';
  }
}

function toPrismaTrustClass(mode: McpTrustClass): PrismaMcpTrustClass {
  switch (mode) {
    case 'first_party':
      return 'FIRST_PARTY';
    case 'third_party':
      return 'THIRD_PARTY';
    default:
      return 'USER_CONFIGURED';
  }
}

function fromPrismaTrustClass(mode: PrismaMcpTrustClass): McpTrustClass {
  switch (mode) {
    case 'FIRST_PARTY':
      return 'first_party';
    case 'THIRD_PARTY':
      return 'third_party';
    default:
      return 'user_configured';
  }
}

function fromPrismaConnectionStatus(status: PrismaMcpConnectionStatus): McpConnectionStatus {
  switch (status) {
    case 'SYNCED':
      return 'synced';
    case 'DEGRADED':
      return 'degraded';
    case 'DISABLED':
      return 'disabled';
    default:
      return 'pending';
  }
}

function parseTransportConfig(
  transportType: PrismaMcpTransportType,
  value: Prisma.JsonValue,
): McpTransportConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpServiceError('Stored MCP transport config is malformed.', {
      errorClass: 'invalid_config',
    });
  }

  if (transportType === 'STDIO') {
    return {
      type: 'stdio',
      command:
        typeof value.command === 'string' ? value.command : '',
      args: Array.isArray(value.args)
        ? value.args.filter((entry): entry is string => typeof entry === 'string')
        : [],
      cwd: typeof value.cwd === 'string' ? value.cwd : null,
      inheritEnv: value.inheritEnv !== false,
    };
  }

  return {
    type: 'streamable_http',
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : '',
    headers:
      value.headers && typeof value.headers === 'object' && !Array.isArray(value.headers)
        ? Object.fromEntries(
            Object.entries(value.headers as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
  };
}

function serializeTransportConfig(config: McpTransportConfig): Prisma.InputJsonValue {
  if (config.type === 'stdio') {
    return {
      command: config.command,
      args: config.args,
      cwd: config.cwd ?? null,
      inheritEnv: config.inheritEnv !== false,
    } satisfies Prisma.InputJsonObject;
  }

  return {
    endpoint: config.endpoint,
    headers: config.headers ?? {},
  } satisfies Prisma.InputJsonObject;
}

async function serializeSecrets(secrets: McpSecretConfig): Promise<string | null> {
  return encryptSecret({
    plaintext: JSON.stringify(secrets),
  });
}

async function deserializeSecrets(ciphertext?: string | null): Promise<McpSecretConfig> {
  const plaintext = await decryptSecret({ ciphertext });
  if (!plaintext) {
    return { authMode: 'none' };
  }

  const parsed = JSON.parse(plaintext) as McpSecretConfig;
  return parsed;
}

function toConnectionRecord(row: McpConnectionRow): McpConnectionRecord {
  return {
    id: row.id,
    userId: row.userId,
    serverKey: row.serverKey,
    displayName: row.displayName,
    packDescription: row.packDescription,
    transport: parseTransportConfig(row.transportType, row.transportConfig),
    authMode: fromPrismaAuthMode(row.authMode),
    status: fromPrismaConnectionStatus(row.status),
    trustClass: fromPrismaTrustClass(row.trustClass),
    degradedReason: row.degradedReason,
    syncDiagnostics: row.syncDiagnostics,
    healthDiagnostics: row.healthDiagnostics,
    lastSyncedAt: row.lastSyncedAt,
    lastHealthCheckedAt: row.lastHealthCheckedAt,
    consecutiveFailures: row.consecutiveFailures,
    circuitOpenedAt: row.circuitOpenedAt,
    circuitOpenUntil: row.circuitOpenUntil,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveUniqueServerKey(
  userId: string,
  requestedKey: string | undefined,
  excludeConnectionId?: string,
): Promise<string> {
  const base = slugifyMcpSegment(requestedKey ?? '') || slugifyMcpSegment(`mcp-${Date.now()}`);

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}_${suffix + 1}`;
    const existing = await prisma.mcpConnection.findFirst({
      where: {
        userId,
        serverKey: candidate,
        ...(excludeConnectionId ? { NOT: { id: excludeConnectionId } } : {}),
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new McpServiceError('Unable to allocate a unique MCP server key.', {
    errorClass: 'server_key_conflict',
  });
}

export async function listMcpConnectionsForUser(userId: string): Promise<McpConnectionRecord[]> {
  const rows = await prisma.mcpConnection.findMany({
    where: { userId },
    select: CONNECTION_SELECT,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map(toConnectionRecord);
}

export async function listMcpConnectionListItemsForUser(
  userId: string,
): Promise<McpConnectionListItem[]> {
  const rows = await prisma.mcpConnection.findMany({
    where: { userId },
    select: {
      ...CONNECTION_SELECT,
      _count: {
        select: {
          toolManifests: true,
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map((row) => {
    const connection = toConnectionRecord(row);

    return {
      ...connection,
      toolCount: row._count.toolManifests,
      healthy:
        connection.status === 'synced' &&
        (!connection.circuitOpenUntil || connection.circuitOpenUntil.getTime() <= Date.now()),
    };
  });
}

export async function getMcpConnectionForUser(params: {
  connectionId: string;
  userId: string;
}): Promise<McpConnectionRecord | null> {
  const row = await prisma.mcpConnection.findFirst({
    where: {
      id: params.connectionId,
      userId: params.userId,
    },
    select: CONNECTION_SELECT,
  });

  return row ? toConnectionRecord(row) : null;
}

export async function getMcpConnectionWithSecrets(params: {
  connectionId: string;
  userId?: string;
}): Promise<{ connection: McpConnectionRecord; secrets: McpSecretConfig } | null> {
  const row = await prisma.mcpConnection.findFirst({
    where: {
      id: params.connectionId,
      ...(params.userId ? { userId: params.userId } : {}),
    },
    select: CONNECTION_SELECT,
  });

  if (!row) {
    return null;
  }

  return {
    connection: toConnectionRecord(row),
    secrets: await deserializeSecrets(row.encryptedSecrets),
  };
}

export async function createMcpConnection(input: CreateMcpConnectionInput): Promise<McpConnectionRecord> {
  const serverKey = await resolveUniqueServerKey(input.userId, input.serverKey ?? input.displayName);
  const encryptedSecrets = await serializeSecrets(input.secrets);

  const row = await prisma.mcpConnection.create({
    data: {
      userId: input.userId,
      serverKey,
      displayName: input.displayName.trim(),
      packDescription: null,
      transportType: toPrismaTransportType(input.transport.type),
      transportConfig: serializeTransportConfig(input.transport),
      authMode: toPrismaAuthMode(input.secrets.authMode),
      encryptedSecrets,
      trustClass: toPrismaTrustClass(input.trustClass ?? 'user_configured'),
      status: 'PENDING',
    },
    select: CONNECTION_SELECT,
  });

  return toConnectionRecord(row);
}

export async function updateMcpConnection(input: UpdateMcpConnectionInput): Promise<McpConnectionRecord> {
  const existing = await getMcpConnectionWithSecrets({
    connectionId: input.connectionId,
    userId: input.userId,
  });

  if (!existing) {
    throw new McpServiceError('MCP connection not found.', {
      errorClass: 'not_found',
    });
  }

  const nextTransport = input.transport ?? existing.connection.transport;
  const nextSecrets = input.secrets ?? existing.secrets;
  const nextServerKey = input.serverKey
    ? await resolveUniqueServerKey(input.userId, input.serverKey, input.connectionId)
    : existing.connection.serverKey;

  const row = await prisma.mcpConnection.update({
    where: { id: input.connectionId },
    data: {
      displayName: input.displayName?.trim() ?? existing.connection.displayName,
      serverKey: nextServerKey,
      packDescription: null,
      transportType: toPrismaTransportType(nextTransport.type),
      transportConfig: serializeTransportConfig(nextTransport),
      authMode: toPrismaAuthMode(nextSecrets.authMode),
      encryptedSecrets: await serializeSecrets(nextSecrets),
      trustClass: toPrismaTrustClass(input.trustClass ?? existing.connection.trustClass),
      disabledAt:
        typeof input.disabled === 'boolean'
          ? input.disabled
            ? new Date()
            : null
          : existing.connection.disabledAt,
      status:
        typeof input.disabled === 'boolean'
          ? input.disabled
            ? 'DISABLED'
            : 'PENDING'
          : 'PENDING',
      degradedReason: null,
      syncDiagnostics: Prisma.JsonNull,
      healthDiagnostics: Prisma.JsonNull,
      circuitOpenedAt: null,
      circuitOpenUntil: null,
      consecutiveFailures: 0,
    },
    select: CONNECTION_SELECT,
  });

  return toConnectionRecord(row);
}

export async function deleteMcpConnection(params: {
  connectionId: string;
  userId: string;
}): Promise<void> {
  await prisma.mcpConnection.deleteMany({
    where: {
      id: params.connectionId,
      userId: params.userId,
    },
  });
}

export async function markMcpConnectionSyncSuccess(params: {
  connectionId: string;
  syncedAt: Date;
  diagnostics?: Prisma.InputJsonValue;
  packDescription?: string | null;
}): Promise<void> {
  await prisma.mcpConnection.update({
    where: { id: params.connectionId },
    data: {
      status: 'SYNCED',
      degradedReason: null,
      packDescription: params.packDescription ?? null,
      syncDiagnostics: toPrismaNullableJsonValue(params.diagnostics),
      lastSyncedAt: params.syncedAt,
      circuitOpenedAt: null,
      circuitOpenUntil: null,
      consecutiveFailures: 0,
    },
  });
}

export async function markMcpConnectionHealthSuccess(params: {
  connectionId: string;
  checkedAt: Date;
  diagnostics?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.mcpConnection.update({
    where: { id: params.connectionId },
    data: {
      status: 'SYNCED',
      degradedReason: null,
      healthDiagnostics: toPrismaNullableJsonValue(params.diagnostics),
      lastHealthCheckedAt: params.checkedAt,
      circuitOpenedAt: null,
      circuitOpenUntil: null,
      consecutiveFailures: 0,
    },
  });
}

export async function markMcpConnectionDegraded(params: {
  connectionId: string;
  reason: string;
  syncDiagnostics?: Prisma.InputJsonValue;
  healthDiagnostics?: Prisma.InputJsonValue;
  openedCircuitUntil?: Date | null;
}): Promise<void> {
  await prisma.mcpConnection.update({
    where: { id: params.connectionId },
    data: {
      status: 'DEGRADED',
      degradedReason: params.reason,
      syncDiagnostics: toPrismaNullableJsonValue(params.syncDiagnostics),
      healthDiagnostics: toPrismaNullableJsonValue(params.healthDiagnostics),
      consecutiveFailures: {
        increment: 1,
      },
      circuitOpenedAt: params.openedCircuitUntil ? new Date() : undefined,
      circuitOpenUntil: params.openedCircuitUntil ?? undefined,
    },
  });
}
