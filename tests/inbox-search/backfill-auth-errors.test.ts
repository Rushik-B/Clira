import { describe, expect, test } from 'vitest';

import { isInboxSearchRepairAuthOrOwnershipError } from '@/lib/services/inbox-search/backfill';

describe('isInboxSearchRepairAuthOrOwnershipError', () => {
  test('detects ownership mismatch messages from stored email repair', () => {
    expect(
      isInboxSearchRepairAuthOrOwnershipError(
        new Error('Email msg-1 in mailbox mailbox-1 does not belong to user user-1'),
      ),
    ).toBe(true);
  });

  test('detects auth and forbidden signatures on structured errors', () => {
    expect(
      isInboxSearchRepairAuthOrOwnershipError({
        name: 'ForbiddenError',
        message: 'repair blocked',
      }),
    ).toBe(true);
    expect(
      isInboxSearchRepairAuthOrOwnershipError({
        code: 'OWNERSHIP_MISMATCH',
        message: 'another user attempted to access this thread',
      }),
    ).toBe(true);
  });

  test('ignores non-critical repair failures', () => {
    expect(isInboxSearchRepairAuthOrOwnershipError(new Error('temporary snippet repair failure'))).toBe(false);
    expect(isInboxSearchRepairAuthOrOwnershipError(null)).toBe(false);
  });
});
