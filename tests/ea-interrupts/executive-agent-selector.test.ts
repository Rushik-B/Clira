import { describe, expect, test } from 'vitest';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import {
  enforcePackSafety,
  extractExecutiveTurnFeatures,
  selectExecutiveToolPack,
} from '@/lib/ai/agents/executive-agent/selector';
import type { ExecutiveAgentInput } from '@/lib/ai/agents/executive-agent/types';

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

describe('Executive agent selector', () => {
  test('chooses email_send_pack only with explicit approval and recent unsent draft', () => {
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
    const selection = selectExecutiveToolPack(features);

    expect(features.explicitSendApproval).toBe(true);
    expect(features.draftCandidatePresent).toBe(true);
    expect(features.hasRecentSendSuccess).toBe(false);
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
    const selection = selectExecutiveToolPack(features);

    expect(features.explicitSendApproval).toBe(true);
    expect(features.draftCandidatePresent).toBe(false);
    expect(features.hasRecentSendSuccess).toBe(true);
    expect(selection.packId).not.toBe('email_send_pack');
  });

  test('ambiguous email-like turn fails open to inbox_context_pack', () => {
    const input = buildInput({
      userRequest: 'what did Alex say about tomorrow?',
      classifierDecision: 'ambiguous',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = selectExecutiveToolPack(features);

    expect(features.ambiguousEmailLike).toBe(true);
    expect(selection.packId).toBe('inbox_context_pack');
  });

  test('ambiguous calendar-like turn fails open to calendar_query_pack', () => {
    const input = buildInput({
      userRequest: "what's on my calendar friday?",
      classifierDecision: 'ambiguous',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = selectExecutiveToolPack(features);

    expect(features.ambiguousCalendarLike).toBe(true);
    expect(selection.packId).toBe('calendar_query_pack');
  });

  test('workload overview phrasing routes to calendar_query_pack', () => {
    const input = buildInput({
      userRequest: "what's on my plate today?",
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = selectExecutiveToolPack(features);

    expect(features.workloadOverviewIntent).toBe(true);
    expect(selection.packId).toBe('calendar_query_pack');
  });

  test('deadline-oriented phrasing routes to calendar_query_pack', () => {
    const input = buildInput({
      userRequest: 'what are my upcoming deadlines this week?',
    });

    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });
    const selection = selectExecutiveToolPack(features);

    expect(features.workloadOverviewIntent).toBe(true);
    expect(selection.packId).toBe('calendar_query_pack');
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

  test('safety guard downgrades unsafe calendar_mutation_pack', () => {
    const input = buildInput({
      userRequest: 'what meetings do i have tomorrow?',
    });
    const features = extractExecutiveTurnFeatures({
      input,
      pendingCalendarChangePresent: false,
    });

    expect(features.calendarMutationIntent).toBe(false);
    expect(
      enforcePackSafety('calendar_mutation_pack', features),
    ).toBe('calendar_query_pack');
  });
});
