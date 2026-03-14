import { describe, expect, test } from 'vitest';
import {
  listInboxEmailsProviderSchema,
} from '@/lib/ai/agents/executive-agent/list-inbox-emails-contract';
import {
  readEmailPdfAttachmentProviderSchema,
} from '@/lib/ai/agents/executive-agent/read-email-pdf-attachment-contract';
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
      list_inbox_emails: {
        description: 'List inbox emails',
        providerInputSchema: listInboxEmailsProviderSchema,
      },
      read_email_pdf_attachment: {
        description: 'Read email PDF attachment',
        providerInputSchema: readEmailPdfAttachmentProviderSchema,
      },
    });
    const normalizedTool = tools.search_inbox_context as unknown as {
      inputSchema: {
        jsonSchema: Record<string, unknown>;
      };
    };
    const normalizedListTool = tools.list_inbox_emails as unknown as {
      inputSchema: {
        jsonSchema: Record<string, unknown>;
      };
    };
    const normalizedPdfTool = tools.read_email_pdf_attachment as unknown as {
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
    expect(normalizedListTool.inputSchema.jsonSchema).toMatchObject({
      type: 'object',
      properties: {
        options: {
          properties: {
            includeBody: {
              type: 'boolean',
            },
          },
        },
      },
    });
    expect(normalizedPdfTool.inputSchema.jsonSchema).toMatchObject({
      type: 'object',
      required: ['messageId'],
      properties: {
        attachmentId: {
          type: 'string',
        },
        messageId: {
          type: 'string',
        },
      },
    });
  });
});
