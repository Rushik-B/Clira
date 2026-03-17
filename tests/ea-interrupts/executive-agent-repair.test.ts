import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  callTextWithToolsMock,
  callTextWithMessagesMock,
  buildExecutiveAgentToolsMock,
  resolveMcpToolExposureMock,
  listSelectableMcpServerPacksMock,
} = vi.hoisted(() => ({
  callTextWithToolsMock: vi.fn(),
  callTextWithMessagesMock: vi.fn(),
  buildExecutiveAgentToolsMock: vi.fn(),
  resolveMcpToolExposureMock: vi.fn(),
  listSelectableMcpServerPacksMock: vi.fn(),
}));

vi.mock('@/lib/ai/callLlm', () => ({
  callTextWithTools: callTextWithToolsMock,
  callTextWithMessages: callTextWithMessagesMock,
  createDeadlineController: () => ({
    signal: undefined,
    cleanup: () => {},
    timeLeftMs: () => 30_000,
  }),
}));

vi.mock('@/lib/ai/models', () => ({
  models: {
    execAgent: () => 'mock-model',
  },
}));

vi.mock('@/lib/ai/runtime/steeringRuntime', () => ({
  isNativeSteeringEnabled: () => false,
  requireNativeSteeringRuntime: () => {},
  resolveNativeSteeringRuntime: () => null,
}));

vi.mock('@/lib/services/messaging-orchestration/steeringConfig', () => ({
  isCooperativeSteeringEnabled: () => false,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    pendingCalendarChange: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/lib/ai/agents/executive-agent/prompt', () => ({
  EXECUTIVE_AGENT_PROMPT_VERSION: 'test-prompt',
  resolveUserCalendarTimezone: vi.fn().mockResolvedValue('America/Vancouver'),
  buildExecutiveAgentPrompt: vi.fn(async (input: { userRequest: string }) => ({
    systemPrompt: 'system',
    messages: [{ role: 'user', content: input.userRequest }],
    userTimezone: 'America/Vancouver',
    currentTimeUtc: '2026-03-17T00:00:00.000Z',
    currentTimeUserTz: 'Tuesday, March 17, 2026 at 05:00 PM',
    dayOfWeek: 'Tuesday',
    currentDateUserTzDateOnly: '2026-03-17',
  })),
}));

vi.mock('@/lib/ai/agents/executive-agent/tools', () => ({
  buildExecutiveAgentTools: buildExecutiveAgentToolsMock,
}));

vi.mock('@/lib/ai/agents/executive-agent/toolResultReuseCache', () => ({
  createExecutiveToolResultReuseCache: () => ({
    get: () => null,
    set: () => {},
    noteMutation: () => {},
    getStats: () => ({}),
    getMcp: () => null,
    setMcp: () => {},
    noteMcpMutation: () => {},
    getMcpStats: () => ({}),
  }),
  isAppendToSupermemorySuccessful: () => false,
  isCommitCalendarChangeSuccessful: () => false,
}));

vi.mock('@/lib/ai/agents/executive-agent/tool-schema-normalization', () => ({
  normalizeExecutiveAgentToolsForModel: (tools: Record<string, unknown>) => tools,
}));

vi.mock('@/lib/ai/agents/executive-agent/mcp/promptFragments', () => ({
  buildExecutiveMcpPromptFragments: () => ({
    toolSummaryLines: [],
    degradedSummaryLines: [],
    availableServerLines: [],
    reminderLines: [],
  }),
}));

vi.mock('@/lib/services/mcp/policy/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/mcp/policy/service')>();
  return {
    ...actual,
    resolveMcpToolExposure: resolveMcpToolExposureMock.mockResolvedValue({
      selectedConnectionIds: [],
      approvedTools: [],
      mutationTools: [],
      degradedTools: [],
      pendingAction: null,
      promptSummary: {
        toolSummaryLines: [],
        degradedLines: [],
      },
    }),
    listSelectableMcpServerPacks: listSelectableMcpServerPacksMock.mockResolvedValue([]),
  };
});

vi.mock('@/lib/ai/tracing', () => ({
  buildAiTraceMetadata: () => undefined,
  wrapToolsWithAiTracing: (_traceContext: unknown, tools: Record<string, unknown>) => tools,
}));

