import { describe, expect, test } from 'vitest';

import { isHardSkipFilterResult } from '@/lib/email/emailFilterService';

describe('isHardSkipFilterResult', () => {
  test('treats blocked subject patterns as hard skips', () => {
    expect(
      isHardSkipFilterResult({
        shouldReply: false,
        reason: 'Blocked subject pattern: unsubscribe from this list',
      }),
    ).toBe(true);
  });

  test('preserves existing hard-skip categories', () => {
    expect(
      isHardSkipFilterResult({
        shouldReply: false,
        reason: 'Blocked by Gmail category: SPAM',
      }),
    ).toBe(true);

    expect(
      isHardSkipFilterResult({
        shouldReply: false,
        reason: 'Blocked sender pattern: spammer@example.com',
      }),
    ).toBe(true);
  });

  test('does not hard skip policy-only filtered results', () => {
    expect(
      isHardSkipFilterResult({
        shouldReply: false,
        reason: 'Unknown sender, requires user approval',
      }),
    ).toBe(false);
  });
});
