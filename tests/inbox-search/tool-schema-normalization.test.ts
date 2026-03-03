import { describe, expect, test } from 'vitest';
import {
  searchInboxContextProviderSchema,
} from '@/lib/ai/agents/executive-agent/search-inbox-context-contract';
import {
  normalizeExecutiveAgentToolSchema,
  normalizeExecutiveAgentToolsForModel,
} from '@/lib/ai/agents/executive-agent/tool-schema-normalization';

describe('normalizeExecutiveAgentToolSchema', () => {
  test('strips provider-unsafe keywords and combinators', () => {
    const normalized = normalizeExecutiveAgentToolSchema({
      type: 'object',
      title: 'Example',
      properties: {
        action: {
          type: 'string',
          enum: ['find'],
          default: 'find',
        },
      },
      anyOf: [{ type: 'object' }],
      required: ['action'],
    }) as Record<string, unknown>;

    expect(normalized.title).toBeUndefined();
    expect(normalized.anyOf).toBeUndefined();
    expect((normalized.properties as Record<string, any>).action.default).toBeUndefined();
  });

  test('wraps provider schemas with AI SDK jsonSchema()', () => {
    const tools = normalizeExecutiveAgentToolsForModel({
      search_inbox_context: {
        description: 'Search inbox',
        providerInputSchema: searchInboxContextProviderSchema,
      },
    });
    const normalizedTool = tools.search_inbox_context as unknown as {
      inputSchema: {
        jsonSchema: Record<string, unknown>;
      };
    };

    expect(normalizedTool.inputSchema.jsonSchema).toMatchObject({
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          enum: ['find', 'summarize_range', 'count', 'aggregate'],
        },
      },
    });
    expect(normalizedTool.inputSchema.jsonSchema.anyOf).toBeUndefined();
  });
});
