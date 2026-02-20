export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseBoundedInt(
  paramName: string,
  value: string | null | undefined,
  options: { defaultValue?: number; min?: number; max?: number } = {},
): ParseResult<number> {
  if (value == null || value.length === 0) {
    if (typeof options.defaultValue === 'number') {
      return { ok: true, value: options.defaultValue };
    }
    return { ok: false, error: `Missing required parameter: ${paramName}` };
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `Invalid integer for ${paramName}: "${value}"` };
  }

  if (typeof options.min === 'number' && parsed < options.min) {
    return { ok: false, error: `Parameter ${paramName} must be >= ${options.min}` };
  }

  if (typeof options.max === 'number' && parsed > options.max) {
    return { ok: false, error: `Parameter ${paramName} must be <= ${options.max}` };
  }

  return { ok: true, value: parsed };
}

export function parseBoundedFloat(
  paramName: string,
  value: string | null | undefined,
  options: { defaultValue?: number; min?: number; max?: number } = {},
): ParseResult<number> {
  if (value == null || value.length === 0) {
    if (typeof options.defaultValue === 'number') {
      return { ok: true, value: options.defaultValue };
    }
    return { ok: false, error: `Missing required parameter: ${paramName}` };
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `Invalid number for ${paramName}: "${value}"` };
  }

  if (typeof options.min === 'number' && parsed < options.min) {
    return { ok: false, error: `Parameter ${paramName} must be >= ${options.min}` };
  }

  if (typeof options.max === 'number' && parsed > options.max) {
    return { ok: false, error: `Parameter ${paramName} must be <= ${options.max}` };
  }

  return { ok: true, value: parsed };
}

