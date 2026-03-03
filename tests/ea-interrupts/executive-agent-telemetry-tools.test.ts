import { describe, expect, test } from 'vitest';
import {
  collectExecutedToolNames,
  collectOutOfPackToolNames,
} from '@/lib/ai/agents/executive-agent/helpers';

describe('Executive agent telemetry tool-name collection', () => {
  test('prefers budget-tracked executed tools when available', () => {
    const toolCalls = [
      { toolName: 'search_memory' },
      { toolName: 'search_calendar' },
    ];
    const toolResults = [
      { toolName: 'search_inbox_context', result: { ok: true } },
    ];
    const steps = [
      {
        toolCalls: [{ name: 'send_progress_update' }],
        toolResults: [{ tool: 'search_calendar', result: { ok: true } }],
      },
    ];

    const names = collectExecutedToolNames({
      toolCalls,
      toolResults,
      steps,
      toolBudget: {
        perTool: {
          search_memory: 1,
          send_progress_update: 1,
        },
      },
      availableToolNames: [
        'append_to_supermemory',
        'search_memory',
        'send_progress_update',
      ],
    });

    expect(Array.from(names).sort()).toEqual([
      'search_memory',
      'send_progress_update',
    ]);
  });

  test('falls back to allowlist-filtered observed tools without budget report', () => {
    const names = collectExecutedToolNames({
      toolCalls: [
        { toolName: 'search_memory' },
        { function: { name: 'search_calendar' } },
      ],
      toolResults: [{ toolName: 'search_inbox_context', result: { ok: true } }],
      steps: [{ toolCalls: [{ name: 'send_progress_update' }] }],
      availableToolNames: [
        'append_to_supermemory',
        'search_memory',
        'send_progress_update',
      ],
    });

    expect(Array.from(names).sort()).toEqual([
      'search_memory',
      'send_progress_update',
    ]);
  });

  test('reports out-of-pack tool names from observed trace', () => {
    const outOfPack = collectOutOfPackToolNames({
      toolCalls: [
        { toolName: 'search_memory' },
        { toolName: 'search_calendar' },
      ],
      toolResults: [{ toolName: 'search_inbox_context', result: { ok: true } }],
      steps: [{ toolCalls: [{ functionName: 'send_progress_update' }] }],
      availableToolNames: [
        'append_to_supermemory',
        'search_memory',
        'send_progress_update',
      ],
    });

    expect(Array.from(outOfPack).sort()).toEqual([
      'search_calendar',
      'search_inbox_context',
    ]);
  });
});
