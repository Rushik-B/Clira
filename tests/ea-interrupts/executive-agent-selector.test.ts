import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import {
  expandExposurePlanForRepair,
  extractExecutiveTurnFeatures,
  selectExecutiveToolPackForTurn,
} from '@/lib/ai/agents/executive-agent/selector';
import type { ExecutiveAgentInput } from '@/lib/ai/agents/executive-agent/types';
import type { SelectableSkill } from '@/lib/services/skills';

const { listSelectableMcpServerPacksMock } = vi.hoisted(() => ({
  listSelectableMcpServerPacksMock: vi.fn(),
}));

vi.mock('@/lib/services/mcp/policy/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/mcp/policy/service')>();
  return {
    ...actual,
    listSelectableMcpServerPacks: listSelectableMcpServerPacksMock,
  };
});

function buildAssistantMessage(params: {
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): ConversationMessageDTO {
  return {
    id: `assistant-${params.createdAt}`,
    content: params.content,
    role: 'ASSISTANT',
    direction: 'OUTBOUND',
    createdAt: new Date(params.createdAt),
    metadata: params.metadata ?? null,
  };
}

function buildInput(params: {
  userRequest: string;
  history?: ConversationMessageDTO[];
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

function buildMcpServerPack(overrides: Partial<{
  connectionId: string;
  serverKey: string;
  displayName: string;
  packDescription: string;
  capabilityTags: Array<'web_search' | 'docs_search' | 'external_knowledge'>;
  eligibleModelToolNames: string[];
}> = {}) {
  return {
    connectionId: 'mcp-conn-1',
    serverKey: 'docs',
    displayName: 'Docs Workspace',
    packDescription: 'Docs Workspace: 1 read tools (Search docs)',
    capabilityTags: ['docs_search', 'external_knowledge'],
    eligibleModelToolNames: ['mcp__docs__search_docs'],
    ...overrides,
  };
}

function buildSelectableSkill(overrides: Partial<SelectableSkill> = {}): SelectableSkill {
  return {
    id: 'skill-1',
    slug: 'investor-updates',
    name: 'Investor Updates',
    description: 'Handle investor update requests tersely.',
    catalogSummary: 'Handle investor update requests tersely.',
    ...overrides,
  };
}

describe('Executive agent exposure planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSelectableMcpServerPacksMock.mockResolvedValue([]);
  });

  test('draft without recognized approval adds a harness reminder to coach the user', async () => {
    const input = buildInput({
      userRequest: 'can u shoot that over to him',
      history: [
        buildAssistantMessage({
          createdAt: '2026-03-02T17:00:00.000Z',
          content: `Draft ready:\nTo: jake@acme.com\nSub: Quick update\n\nHey Jake,\nAll set.\n`,
        }),
      ],
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    expect(features.draftCandidatePresent).toBe(true);
    expect(features.explicitSendApproval).toBe(false);

    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(
      selection.reminders.some((line) =>
        line.includes('not recognized as explicit send approval'),
      ),
    ).toBe(true);
  });

  test('explicit send approval recognizes standalone send and yes send it', () => {
    expect(
      extractExecutiveTurnFeatures({
        input: buildInput({ userRequest: 'send' }),
        pendingCalendarChangePresent: false,
      }).explicitSendApproval,
    ).toBe(true);

    expect(
      extractExecutiveTurnFeatures({
        input: buildInput({ userRequest: 'yes send it' }),
        pendingCalendarChangePresent: false,
      }).explicitSendApproval,
    ).toBe(true);

    expect(
      extractExecutiveTurnFeatures({
        input: buildInput({ userRequest: 'send me the full thread' }),
        pendingCalendarChangePresent: false,
      }).explicitSendApproval,
    ).toBe(false);
  });

  test('explicit send approval recognizes wrapped reply confirmations', () => {
    expect(
      extractExecutiveTurnFeatures({
        input: buildInput({
          userRequest:
            'User is replying to an earlier Assistant message on Telegram.\n' +
            'Replied-to message: draft ready\n\n' +
            'yes',
        }),
        pendingCalendarChangePresent: false,
      }).explicitSendApproval,
    ).toBe(true);
  });

  test('explicit send approval with an unsent draft deterministically exposes email send', async () => {
    const input = buildInput({
      userRequest: 'send it',
      history: [
        buildAssistantMessage({
          createdAt: '2026-03-02T17:00:00.000Z',
          content: `Draft ready:\nTo: jake@acme.com\nSub: Quick update\n\nHey Jake,\nAll set.\n`,
        }),
      ],
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.primaryPack).toBe('email_send_pack');
    expect(selection.packIds).toEqual(['safe_context_pack', 'email_send_pack']);
    expect(selection.repairAttempted).toBe(false);
  });

  test('reply preference reads stay in safe context without selector-side intent routing', async () => {
    const input = buildInput({
      userRequest: 'what reply preferences do you have saved for me?',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.primaryPack).toBe('safe_context_pack');
    expect(selection.packIds).toEqual(['safe_context_pack']);
  });

  test('standing reply preference writes stay in safe context until requested', async () => {
    const input = buildInput({
      userRequest: 'always reply to my mom informally and end with love you',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.primaryPack).toBe('safe_context_pack');
    expect(selection.packIds).toEqual(['safe_context_pack']);
  });

  test('explicit MCP alias match wins deterministic routing', async () => {
    listSelectableMcpServerPacksMock.mockResolvedValue([
      buildMcpServerPack({
        connectionId: 'mcp-conn-1',
        serverKey: 'notion',
        displayName: 'Notion Workspace',
        eligibleModelToolNames: ['mcp__notion__search_docs'],
      }),
    ]);

    const input = buildInput({
      userRequest: 'use Notion Workspace to find the spec',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.mcpConnectionIds).toEqual(['mcp-conn-1']);
    expect(selection.reasons).toContain('explicit MCP server alias match');
  });

  test('exact skill name mention deterministically preselects the skill', async () => {
    const input = buildInput({
      userRequest: 'Use Investor Updates for this reply.',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
      selectableSkills: [buildSelectableSkill()],
    });

    expect(selection.skillIds).toEqual(['skill-1']);
    expect(selection.reasons).toContain('explicit skill name match');
  });

  test('generic docs phrasing does not preselect MCP connections', async () => {
    listSelectableMcpServerPacksMock.mockResolvedValue([
      buildMcpServerPack({
        connectionId: 'mcp-docs',
        serverKey: 'reference',
        displayName: 'Developer Reference',
        capabilityTags: ['docs_search', 'external_knowledge'],
      }),
      buildMcpServerPack({
        connectionId: 'mcp-web',
        serverKey: 'web',
        displayName: 'Web Search',
        capabilityTags: ['web_search', 'external_knowledge'],
        eligibleModelToolNames: ['mcp__web__search'],
      }),
    ]);

    const input = buildInput({
      userRequest: 'search the documentation for the calendar api',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.mcpConnectionIds).toEqual([]);
  });

  test('continuation phrasing does not reuse prior MCP selection by itself', async () => {
    listSelectableMcpServerPacksMock.mockResolvedValue([
      buildMcpServerPack({
        connectionId: 'mcp-conn-1',
        serverKey: 'docs',
      }),
    ]);

    const input = buildInput({
      userRequest: 'retry that',
      history: [
        buildAssistantMessage({
          createdAt: '2026-03-16T18:00:00.000Z',
          content: 'I checked that already.',
          metadata: {
            harness: {
              mcpConnectionIds: ['mcp-conn-1'],
            },
          },
        }),
      ],
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.mcpConnectionIds).toEqual([]);
  });

  test('repair expansion maps missing native action tools to their owning pack', async () => {
    const input = buildInput({
      userRequest: 'send it',
      history: [
        buildAssistantMessage({
          createdAt: '2026-03-02T17:00:00.000Z',
          content: `Draft ready:\nTo: jake@acme.com\nSub: Quick update\n\nHey Jake,\nAll set.\n`,
        }),
      ],
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const initialPlan = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    const repair = await expandExposurePlanForRepair({
      input,
      features,
      plan: { ...initialPlan, packIds: ['safe_context_pack'] },
      outOfPackToolNames: ['send_email'],
      reason: 'missing_tools',
    });

    expect(repair.expandedPackIds).toEqual(['email_send_pack']);
    expect(repair.plan.packIds).toEqual(['safe_context_pack', 'email_send_pack']);
    expect(repair.plan.repairAttempted).toBe(true);
  });

  test('repair never exposes send_email when the hard gate fails', async () => {
    const input = buildInput({
      userRequest: 'send it',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const initialPlan = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    const repair = await expandExposurePlanForRepair({
      input,
      features,
      plan: initialPlan,
      outOfPackToolNames: ['send_email'],
      reason: 'missing_tools',
    });

    expect(repair.expandedPackIds).toEqual([]);
    expect(repair.plan.packIds).toEqual(['safe_context_pack']);
  });

  test('zero-tool action stall does not silently widen native action packs', async () => {
    const input = buildInput({
      userRequest: 'move my meeting to friday',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const initialPlan = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    const repair = await expandExposurePlanForRepair({
      input,
      features,
      plan: initialPlan,
      outOfPackToolNames: [],
      reason: 'action_intent_stall',
    });

    expect(repair.expandedPackIds).toEqual([]);
    expect(repair.plan.packIds).toEqual(['safe_context_pack']);
    expect(repair.plan.reminders).toContain(
      'If you need native action tools, call request_tool_pack_exposure before claiming you can act.',
    );
  });

  test('repair can expand deterministic MCP exposure from missing MCP tool references', async () => {
    listSelectableMcpServerPacksMock.mockResolvedValue([
      buildMcpServerPack({
        connectionId: 'mcp-docs',
        serverKey: 'docs',
        eligibleModelToolNames: ['mcp__docs__search_docs'],
      }),
    ]);

    const input = buildInput({
      userRequest: 'find the docs',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const initialPlan = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    const repair = await expandExposurePlanForRepair({
      input,
      features,
      plan: { ...initialPlan, mcpConnectionIds: [] },
      outOfPackToolNames: ['mcp__docs__search_docs'],
      reason: 'missing_tools',
    });

    expect(repair.expandedMcpConnectionIds).toEqual(['mcp-docs']);
    expect(repair.plan.mcpConnectionIds).toEqual(['mcp-docs']);
  });
});
