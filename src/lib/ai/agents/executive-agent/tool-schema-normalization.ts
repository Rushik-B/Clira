import { jsonSchema } from 'ai';

type ProviderToolDefinition = {
  inputSchema?: unknown;
  providerInputSchema?: unknown;
  [key: string]: unknown;
};

const STRIPPED_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  'default',
  'examples',
  'title',
  'format',
  'propertyNames',
  'patternProperties',
  'unevaluatedProperties',
  'if',
  'then',
  'else',
  'not',
]);

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeAllOfIntoObject(allOf: unknown[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    type: 'object',
    properties: {},
    required: [],
  };

  for (const entry of allOf) {
    if (!isJsonRecord(entry)) {
      continue;
    }

    if (entry.type === 'object' && isJsonRecord(entry.properties)) {
      merged.properties = {
        ...(merged.properties as Record<string, unknown>),
        ...entry.properties,
      };
    }

    if (Array.isArray(entry.required)) {
      merged.required = Array.from(
        new Set([...(merged.required as unknown[]), ...entry.required]),
      );
    }
  }

  return merged;
}

export function normalizeExecutiveAgentToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeExecutiveAgentToolSchema(item));
  }

  if (!isJsonRecord(schema)) {
    return schema;
  }

  const normalizedEntries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(schema)) {
    if (STRIPPED_SCHEMA_KEYS.has(key)) {
      continue;
    }

    if ((key === 'oneOf' || key === 'anyOf') && Array.isArray(value)) {
      continue;
    }

    if (key === 'allOf' && Array.isArray(value)) {
      const merged = mergeAllOfIntoObject(value);
      const normalizedMerged = normalizeExecutiveAgentToolSchema(merged);
      if (isJsonRecord(normalizedMerged)) {
        for (const [mergedKey, mergedValue] of Object.entries(normalizedMerged)) {
          normalizedEntries.push([mergedKey, mergedValue]);
        }
      }
      continue;
    }

    normalizedEntries.push([key, normalizeExecutiveAgentToolSchema(value)]);
  }

  return Object.fromEntries(normalizedEntries);
}

export function normalizeExecutiveAgentToolsForModel<T extends Record<string, ProviderToolDefinition>>(
  tools: T,
): T {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, tool]) => {
      if (!tool.providerInputSchema) {
        return [toolName, tool];
      }

      return [
        toolName,
        {
          ...tool,
          inputSchema: jsonSchema(
            normalizeExecutiveAgentToolSchema(tool.providerInputSchema) as Record<string, unknown>,
          ),
        },
      ];
    }),
  ) as T;
}
