import { describe, expect, test, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get: () => ({}),
    },
  ),
}));

import { buildExecutiveAgentTools } from '@/lib/ai/agents/executive-agent/tools';
import {
  extractExecutiveTurnFeatures,
} from '@/lib/ai/agents/executive-agent/selector';
import type {
  ExecutiveAgentInput,
  ExecutiveRuntimeContext,
  ToolPackId,
} from '@/lib/ai/agents/executive-agent/types';
import type {
  McpConnectionRecord,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';

function buildInput(params: {
  userRequest: string;
  classifierDecision?: NonNullable<ExecutiveAgentInput['runContext']>['classifierDecision'];
}): ExecutiveAgentInput {
  return {
    userId: 'user-1',
    userEmail: 'user@example.com',
    userRequest: params.userRequest,
    conversationId: 'conv-1',
    channel: 'twilio',
    conversationHistory: [],
    runContext: {
      runId: 'run-1',
      burstId: 'burst-1',
      classifierDecision: params.classifierDecision ?? null,
      droppedSummary: [],
      isRunCurrent: async () => true,
      isBurstStable: () => true,
    },
  };
}

function buildContext(params: {
  input: ExecutiveAgentInput;
  pendingCalendarChangePresent: boolean;
  selectedPacks?: ToolPackId[];
}): ExecutiveRuntimeContext {
  const turnFeatures = extractExecutiveTurnFeatures({
    input: params.input,
    pendingCalendarChangePresent: params.pendingCalendarChangePresent,
  });
  const selectedPacks = params.selectedPacks ?? ['inbox_context_pack'];

  return {
    input: params.input,
    channel: 'twilio',
    retrievalProfile: 'messaging',
    selectedPack: selectedPacks[0],
    selectedPacks,
    selectorReasons: ['test'],
    turnFeatures,
    userTimezone: 'America/Vancouver',
    currentTimeUtc: '2026-03-02T18:00:00.000Z',
    currentTimeUserTz: 'Monday, March 2, 2026 at 10:00 AM',
    dayOfWeek: 'Monday',
    toolAbort: {
      timeLeftMs: () => 30_000,
    },
    toolAbortSignal: undefined,
    isRunCurrent: async () => true,
    isBurstStable: () => true,
    onMemoryStored: () => {},
    registerToolResultCacheStatsReader: () => {},
    toolResultCache: {
      get: () => null,
      set: () => {},
      noteMutation: () => {},
      getStats: () => ({
        search_inbox_context: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        list_inbox_emails: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        read_email_pdf_attachment: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        search_calendar: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        check_calendar: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
        search_memory: {
          history_hit: 0,
          runtime_hit: 0,
          miss_not_found: 0,
          miss_expired: 0,
          miss_invalidated: 0,
          set_ok: 0,
          set_skipped_non_cacheable: 0,
        },
      }),
    },
  };
}

function buildMcpConnection(overrides?: Partial<McpConnectionRecord>): McpConnectionRecord {
  return {
    id: 'mcp-conn-1',
    userId: 'user-1',
    serverKey: 'docs',
    displayName: 'Docs Workspace',
    transport: {
      type: 'streamable_http',
      endpoint: 'https://mcp.example.com',
      headers: {},
    },
    authMode: 'none',
    status: 'synced',
    trustClass: 'user_configured',
    degradedReason: null,
    syncDiagnostics: null,
    healthDiagnostics: null,
    lastSyncedAt: new Date('2026-03-02T18:00:00.000Z'),
    lastHealthCheckedAt: new Date('2026-03-02T18:00:00.000Z'),
    consecutiveFailures: 0,
    circuitOpenedAt: null,
    circuitOpenUntil: null,
    disabledAt: null,
    createdAt: new Date('2026-03-02T17:00:00.000Z'),
    updatedAt: new Date('2026-03-02T18:00:00.000Z'),
    ...overrides,
  };
}

function buildMcpTool(overrides?: Partial<McpToolManifestRecord>): McpToolManifestRecord {
  return {
    id: 'mcp-tool-1',
    connectionId: 'mcp-conn-1',
    toolName: 'search_docs',
    toolSlug: 'search_docs',
    modelToolName: 'mcp__docs__search_docs',
    displayTitle: 'Search docs',
    description: 'Search external docs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
    outputSchema: null,
    annotations: null,
    actionClass: 'read',
    capabilityId: 'docs_read',
    latencyClass: 'fast',
    safeForAutoUse: true,
    syncDiagnostics: null,
    lastSyncedAt: new Date('2026-03-02T18:00:00.000Z'),
    createdAt: new Date('2026-03-02T17:00:00.000Z'),
    updatedAt: new Date('2026-03-02T18:00:00.000Z'),
    ...overrides,
  };
}

describe('Executive agent tool packs', () => {
  test('tool maps are deterministic and sorted', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'find the email from my professor' }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['inbox_context_pack'],
    });

    const tools = buildExecutiveAgentTools(context);
    const toolNames = Object.keys(tools);

    expect(toolNames).toEqual([...toolNames].sort());
  });

  test('ambiguous inbox turns never expose send or calendar mutation tools', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'what did Alex say about tomorrow?',
        classifierDecision: 'ambiguous',
      }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['inbox_context_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('search_inbox_context');
    expect(toolNames).toContain('list_inbox_emails');
    expect(toolNames).toContain('read_email_pdf_attachment');
    expect(toolNames).not.toContain('send_email');
    expect(toolNames).not.toContain('plan_calendar_change');
    expect(toolNames).not.toContain('commit_calendar_change');
  });

  test('new calendar mutation turns expose plan but not commit', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'move my 3 meetings tomorrow to Friday' }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['calendar_mutation_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('plan_calendar_change');
    expect(toolNames).not.toContain('commit_calendar_change');
  });

  test('multi-pack reminder plus calendar turns expose both tool families', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'remind me tomorrow at 9pm to study and put it on my calendar too',
      }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['calendar_mutation_pack', 'reminder_alert_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(context.selectedPacks).toEqual([
      'calendar_mutation_pack',
      'reminder_alert_pack',
    ]);
    expect(toolNames).toContain('plan_calendar_change');
    expect(toolNames).toContain('add_reminder');
    expect(toolNames).not.toContain('list_inbox_emails');
  });

  test('settings turns expose only the reply preference tool family', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'always reply to my mom informally and end with love you',
      }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['settings_mutation_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('manage_reply_preferences');
    expect(toolNames).toContain('get_reply_preferences');
    expect(toolNames).toContain('search_memory');
    expect(toolNames).not.toContain('send_email');
    expect(toolNames).not.toContain('plan_calendar_change');
    expect(toolNames).not.toContain('add_reminder');
  });

  test('pending calendar confirm turns expose commit but not plan', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'yes' }),
      pendingCalendarChangePresent: true,
      selectedPacks: ['calendar_mutation_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('commit_calendar_change');
    expect(toolNames).not.toContain('plan_calendar_change');
  });

  test('core recall turns expose deterministic inbox listing but send pack does not', () => {
    const recallContext = buildContext({
      input: buildInput({ userRequest: 'show me all emails from Alice this week' }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['core_recall_pack'],
    });
    const recallTools = Object.keys(buildExecutiveAgentTools(recallContext));

    expect(recallTools).toContain('list_inbox_emails');
    expect(recallTools).not.toContain('read_email_pdf_attachment');

    const sendContext = buildContext({
      input: buildInput({ userRequest: 'draft an email to Alice' }),
      pendingCalendarChangePresent: false,
    });
    const sendTools = Object.keys(buildExecutiveAgentTools({
      ...sendContext,
      selectedPack: 'email_send_pack',
      selectedPacks: ['email_send_pack'],
    }));

    expect(sendTools).toContain('read_email_pdf_attachment');
    expect(sendTools).not.toContain('list_inbox_emails');
  });

  test('approved read-only MCP tools are exposed alongside native tools', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'find the notion spec' }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['inbox_context_pack'],
    });

    context.mcpToolExposure = {
      capabilityIntents: ['docs_read'],
      approvedTools: [
        {
          connection: buildMcpConnection(),
          tool: buildMcpTool(),
          decision: {
            visible: true,
            callable: true,
            requiresConfirmation: false,
            reason: 'approved',
          },
        },
      ],
      degradedTools: [],
      promptSummary: {
        capabilityLines: ['Docs Workspace: docs_read via Search docs'],
        degradedLines: [],
      },
    };

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('search_inbox_context');
    expect(toolNames).toContain('mcp__docs__search_docs');
  });
});
