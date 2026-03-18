import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { normalizeExecutiveAgentToolSchema } from '@/lib/ai/agents/executive-agent/tool-schema-normalization';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function slugifyMcpSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'tool';
}

export function normalizeMcpInputSchema(schema: Tool['inputSchema'] | undefined): Record<string, unknown> {
  const fallback = { type: 'object', properties: {}, required: [] };
  if (!schema || !isRecord(schema)) {
    return fallback;
  }

  const normalized = normalizeExecutiveAgentToolSchema(schema);
  if (!isRecord(normalized)) {
    return fallback;
  }

  return {
    type: normalized.type === 'object' ? 'object' : 'object',
    properties: isRecord(normalized.properties) ? normalized.properties : {},
    required: Array.isArray(normalized.required)
      ? normalized.required.filter((entry): entry is string => typeof entry === 'string')
      : [],
    ...(isRecord(normalized.additionalProperties)
      ? { additionalProperties: normalized.additionalProperties }
      : {}),
  };
}

export function normalizeMcpOutputSchema(schema: Tool['outputSchema'] | undefined): Record<string, unknown> | null {
  if (!schema || !isRecord(schema)) {
    return null;
  }

  const normalized = normalizeExecutiveAgentToolSchema(schema);
  return isRecord(normalized) ? normalized : null;
}
