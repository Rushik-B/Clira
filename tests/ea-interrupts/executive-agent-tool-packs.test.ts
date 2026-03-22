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
import {
  listRequestableActionPackIds,
} from '@/lib/ai/agents/executive-agent/toolPacks';
import type {
  ExecutiveAgentInput,
  ExecutiveRuntimeContext,
  ToolPackId,
} from '@/lib/ai/agents/executive-agent/types';
import type {
  McpConnectionRecord,
  McpToolManifestRecord,
} from '@/lib/services/mcp/types';
import type { SelectableSkill, SkillExposure } from '@/lib/services/skills';

function buildInput(params: {
  userRequest: string;
  history?: ExecutiveAgentInput['conversationHistory'];
  classifierDecision?: NonNullable<ExecutiveAgentInput['runContext']>['classifierDecision'];
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
  requestableActionPackIds?: Array<Exclude<ToolPackId, 'safe_context_pack'>>;
  selectableSkills?: SelectableSkill[];
  skillExposure?: SkillExposure | null;
}): ExecutiveRuntimeContext {
  const turnFeatures = extractExecutiveTurnFeatures({
    input: params.input,
    pendingCalendarChangePresent: params.pendingCalendarChangePresent,
  });
  const selectedPacks = params.selectedPacks ?? ['safe_context_pack'];

  return {
    input: params.input,
    channel: 'twilio',
    retrievalProfile: 'messaging',
    selectedPack: selectedPacks[0]!,
    selectedPacks,
    exposureReasons: ['test'],
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
        read_email_attachment_content: {
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
        search_web: {
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
      getMcp: () => null,
      setMcp: () => {},
      noteMcpMutation: () => {},
      getMcpStats: () => ({
        history_hit: 0,
        runtime_hit: 0,
        miss_not_found: 0,
        miss_expired: 0,
        miss_invalidated: 0,
        set_ok: 0,
        set_skipped_non_cacheable: 0,
      }),
    },
    selectableSkills: params.selectableSkills ?? [],
    skillExposure: params.skillExposure ?? null,
    requestableActionPackIds: params.requestableActionPackIds ?? [],
  };
}

function buildSelectableSkill(overrides?: Partial<SelectableSkill>): SelectableSkill {
  return {
    id: 'skill-1',
    slug: 'investor-updates',
    name: 'Investor Updates',
    description: 'Handle investor update requests tersely.',
    catalogSummary: 'Handle investor update requests tersely.',
    ...overrides,
  };
}

function buildMcpConnection(overrides?: Partial<McpConnectionRecord>): McpConnectionRecord {
  return {
    id: 'mcp-conn-1',
    userId: 'user-1',
    serverKey: 'docs',
    displayName: 'Docs Workspace',
    packDescription: null,
    disabledToolNames: [],
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
  test('safe context substrate stays read-oriented on its own', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'what did Alex say about tomorrow?',
        classifierDecision: 'ambiguous',
      }),
      pendingCalendarChangePresent: false,
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toEqual([
      'search_memory',
      'append_to_supermemory',
      'send_progress_update',
      'search_inbox_context',
      'list_inbox_emails',
      'read_email_attachment_content',
      'read_email_pdf_attachment',
      'search_calendar',
      'check_calendar',
      'search_web',
      'get_reply_preferences',
    ]);
    expect(toolNames).not.toContain('send_email');
    expect(toolNames).not.toContain('plan_calendar_change');
    expect(toolNames).not.toContain('commit_calendar_change');
    expect(toolNames).not.toContain('manage_reply_preferences');
  });

  test('new calendar mutation turns expose plan but not commit', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'move my 3 meetings tomorrow to Friday' }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['safe_context_pack', 'calendar_mutation_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('plan_calendar_change');
    expect(toolNames).not.toContain('commit_calendar_change');
  });

  test('safe context can expose request_tool_pack_exposure for hidden action packs', () => {
    const input = buildInput({
      userRequest: 'move my 3 meetings tomorrow to Friday',
    });
    const context = buildContext({
      input,
      pendingCalendarChangePresent: false,
      requestableActionPackIds: listRequestableActionPackIds(
        extractExecutiveTurnFeatures({
          input,
          pendingCalendarChangePresent: false,
        }),
      ),
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('request_tool_pack_exposure');
    expect(toolNames).not.toContain('plan_calendar_change');
  });

  test('safe context can expose request_skill_exposure for selectable skills', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'Use the investor playbook here',
      }),
      pendingCalendarChangePresent: false,
      selectableSkills: [buildSelectableSkill()],
      skillExposure: {
        selectedSkillIds: [],
        selectedSkills: [],
        availableSkills: [buildSelectableSkill()],
        unavailableSkillIds: [],
      },
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('request_skill_exposure');
  });

  test('pending calendar confirm turns expose commit but not plan', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'yes' }),
      pendingCalendarChangePresent: true,
      selectedPacks: ['safe_context_pack', 'calendar_mutation_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('commit_calendar_change');
    expect(toolNames).not.toContain('plan_calendar_change');
  });

  test('standing reply preference writes unlock manage_reply_preferences', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'always reply to my mom informally and end with love you',
      }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['safe_context_pack', 'settings_mutation_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('get_reply_preferences');
    expect(toolNames).toContain('manage_reply_preferences');
    expect(toolNames).not.toContain('send_email');
  });

  test('reply preference reads use safe context without unlocking settings mutation', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'what reply preferences do you have saved for me?',
      }),
      pendingCalendarChangePresent: false,
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('get_reply_preferences');
    expect(toolNames).not.toContain('manage_reply_preferences');
  });

  test('explicit send approval with a real draft unlocks send_email', () => {
    const context = buildContext({
      input: buildInput({
        userRequest: 'send it',
        history: [
          {
            id: 'assistant-draft',
            role: 'ASSISTANT',
            direction: 'OUTBOUND',
            content: 'Draft ready:\nTo: alex@example.com\nSub: Update\n\nHey Alex,\nDone.\n',
            metadata: null,
            createdAt: new Date('2026-03-02T17:00:00.000Z'),
          },
        ],
      }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['safe_context_pack', 'email_send_pack'],
    });

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('send_email');
  });

  test('approved read-only MCP tools are appended after native tools', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'find the notion spec' }),
      pendingCalendarChangePresent: false,
    });

    context.mcpToolExposure = {
      selectedConnectionIds: ['mcp-conn-1'],
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
      mutationTools: [],
      degradedTools: [],
      pendingAction: null,
      promptSummary: {
        toolSummaryLines: ['Docs Workspace: Search docs (read)'],
        degradedLines: [],
      },
    };

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames.slice(0, 11)).toEqual([
      'search_memory',
      'append_to_supermemory',
      'send_progress_update',
      'search_inbox_context',
      'list_inbox_emails',
      'read_email_attachment_content',
      'read_email_pdf_attachment',
      'search_calendar',
      'check_calendar',
      'search_web',
      'get_reply_preferences',
    ]);
    expect(toolNames.slice(-2)).toEqual([
      'read_content_reference',
      'mcp__docs__search_docs',
    ]);
  });

  test('mutation-capable MCP exposure adds wrappers after native tools', () => {
    const context = buildContext({
      input: buildInput({ userRequest: 'put the interview on my external work calendar' }),
      pendingCalendarChangePresent: false,
      selectedPacks: ['safe_context_pack', 'calendar_mutation_pack'],
    });

    context.mcpToolExposure = {
      selectedConnectionIds: ['mcp-conn-cal'],
      approvedTools: [],
      mutationTools: [
        {
          connection: buildMcpConnection({
            id: 'mcp-conn-cal',
            serverKey: 'calendar',
            displayName: 'Work Calendar',
          }),
          tool: buildMcpTool({
            id: 'mcp-tool-cal',
            connectionId: 'mcp-conn-cal',
            toolName: 'create_event',
            toolSlug: 'create_event',
            modelToolName: 'mcp__calendar__create_event',
            displayTitle: 'Create event',
            actionClass: 'write',
            safeForAutoUse: false,
          }),
          decision: {
            visible: true,
            callable: false,
            requiresConfirmation: true,
            reason: 'preview_required',
          },
        },
      ],
      degradedTools: [],
      pendingAction: {
        id: 'pending-1',
        userId: 'user-1',
        conversationId: 'conv-1',
        connectionId: 'mcp-conn-cal',
        toolName: 'create_event',
        modelToolName: 'mcp__calendar__create_event',
        displayTitle: 'Create event',
        actionClass: 'write',
        trustClass: 'user_configured',
        userRequest: 'put the interview on my external work calendar',
        args: { title: 'Interview' },
        previewText: 'Preview',
        previewSummary: null,
        status: 'pending',
        idempotencyKey: 'idem-1',
        expiresAt: new Date('2026-03-02T19:00:00.000Z'),
        consumedAt: null,
        cancelledAt: null,
        resultSummary: null,
        createdAt: new Date('2026-03-02T18:00:00.000Z'),
        updatedAt: new Date('2026-03-02T18:00:00.000Z'),
      },
      promptSummary: {
        toolSummaryLines: [
          'Work Calendar: Create event (write, preview required)',
        ],
        degradedLines: [],
      },
    };

    const toolNames = Object.keys(buildExecutiveAgentTools(context));

    expect(toolNames).toContain('plan_calendar_change');
    expect(toolNames.slice(-4)).toEqual([
      'read_content_reference',
      'plan_mcp_action',
      'commit_mcp_action',
      'cancel_mcp_action',
    ]);
    expect(toolNames).not.toContain('mcp__calendar__create_event');
  });
});