import { ExecutiveAgent } from '@/lib/ai/agents/executive-agent/executiveAgent';
import type { ExecutiveAgentInput } from '@/lib/ai/agents/executive-agent/types';

function buildInput(params: {
  userRequest: string;
  history?: ExecutiveAgentInput['conversationHistory'];
}): ExecutiveAgentInput {
  return {
    userId: 'user-1',
    userEmail: 'user@example.com',
    userRequest: params.userRequest,
    conversationId: 'conv-1',
    channel: 'twilio',
    conversationHistory: params.history ?? [],
    runContext: {
      runId: 'run-1',
      burstId: 'burst-1',
      classifierDecision: null,
      priorPack: null,
      droppedSummary: [],
      isRunCurrent: async () => true,
      isBurstStable: () => true,
    },
  };
}

function tool(name: string) {
  return {
    description: name,
    inputSchema: {},
    execute: async () => ({ ok: true }),
  };
}

describe('Executive agent repair rerun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callTextWithMessagesMock.mockResolvedValue({ text: '' });
    resolveMcpToolExposureMock.mockResolvedValue({
      selectedConnectionIds: [],
      approvedTools: [],
      mutationTools: [],
      degradedTools: [],
      pendingAction: null,
      promptSummary: {
        toolSummaryLines: [],
        degradedLines: [],
      },
    });
    listSelectableMcpServerPacksMock.mockResolvedValue([]);
  });

  test('out-of-pack tool references cause exactly one repair rerun', async () => {
    let buildCount = 0;
    buildExecutiveAgentToolsMock.mockImplementation((context) => {
      buildCount += 1;
      return buildCount === 1
        ? { search_memory: tool('search_memory') }
        : {
            search_memory: tool('search_memory'),
            send_email: tool('send_email'),
          };
    });

    callTextWithToolsMock
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ toolName: 'send_email' }],
        toolResults: [],
        steps: [{ toolCalls: [{ toolName: 'send_email' }] }],
        toolBudget: { totalCalls: 0, perTool: {} },
      })
      .mockResolvedValueOnce({
        text: 'Sent.',
        toolCalls: [{ toolName: 'send_email' }],
        toolResults: [{ toolName: 'send_email', result: { success: true } }],
        steps: [{ toolCalls: [{ toolName: 'send_email' }] }],
        toolBudget: { totalCalls: 1, perTool: { send_email: 1 } },
      });

    const agent = new ExecutiveAgent();
    const result = await agent.process(
      buildInput({
        userRequest: 'send it',
        history: [
          {
            id: 'draft-1',
            role: 'ASSISTANT',
            direction: 'OUTBOUND',
            content: 'Draft ready:\nTo: alex@example.com\nSub: Update\n\nHey Alex,\nDone.\n',
            metadata: null,
            createdAt: new Date('2026-03-16T18:00:00.000Z'),
          },
        ],
      }),
    );

    expect(callTextWithToolsMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(callTextWithToolsMock.mock.calls[1]![0].tools)).toContain('send_email');
    expect(result.metadata?.harness).toMatchObject({
      repairAttempted: true,
      repairReason: 'out_of_pack_tool_reference',
    });
  });

  test('semantic zero-tool stalls do not silently trigger a second pass', async () => {
    buildExecutiveAgentToolsMock.mockImplementation(() => ({
      search_memory: tool('search_memory'),
    }));

    callTextWithToolsMock
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [],
        toolResults: [],
        steps: [],
        toolBudget: { totalCalls: 0, perTool: {} },
      })
      .mockResolvedValueOnce({
        text: 'I need to request the right action pack first.',
        toolCalls: [],
        toolResults: [],
        steps: [],
        toolBudget: { totalCalls: 0, perTool: {} },
      });

    const agent = new ExecutiveAgent();
    const result = await agent.process(
      buildInput({
        userRequest: 'move my meeting to friday',
      }),
    );

    expect(callTextWithToolsMock).toHaveBeenCalledTimes(1);
    expect(result.metadata?.harness).toMatchObject({
      repairAttempted: false,
    });
  });

});
