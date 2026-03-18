import { Prisma } from '@prisma/client';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toPrismaJsonValue(entry)) as Prisma.InputJsonArray;
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    result[key] = toPrismaJsonValue(entry);
  }
  return result as Prisma.InputJsonObject;
}

export function toPrismaJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return toPrismaJsonValue(value) as Prisma.InputJsonObject;
}

export function toPrismaNullableJsonValue(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.JsonNull;
  }

  return toPrismaJsonValue(value);
}
