import { describe, expect, test } from 'vitest';
import {
  listInboxEmailsProviderSchema,
  normalizeListInboxEmailsArgs,
} from '@/lib/ai/agents/executive-agent/list-inbox-emails-contract';

describe('list_inbox_emails contract', () => {
  test('accepts strong filtered requests and applies defaults', () => {
    const normalized = normalizeListInboxEmailsArgs(
      {
        filters: {
          sender: 'Tim Hortons',
          relativeWindow: 'last_7_days',
        },
      },
      {
        defaultTimezone: 'America/Vancouver',
      },
    );

    expect(normalized).toEqual({
      filters: {
        sender: 'Tim Hortons',
        relativeWindow: 'last_7_days',
        includeDeleted: false,
      },
      options: {
        includeBody: false,
        limit: 20,
        sortBy: 'newest',
        timezone: 'America/Vancouver',
      },
    });
  });

  test('rejects broad unbounded requests', () => {
    expect(() =>
      normalizeListInboxEmailsArgs({
        filters: {
          hasAttachment: true,
        },
      }),
    ).toThrow(
      'list_inbox_emails requires threadId or messageId, or at least one identity/content constraint',
    );
  });

  test('enforces includeBody limit cap', () => {
    const normalized = normalizeListInboxEmailsArgs({
      filters: {
        sender: 'Tim Hortons',
        relativeWindow: 'last_7_days',
      },
      options: {
        includeBody: true,
        limit: 50,
      },
    });

    expect(normalized.options.limit).toBe(20);
    expect(normalized.options.includeBody).toBe(true);
  });

  test('enforces date-window validation', () => {
    expect(() =>
      normalizeListInboxEmailsArgs({
        filters: {
          sender: 'Alice',
          startDate: '2026-03-01',
          relativeWindow: 'last_7_days',
        },
      }),
    ).toThrow('Use either relativeWindow or startDate/endDate, not both.');
  });

  test('provider schema exposes the deterministic listing shape', () => {
    expect(listInboxEmailsProviderSchema).toMatchObject({
      type: 'object',
      properties: {
        filters: {
          properties: {
            sender: {
              type: 'string',
            },
            relativeWindow: {
              enum: ['today', 'yesterday', 'last_7_days', 'last_30_days', 'last_90_days', 'all_time'],
            },
          },
        },
        options: {
          properties: {
            limit: {
              maximum: 50,
            },
            includeBody: {
              type: 'boolean',
            },
          },
        },
      },
    });
  });
});
