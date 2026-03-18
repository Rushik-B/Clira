import { describe, expect, test } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { classifyMcpActionClass } from '@/lib/services/mcp/manifests/classification';

function buildTool(overrides: Partial<Tool>): Tool {
  return {
    name: 'tool_name',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    ...overrides,
  } as Tool;
}

describe('MCP action classification', () => {
  test('classifies list_course_files as read even when the description contains write-adjacent words', () => {
    const tool = buildTool({
      name: 'list_course_files',
      description:
        'List course files with add permissions, set membership, and last updated timestamps.',
    });

    expect(classifyMcpActionClass(tool)).toBe('read');
  });

  test('keeps create_assignment classified as write', () => {
    const tool = buildTool({
      name: 'create_assignment',
      description: 'Create a new assignment and list its enrolled students after creation.',
    });

    expect(classifyMcpActionClass(tool)).toBe('write');
  });

  test('honors readOnlyHint before keyword heuristics', () => {
    const tool = buildTool({
      name: 'create_assignment',
      description: 'Create a new assignment.',
      annotations: {
        readOnlyHint: true,
      },
    });

    expect(classifyMcpActionClass(tool)).toBe('read');
  });
});
