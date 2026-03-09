import { describe, expect, test } from 'vitest';

import {
  getPrismaErrorCode,
  isPrismaAuthenticationFailure,
} from '@/lib/prismaErrors';

describe('prisma error classification', () => {
  test('detects Prisma authentication failures by code', () => {
    expect(
      isPrismaAuthenticationFailure({
        code: 'P1000',
        message: 'Authentication failed against the database server',
      }),
    ).toBe(true);
  });

  test('does not classify other Prisma errors as authentication failures', () => {
    expect(isPrismaAuthenticationFailure({ code: 'P1001' })).toBe(false);
    expect(isPrismaAuthenticationFailure(new Error('boom'))).toBe(false);
    expect(isPrismaAuthenticationFailure(null)).toBe(false);
  });

  test('extracts Prisma error codes when present', () => {
    expect(getPrismaErrorCode({ code: 'P1000' })).toBe('P1000');
    expect(getPrismaErrorCode({ code: 1000 })).toBeNull();
    expect(getPrismaErrorCode(undefined)).toBeNull();
  });
});
