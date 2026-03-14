import { z } from 'zod';

const nonEmptyRecordSchema = z.record(z.string().min(1), z.string());

export const mcpStdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1).max(500),
  args: z.array(z.string()).max(50).default([]),
  cwd: z.string().min(1).max(1_000).optional(),
  inheritEnv: z.boolean().default(true),
});

export const mcpStreamableHttpTransportSchema = z.object({
  type: z.literal('streamable_http'),
  endpoint: z.string().url(),
  headers: nonEmptyRecordSchema.optional(),
});

export const mcpTransportSchema = z.discriminatedUnion('type', [
  mcpStdioTransportSchema,
  mcpStreamableHttpTransportSchema,
]);

export const mcpSecretSchema = z.discriminatedUnion('authMode', [
  z.object({
    authMode: z.literal('none'),
    env: nonEmptyRecordSchema.optional(),
  }),
  z.object({
    authMode: z.literal('bearer_token'),
    bearerToken: z.string().min(1).max(8_000),
    env: nonEmptyRecordSchema.optional(),
  }),
  z.object({
    authMode: z.literal('static_header'),
    headerName: z.string().min(1).max(200),
    headerValue: z.string().min(1).max(8_000),
    env: nonEmptyRecordSchema.optional(),
  }),
]);

export const createMcpConnectionSchema = z.object({
  displayName: z.string().min(1).max(120),
  serverKey: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(60).optional(),
  transport: mcpTransportSchema,
  secrets: mcpSecretSchema,
  trustClass: z.enum(['first_party', 'user_configured', 'third_party']).optional(),
});

export const updateMcpConnectionSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    serverKey: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(60).optional(),
    transport: mcpTransportSchema.optional(),
    secrets: mcpSecretSchema.optional(),
    trustClass: z.enum(['first_party', 'user_configured', 'third_party']).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const mcpConnectionIdSchema = z.object({
  connectionId: z.string().min(1),
});
