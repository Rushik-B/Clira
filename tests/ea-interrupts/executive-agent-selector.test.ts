import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import {
  enforcePackSafety,
  extractExecutiveTurnFeatures,
  selectExecutiveToolPackForTurn,
} from '@/lib/ai/agents/executive-agent/selector';
import { buildPackToolAllowlist } from '@/lib/ai/agents/executive-agent/toolPacks';
import type { ExecutiveAgentInput } from '@/lib/ai/agents/executive-agent/types';

const ALL_PACKS = [
  'core_recall_pack',
  'inbox_context_pack',
  'calendar_query_pack',
  'calendar_mutation_pack',
  'reminder_alert_pack',
  'settings_mutation_pack',
  'email_send_pack',
] as const;

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
  classifierDecision?: NonNullable<ExecutiveAgentInput['runContext']>['classifierDecision'];
  priorPack?: NonNullable<ExecutiveAgentInput['runContext']>['priorPack'];
  burstId?: string;
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
      burstId: params.burstId ?? 'burst-1',
      classifierDecision: params.classifierDecision ?? null,
      priorPack: params.priorPack ?? null,
      droppedSummary: [],
      isRunCurrent: async () => true,
      isBurstStable: () => true,
    },
  };
}

describe('Executive agent selector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('bypasses the LLM for explicit send approval with a recent unsent draft', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    const fetchMock = vi.spyOn(globalThis, 'fetch');

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

    expect(features.explicitSendApproval).toBe(true);
    expect(features.draftCandidatePresent).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(selection.packId).toBe('email_send_pack');
  });

  test('rejects already-sent drafts as send candidates', () => {
    const input = buildInput({
      userRequest: 'send it',
      history: [
        buildAssistantMessage({
          createdAt: '2026-03-02T17:00:00.000Z',
          content: `Draft ready:\nTo: jake@acme.com\nSub: Quick update\n\nHey Jake,\nAll set.\n`,
        }),
        buildAssistantMessage({
          createdAt: '2026-03-02T17:02:00.000Z',
          content: 'Sent.',
          metadata: {
            toolResults: [
              {
                toolName: 'send_email',
                result: { success: true, messageId: 'msg-1' },
              },
            ],
          },
        }),
      ],
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.explicitSendApproval).toBe(true);
    expect(features.draftCandidatePresent).toBe(false);
    expect(
      enforcePackSafety('email_send_pack', features),
    ).toBe('inbox_context_pack');
  });

  test('detects workload overview phrasing', () => {
    const input = buildInput({
      userRequest: "what's on my plate today?",
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.workloadOverviewIntent).toBe(true);
  });

  test('detects deadline-oriented workload overview phrasing', () => {
    const input = buildInput({
      userRequest: 'what are my upcoming deadlines this week?',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.workloadOverviewIntent).toBe(true);
  });

  test('detects time-window mutation phrasing', () => {
    const input = buildInput({
      userRequest: 'block out tonight 9-10pm',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.calendarMutationIntent).toBe(true);
  });

  test('detects combined reminder and calendar mutation phrasing', () => {
    const input = buildInput({
      userRequest: 'remind me tomorrow at 9pm to submit the form and put it on my calendar',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.calendarMutationIntent).toBe(true);
    expect(features.reminderIntent).toBe(true);
  });

  test('detects reply preference mutation phrasing', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    const fetchMock = vi.spyOn(globalThis, 'fetch');
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

    expect(features.replyPreferenceIntent).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(selection.packIds).toEqual(['settings_mutation_pack']);
  });

  test('safety guard downgrades unsafe email_send_pack', () => {
    const input = buildInput({
      userRequest: 'send it',
      history: [],
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.draftCandidatePresent).toBe(false);
    expect(
      enforcePackSafety('email_send_pack', features),
    ).toBe('inbox_context_pack');
  });

  test('bypasses the LLM for pending calendar confirmations', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const input = buildInput({
      userRequest: 'yes',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: true,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(features.pendingCalendarConfirmIntent).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(selection.packIds).toEqual(['calendar_mutation_pack']);
  });

  test('treats plain "sure" as a calendar commit confirmation', () => {
    const input = buildInput({
      userRequest: 'sure',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: true,
    });

    expect(features.pendingCalendarConfirmIntent).toBe(true);
  });

  test('treats "ok" and "alright" as calendar commit confirmations', () => {
    for (const phrase of ['ok', 'okay', 'alright', 'sounds good', 'perfect']) {
      const input = buildInput({ userRequest: phrase });
      const features = extractExecutiveTurnFeatures({ input, pendingCalendarChangePresent: true });
      expect(features.pendingCalendarConfirmIntent).toBe(true);
    }
  });

  test('commit_calendar_change stays available in calendar_mutation_pack when pending change exists even without detected confirmation intent', () => {
    // User says something ambiguous while a pending change exists.
    // The tool must still be available so the model can decide — its own
    // decision param ("confirm" | "cancel") is the real safety gate.
    const input = buildInput({ userRequest: 'what does the plan look like again?' });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: true,
    });

    expect(features.pendingCalendarConfirmIntent).toBe(false);
    expect(features.pendingCalendarModifyIntent).toBe(false);

    const allowlist = buildPackToolAllowlist('calendar_mutation_pack', features);
    expect(allowlist).toContain('commit_calendar_change');
  });

  test('commit_calendar_change is removed from calendar_mutation_pack when user wants to modify the plan', () => {
    const input = buildInput({ userRequest: 'actually change it to 3pm instead' });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: true,
    });

    expect(features.pendingCalendarModifyIntent).toBe(true);

    const allowlist = buildPackToolAllowlist('calendar_mutation_pack', features);
    expect(allowlist).not.toContain('commit_calendar_change');
  });

  test('calendar_mutation_pack is not downgraded by safety (LLM selector may detect intent from context)', () => {
    const input = buildInput({
      userRequest: 'what meetings do i have tomorrow?',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.calendarMutationIntent).toBe(false);
    // calendar_mutation_pack is no longer blocked by enforcePackSafety —
    // the LLM selector has conversation context and the per-tool allowlist
    // in buildPackToolAllowlist gates dangerous tools at runtime.
    expect(
      enforcePackSafety('calendar_mutation_pack', features),
    ).toBe('calendar_mutation_pack');
  });

  test('does not bypass LLM selector for reminder turns', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                packIds: ['reminder_alert_pack', 'calendar_mutation_pack'],
              }),
            },
          },
        ],
        id: 'resp-reminder',
      }),
    } as Response);

    const input = buildInput({
      userRequest: 'remind me tomorrow at 9pm and put it on my calendar',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(selection.packIds).toEqual([
      'reminder_alert_pack',
      'calendar_mutation_pack',
    ]);
  });

  test('uses direct Cerebras selector request with minimal strict schema', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  packIds: ['calendar_query_pack'],
                  reason: 'calendar query',
                  confidence: 0.9,
                }),
              },
            },
          ],
          id: 'resp-1',
        }),
      } as Response);

    const input = buildInput({
      userRequest: 'what meetings do i have tomorrow?',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.packId).toBe('calendar_query_pack');
    expect(selection.packIds).toEqual(['calendar_query_pack']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('llama3.1-8b');
    expect(body.response_format.type).toBe('json_schema');
    expect(
      body.response_format.json_schema.schema.additionalProperties,
    ).toBe(false);
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  test('exposes all packs when Cerebras returns 422', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"invalid schema","param":"response_format"}',
    } as Response);

    const input = buildInput({
      userRequest: 'what meetings do i have tomorrow?',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.packId).toBe('core_recall_pack');
    expect(selection.packIds).toEqual([...ALL_PACKS]);
    expect(selection.reasons).toContain('selector failed; exposed all packs');
  });

  test('exposes all packs when Cerebras is rate-limited', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ packIds: ['inbox_context_pack'] }),
              },
            },
          ],
          id: 'resp-ok-1',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '{"message":"high traffic","code":"queue_exceeded"}',
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '{"message":"high traffic","code":"queue_exceeded"}',
      } as Response);

    const input1 = buildInput({
      userRequest: 'search my inbox for the whistler visitor trip email',
      burstId: 'burst-rate-limit-1',
    });
    const features1 = extractExecutiveTurnFeatures({
      input: input1,
      pendingCalendarChangePresent: false,
    });
    const selection1 = await selectExecutiveToolPackForTurn({
      input: input1,
      features: features1,
    });

    expect(selection1.packId).toBe('inbox_context_pack');

    const input2 = buildInput({
      userRequest: 'trip...',
      burstId: 'burst-rate-limit-1',
    });
    const features2 = extractExecutiveTurnFeatures({
      input: input2,
      pendingCalendarChangePresent: false,
    });
    const selection2 = await selectExecutiveToolPackForTurn({
      input: input2,
      features: features2,
    });

    expect(selection2.packId).toBe('core_recall_pack');
    expect(selection2.packIds).toEqual([...ALL_PACKS]);
    expect(selection2.reasons).toContain('selector failed; exposed all packs');
  });

  test('does not inherit prior pack on selector failure and exposes all packs instead', async () => {
    vi.stubEnv('EA_SELECTOR_CEREBRAS_ENABLED', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_TWILIO', 'true');
    vi.stubEnv('EA_SELECTOR_CEREBRAS_MODEL', 'llama3.1-8b');
    vi.stubEnv('CEREBRAS_API_KEY', 'test-key');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"message":"high traffic","code":"queue_exceeded"}',
    } as Response);

    const input = buildInput({
      userRequest: 'trip...',
      burstId: 'burst-prior-pack-1',
      priorPack: 'inbox_context_pack',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = await selectExecutiveToolPackForTurn({
      input,
      features,
    });

    expect(selection.packId).toBe('core_recall_pack');
    expect(selection.packIds).toEqual([...ALL_PACKS]);
    expect(selection.reasons).toContain('selector failed; exposed all packs');
  });

  test('exposes all packs when selector is disabled', async () => {
    const input = buildInput({
      userRequest: 'dude',
      classifierDecision: 'followup',
      priorPack: 'inbox_context_pack',
      history: [
        buildAssistantMessage({
          createdAt: '2026-03-11T20:45:06.000Z',
          content: "I couldn't generate a response. Please try again.",
          metadata: {
            toolResults: [
              {
                toolName: 'search_inbox_context',
                result: { ok: false, error: 'tool_budget_exceeded' },
              },
            ],
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

    expect(selection.packId).toBe('core_recall_pack');
    expect(selection.packIds).toEqual([...ALL_PACKS]);
    expect(selection.reasons).toContain('selector unavailable; exposed all packs');
  });
});
