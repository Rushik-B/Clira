type ValidationIssue = {
  path: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expectedTypeMatches(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateNode(params: {
  value: unknown;
  schema: unknown;
  path: string;
  issues: ValidationIssue[];
}) {
  const { value, schema, path, issues } = params;
  if (!isRecord(schema)) {
    return;
  }

  const expectedType = typeof schema.type === 'string' ? schema.type : null;
  if (expectedType && !expectedTypeMatches(value, expectedType)) {
    issues.push({
      path,
      message: `Expected ${expectedType}.`,
    });
    return;
  }

  if (expectedType === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];

    for (const key of required) {
      if (!(key in value)) {
        issues.push({
          path: path === '$' ? key : `${path}.${key}`,
          message: 'Missing required value.',
        });
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in value)) {
        continue;
      }

      validateNode({
        value: value[key],
        schema: childSchema,
        path: path === '$' ? key : `${path}.${key}`,
        issues,
      });
    }
  }

  if (expectedType === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => {
      validateNode({
        value: entry,
        schema: schema.items,
        path: `${path}[${index}]`,
        issues,
      });
    });
  }
}

export function validateMcpArgsAgainstSchema(params: {
  args: Record<string, unknown>;
  schema: Record<string, unknown>;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateNode({
    value: params.args,
    schema: params.schema,
    path: '$',
    issues,
  });
  return issues;
}
