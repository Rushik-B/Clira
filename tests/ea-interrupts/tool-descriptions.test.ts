import { describe, expect, test } from 'vitest';
import { getToolProgressDescription } from '@/lib/ai/agents/executive-agent/toolDescriptions';

describe('tool progress descriptions', () => {
  test('keeps native tool descriptions lowercase and human', () => {
    const description = getToolProgressDescription('search_calendar', { variationIndex: 0 });

    expect(description).toBeTruthy();
    expect(description?.[0]).toBe(description?.[0]?.toLowerCase());
    expect(description).not.toContain('...');
    expect(description).toMatch(/calendar|schedule|what u have going on/);
  });

  test('varies repeated updates within the same run', () => {
    const first = getToolProgressDescription('list_email_alerts', { variationIndex: 0 });
    const second = getToolProgressDescription('list_email_alerts', { variationIndex: 1 });

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  test('varies the first auto-update across requests for the same tool', () => {
    const variants = new Set(
      Array.from({ length: 8 }, (_, index) =>
        getToolProgressDescription('search_inbox_context', {
          variationIndex: 0,
          requestSeed: `req-${index}`,
        }),
      ),
    );

    expect(variants.size).toBeGreaterThan(1);
  });

  test('follow-up updates acknowledge the ongoing wait', () => {
    const description = getToolProgressDescription('search_inbox_context', {
      variationIndex: 1,
      sentCount: 1,
      elapsedMs: 24_000,
      requestSeed: 'req-follow-up',
    });

    expect(description).toBeTruthy();
    expect(description).toMatch(/still/);
    expect(description).toContain('your inbox');
  });

  test('extended waits use longer-running language instead of another opener', () => {
    const description = getToolProgressDescription('search_calendar', {
      variationIndex: 2,
      sentCount: 2,
      elapsedMs: 52_000,
      requestSeed: 'req-extended',
    });

    expect(description).toBeTruthy();
    expect(description).toMatch(/still|taking a bit|taking a sec/);
    expect(description).not.toMatch(/^one sec|^pulling up|^looking at/);
  });

  test('humanizes sluggy MCP read titles without leaking tool names', () => {
    const description = getToolProgressDescription(
      'mcp__canvas__get_my_upcoming_assignments',
      {
        mcpTools: new Map([
          [
            'mcp__canvas__get_my_upcoming_assignments',
            { displayTitle: 'get_my_upcoming_assignments', actionClass: 'read' },
          ],
        ]),
        variationIndex: 0,
      },
    );

    expect(description).toBeTruthy();
    expect(description).not.toContain('Using');
    expect(description).not.toContain('get_my_upcoming_assignments');
    expect(description?.[0]).toBe(description?.[0]?.toLowerCase());
    expect(description?.toLowerCase()).toContain('your upcoming assignments');
  });

  test('humanizes MCP titles with a natural fallback phrase', () => {
    const description = getToolProgressDescription(
      'mcp__notion__weekly_status',
      {
        mcpTools: new Map([
          ['mcp__notion__weekly_status', { displayTitle: 'weekly_status', actionClass: 'read' }],
        ]),
        variationIndex: 1,
      },
    );

    expect(description).toBeTruthy();
    expect(description).not.toContain('_');
    expect(description?.[0]).toBe(description?.[0]?.toLowerCase());
    expect(description).toMatch(/looking at|pulling up|checking|digging into|one sec/);
  });

  test('suppresses progress text for internal wrapper tools', () => {
    expect(getToolProgressDescription('send_progress_update')).toBeNull();
    expect(getToolProgressDescription('request_mcp_server_tools')).toBeNull();
  });

  test('suppresses auto progress text for reminder tools', () => {
    expect(getToolProgressDescription('add_reminder')).toBeNull();
    expect(getToolProgressDescription('list_reminders')).toBeNull();
    expect(getToolProgressDescription('snooze_reminder')).toBeNull();
    expect(getToolProgressDescription('dismiss_reminder')).toBeNull();
    expect(getToolProgressDescription('cancel_reminder')).toBeNull();
  });
});
