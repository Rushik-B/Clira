import { describe, expect, test } from 'vitest';
import {
  buildTerminalFallbackResponse,
  runWithSubagentBudget,
} from '@/lib/ai/agents/executive-agent/helpers';
import {
  createInitialWorkingState,
  createWorkingStateController,
} from '@/lib/ai/agents/executive-agent/workingState';

describe('runWithSubagentBudget', () => {
  test('skips subagent execution when no run time remains even with uncapped minimum budget', async () => {
    const result = await runWithSubagentBudget({
      toolName: 'plan_calendar_change',
      counts: { total: 0, tool: 0 },
      timeLeftMs: 0,
      toolCallIndex: 2,
      minBudgetMs: 35_000,
      maxBudgetMs: 35_000,
      uncappedBudget: true,
      run: async () => {
        throw new Error('subagent should not run');
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'tool_budget_exceeded',
      tool: 'plan_calendar_change',
    });
  });

  test('caps subagent budget to the configured maximum instead of consuming the full remaining run', async () => {
    const result = await runWithSubagentBudget({
      toolName: 'plan_calendar_change',
      counts: { total: 0, tool: 0 },
      timeLeftMs: 105_989,
      toolCallIndex: 1,
      minBudgetMs: 35_000,
      maxBudgetMs: 35_000,
      uncappedBudget: true,
      run: async ({ budgetMs }) => ({ budgetMs }),
    });

    expect(result).toEqual({ budgetMs: 35_000 });
  });
});

describe('calendar planning working state', () => {
  test('treats clarify plans as clarify state instead of draft', () => {
    const controller = createWorkingStateController(
      createInitialWorkingState({
        goal: 'Delete a deadline and create study blocks',
        selectedPack: 'calendar_mutation_pack',
        features: {
          explicitSendApproval: false,
          explicitSendDecline: false,
          draftCandidatePresent: false,
          pendingCalendarChangePresent: false,
          calendarMutationIntent: true,
          calendarQueryIntent: false,
          workloadOverviewIntent: false,
          emailIntent: false,
          reminderIntent: false,
          alertIntent: false,
          recallIntent: false,
          classifierDecision: null,
          channel: 'telegram',
          hasRecentSendSuccess: false,
          hasRecentPendingCalendarPreview: false,
          pendingCalendarConfirmIntent: false,
          pendingCalendarCancelIntent: false,
          pendingCalendarModifyIntent: false,
          ambiguousCalendarLike: false,
          ambiguousEmailLike: false,
          draftCandidateReason: null,
        },
      }),
    );

    controller.updateFromToolResult('plan_calendar_change', {
      ok: true,
      plan: {
        action: 'clarify',
        confidence: 0,
        requiresConfirmation: false,
        sendUpdates: 'none',
        createMeetLink: false,
        calendarId: 'primary',
        clarifyingQuestions: ['What calendar change should I make?'],
        userPreviewText: 'I ran out of time planning that calendar change. Please try again.',
      },
      previewText: 'I ran out of time planning that calendar change. Please try again.',
    });

    expect(controller.getState().phase).toBe('clarify');
  });
});

describe('buildTerminalFallbackResponse', () => {
  test('uses plan_calendar_change preview text when the model is stopped after planning', () => {
    const response = buildTerminalFallbackResponse([
      {
        toolName: 'plan_calendar_change',
        result: {
          ok: true,
          previewText: 'Proposed deletion: deadline on March 8. Reply to confirm and I will delete it.',
        },
      },
    ]);

    expect(response).toBe(
      'Proposed deletion: deadline on March 8. Reply to confirm and I will delete it.',
    );
  });

  test('uses nested step tool results when top-level tool results are empty', () => {
    const response = buildTerminalFallbackResponse([], [
      {
        toolResults: [
          {
            toolName: 'plan_calendar_change',
            result: {
              ok: true,
              previewText: 'Proposed study blocks ready. Reply to confirm.',
            },
          },
        ],
      },
    ]);

    expect(response).toBe('Proposed study blocks ready. Reply to confirm.');
  });

  test('unwraps tracer-wrapped result (result/output) and uses plan.userPreviewText', () => {
    const response = buildTerminalFallbackResponse([
      {
        toolName: 'plan_calendar_change',
        result: {
          result: {
            ok: true,
            plan: { userPreviewText: 'Proposed: Work shift on Saturday, Mar 14. Reply to confirm.' },
          },
          output: {
            ok: true,
            plan: { userPreviewText: 'Proposed: Work shift on Saturday, Mar 14. Reply to confirm.' },
          },
        },
      },
    ]);

    expect(response).toBe('Proposed: Work shift on Saturday, Mar 14. Reply to confirm.');
  });
});
