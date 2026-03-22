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
          draftCandidatePresent: false,
          pendingCalendarChangePresent: false,
          channel: 'telegram',
          hasRecentPendingCalendarPreview: false,
          pendingCalendarConfirmIntent: false,
          pendingCalendarCancelIntent: false,
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
          previewText: '**Ready to delete**\n\n"deadline" on Sat, Mar 8 (all day)\n\nReply **confirm** and I\'ll delete it.',
        },
      },
    ]);

    expect(response).toBe(
      '**Ready to delete**\n\n"deadline" on Sat, Mar 8 (all day)\n\nReply **confirm** and I\'ll delete it.',
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

  test('uses working state to avoid generic fallback on calendar mutation turns', () => {
    const response = buildTerminalFallbackResponse([], [], {
      selectedPack: 'calendar_mutation_pack',
      workingState: {
        goal: 'Rename those shifts to Work',
        selectedPack: 'calendar_mutation_pack',
        phase: 'await_approval',
        primaryDomain: 'calendar',
        completedSteps: [],
        nextStep: 'Wait for confirm.',
        factsLearned: [],
        artifacts: {
          pendingCalendarChangeId: 'pending-1',
        },
      },
      turnFeatures: {
        explicitSendApproval: false,
        draftCandidatePresent: false,
        pendingCalendarChangePresent: true,
        channel: 'telegram',
        hasRecentPendingCalendarPreview: true,
        pendingCalendarConfirmIntent: true,
        pendingCalendarCancelIntent: false,
        draftCandidateReason: null,
      },
    });

    expect(response).toBe(
      'I have that calendar change staged. Reply "confirm" to apply it, or tell me what to change.',
    );
  });

  test('uses working-state preview text when trace tool results are empty', () => {
    const controller = createWorkingStateController(
      createInitialWorkingState({
        goal: 'Delete all work shifts next week',
        selectedPack: 'safe_context_pack',
        features: {
          explicitSendApproval: false,
          draftCandidatePresent: false,
          pendingCalendarChangePresent: false,
          channel: 'telegram',
          hasRecentPendingCalendarPreview: false,
          pendingCalendarConfirmIntent: false,
          pendingCalendarCancelIntent: false,
          draftCandidateReason: null,
        },
      }),
    );

    controller.updateFromToolResult('plan_calendar_change', {
      ok: true,
      previewText: '**Ready to delete 3 events**\n\n1) "Work" on Mon, Mar 16 from 9 AM to 5 PM\n2) "Work" on Tue, Mar 17 from 9 AM to 5 PM\n3) "Work" on Wed, Mar 18 from 9 AM to 5 PM\n\nReply **confirm** and I\'ll delete them.',
      pendingChange: {
        pendingId: 'pending-1',
      },
    });

    const response = buildTerminalFallbackResponse([], [], {
      selectedPack: 'safe_context_pack',
      workingState: controller.getState(),
      turnFeatures: {
        explicitSendApproval: false,
        draftCandidatePresent: false,
        pendingCalendarChangePresent: true,
        channel: 'telegram',
        hasRecentPendingCalendarPreview: false,
        pendingCalendarConfirmIntent: false,
        pendingCalendarCancelIntent: false,
        draftCandidateReason: null,
      },
    });

    expect(response).toBe(
      '**Ready to delete 3 events**\n\n1) "Work" on Mon, Mar 16 from 9 AM to 5 PM\n2) "Work" on Tue, Mar 17 from 9 AM to 5 PM\n3) "Work" on Wed, Mar 18 from 9 AM to 5 PM\n\nReply **confirm** and I\'ll delete them.',
    );
  });

  test('uses working-state progress to explain timeout fallback', () => {
    const response = buildTerminalFallbackResponse([], [], {
      selectedPack: 'safe_context_pack',
      workingState: {
        goal: 'show me the tweet',
        selectedPack: 'safe_context_pack',
        phase: 'failed',
        primaryDomain: 'context',
        completedSteps: ['search_inbox_context', 'search_memory', 'search_calendar'],
        nextStep: 'Explain the failure briefly.',
        factsLearned: ['Listed 1 of 1 matching inbox emails.'],
        artifacts: {
          lastTool: 'search_calendar',
          lastToolSummary: 'calendar searched',
        },
      },
      turnFeatures: {
        explicitSendApproval: false,
        draftCandidatePresent: false,
        pendingCalendarChangePresent: false,
        channel: 'telegram',
        hasRecentPendingCalendarPreview: false,
        pendingCalendarConfirmIntent: false,
        pendingCalendarCancelIntent: false,
        draftCandidateReason: null,
      },
      timedOut: true,
    });

    expect(response).toBe(
      'I hit a time limit, but I did check your inbox, memory, and calendar. What I found so far: Listed 1 of 1 matching inbox emails. Give me one narrower clue, like the sender, exact phrase, or timeframe, and I will keep going.',
    );
  });

  test('uses calendar mutation fallback even when the selected pack stayed read-only', () => {
    const response = buildTerminalFallbackResponse([], [], {
      selectedPack: 'safe_context_pack',
      workingState: {
        goal: 'Delete all work shifts next week',
        selectedPack: 'safe_context_pack',
        phase: 'await_approval',
        primaryDomain: 'calendar',
        completedSteps: ['search_calendar', 'plan_calendar_change'],
        nextStep: 'Wait for confirm, cancel, or explicit modification.',
        factsLearned: [],
        artifacts: {
          pendingCalendarChangeId: 'pending-1',
        },
      },
      turnFeatures: {
        explicitSendApproval: false,
        draftCandidatePresent: false,
        pendingCalendarChangePresent: true,
        channel: 'telegram',
        hasRecentPendingCalendarPreview: false,
        pendingCalendarConfirmIntent: false,
        pendingCalendarCancelIntent: false,
        draftCandidateReason: null,
      },
    });

    expect(response).toBe(
      'I have that calendar change staged. Reply "confirm" to apply it, or tell me what to change.',
    );
  });

  test('extracts a due date from expanded inbox tool results before using the generic fallback', () => {
    const response = buildTerminalFallbackResponse([
      {
        toolName: 'search_inbox_context',
        result: {
          expandedThreads: [
            {
              messages: [
                {
                  subject: 'Assignment 1 Posted: CMPT410 D100 Machine Learning / CMPT726 G100 Machine Learning',
                  bodyText:
                    'Assignment 1 has been posted under Files -> Assignments -> Assignment 1. It will be due on Tuesday, March 24, 2026.',
                },
              ],
            },
          ],
        },
      },
    ], [], {
      selectedPack: 'safe_context_pack',
      userRequest: 'when is it due?? 410',
    });

    expect(response).toBe('CMPT 410 Assignment 1 is due on Tuesday, March 24, 2026.');
  });
});
