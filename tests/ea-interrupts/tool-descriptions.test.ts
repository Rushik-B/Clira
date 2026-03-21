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
    const first = getToolProgressDescription('list_reminders', { variationIndex: 0 });
    const second = getToolProgressDescription('list_reminders', { variationIndex: 1 });

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
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
});
