import { beforeEach, describe, expect, test, vi } from 'vitest';

const instructionMocks = vi.hoisted(() => ({
  compileEffectiveReplyInstructionDoc: vi.fn(),
  resolveReplyInstructionSenderEmail: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  userSettingsFindUnique: vi.fn(),
}));

vi.mock('@/lib/services/reply-instructions', () => ({
  compileEffectiveReplyInstructionDoc: instructionMocks.compileEffectiveReplyInstructionDoc,
  resolveReplyInstructionSenderEmail: instructionMocks.resolveReplyInstructionSenderEmail,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSettings: {
      findUnique: prismaMocks.userSettingsFindUnique,
    },
  },
}));

const {
  buildReplyPlannerPrompt,
} = await import('@/lib/ai/agents/replyPlannerAgent');

const {
  buildStylePrompt,
} = await import('@/lib/ai/agents/styleAgent');

describe('reply instruction prompt integration', () => {
  beforeEach(() => {
    instructionMocks.compileEffectiveReplyInstructionDoc.mockReset();
    instructionMocks.resolveReplyInstructionSenderEmail.mockReset();
    prismaMocks.userSettingsFindUnique.mockReset();

    instructionMocks.resolveReplyInstructionSenderEmail.mockReturnValue('mom@example.com');
    prismaMocks.userSettingsFindUnique.mockResolvedValue({
      calendarTimezone: 'America/Vancouver',
    });
  });

  test('injects the compiled planner instruction doc into the planner prompt', async () => {
    instructionMocks.compileEffectiveReplyInstructionDoc.mockResolvedValue(
      '## Global Instructions\n- Never volunteer calendar times unless asked.',
    );

    const result = await buildReplyPlannerPrompt({
      userId: 'user-1',
      userEmail: 'user@example.com',
      message: {
        messageId: 'msg-1',
        labelIds: [],
        from: 'Mom <mom@example.com>',
        to: ['user@example.com'],
        cc: [],
        subject: 'Dinner',
        body: 'Can you send me a time?',
      },
      receivedAt: new Date('2026-03-14T18:00:00.000Z'),
      threadId: 'thread-1',
    });

    expect(result.prompt).toContain('Never volunteer calendar times unless asked.');
    expect(instructionMocks.compileEffectiveReplyInstructionDoc).toHaveBeenCalledWith({
      userId: 'user-1',
      target: 'planner',
      senderEmail: 'mom@example.com',
    });
  });

  test('injects the compiled style instruction doc ahead of the master prompt', async () => {
    instructionMocks.compileEffectiveReplyInstructionDoc.mockResolvedValue(
      '## Sender-Specific Override (Mom <mom@example.com>)\n- End with "love you".',
    );

    const prompt = await buildStylePrompt({
      userId: 'user-1',
      userEmail: 'user@example.com',
      incomingEmail: {
        from: 'Mom <mom@example.com>',
        to: ['user@example.com'],
        subject: 'Dinner',
        body: 'Can you reply?',
        date: new Date('2026-03-14T18:00:00.000Z'),
      },
      plan: {
        thoughtProcess: 'Keep it warm.',
        mustAddress: ['Acknowledge dinner plan.'],
        factsToPreserve: [],
        recommendedTone: {
          label: 'warm',
          constraints: 'No new facts.',
        },
        ccSuggestions: [],
        draft: 'Sounds good.\n\nLove you.',
        toolUsage: {
          calendarUsed: false,
          threadUsed: false,
          directEmailHistoryUsed: false,
          keywordEmailSearchUsed: false,
          memorySearchUsed: false,
          labelingUsed: false,
        },
      },
      masterPrompt: 'Master Prompt Baseline',
      styleExamples: [],
    });

    expect(prompt).toContain('End with "love you".');
    expect(prompt.indexOf('End with "love you".')).toBeLessThan(
      prompt.indexOf('Master Prompt Baseline'),
    );
    expect(instructionMocks.compileEffectiveReplyInstructionDoc).toHaveBeenCalledWith({
      userId: 'user-1',
      target: 'style',
      senderEmail: 'mom@example.com',
    });
  });
});
