import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReplyRouterRealtimeInput } from '@/lib/ai/agents/replyRouterAgent';

const prismaMocks = vi.hoisted(() => ({
  emailAlert: {
    findMany: vi.fn(),
  },
}));

const llmMocks = vi.hoisted(() => ({
  callObject: vi.fn(),
}));

const promptMocks = vi.hoisted(() => ({
  readPromptFile: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  replyRouter: vi.fn(),
  flashLite: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('@/lib/ai/callLlm', () => ({
  callObject: llmMocks.callObject,
}));

vi.mock('@/lib/prompts', () => ({
  readPromptFile: promptMocks.readPromptFile,
}));

vi.mock('@/lib/ai/models', () => ({
  models: {
    replyRouter: modelMocks.replyRouter,
    flashLite: modelMocks.flashLite,
  },
}));

const { ReplyRouterAgent } = await import('@/lib/ai/agents/replyRouterAgent');

function createInput(shouldReply: boolean, strict = false): ReplyRouterRealtimeInput {
  return {
    userId: 'user-1',
    userEmail: 'user@example.com',
    strict,
    message: {
      messageId: 'msg-1',
      from: 'billing@example.com',
      to: ['user@example.com'],
      cc: [],
      subject: 'Invoice due today',
      body: 'Please review invoice 123 by end of day.',
      labelIds: ['INBOX'],
    },
    filterResult: {
      shouldReply,
      reason: shouldReply ? 'Passed hard-coded filters' : 'Sender not in allowlist',
      category: shouldReply ? 'allowed' : 'filtered',
    },
  };
}

describe('ReplyRouterAgent.evaluateRealtimeRouting', () => {
  let labelingSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMocks.emailAlert.findMany.mockResolvedValue([]);
    promptMocks.readPromptFile.mockImplementation((path: string) =>
      path.includes('Alert') ? 'alert prompt {emailAlerts}' : 'router prompt {emailAlerts}',
    );
    modelMocks.replyRouter.mockReturnValue('gemini-router');
    modelMocks.flashLite.mockReturnValue('gemini-flash-lite');
    llmMocks.callObject.mockRejectedValue(new Error('Unexpected LLM call'));

    labelingSpy = vi
      .spyOn(ReplyRouterAgent.prototype as any, 'applyRealtimeLabeling')
      .mockResolvedValue({
        status: 'skipped-missing-mailbox',
        reason: 'labeling disabled in unit test',
      });
  });

  afterEach(() => {
    labelingSpy.mockRestore();
  });

  test('skips all LLM work when filter already blocks reply and no alerts are active', async () => {
    const result = await new ReplyRouterAgent().evaluateRealtimeRouting(createInput(false));

    expect(prismaMocks.emailAlert.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isActive: true },
      select: { id: true, description: true },
    });
    expect(promptMocks.readPromptFile).not.toHaveBeenCalled();
    expect(llmMocks.callObject).not.toHaveBeenCalled();
    expect(result.replyDecision).toEqual({
      shouldReply: false,
      reason: 'Reply policy blocked draft generation: Sender not in allowlist',
      shouldNotify: false,
    });
  });

  test('uses the alert-only classifier when reply policy blocks but alerts are configured', async () => {
    prismaMocks.emailAlert.findMany.mockResolvedValue([
      { id: 'alert-1', description: 'Notify me about invoices' },
    ]);
    llmMocks.callObject.mockResolvedValue({
      object: {
        shouldNotify: true,
        matchedAlertId: 'alert-1',
        matchedAlertDescription: 'Notify me about invoices',
      },
    });

    const result = await new ReplyRouterAgent().evaluateRealtimeRouting(createInput(false));

    expect(promptMocks.readPromptFile).toHaveBeenCalledWith(
      'core-processing/replyRouterAlertPrompt.md',
    );
    expect(llmMocks.callObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-flash-lite',
        op: 'reply.router.alerts',
      }),
    );
    expect(result.replyDecision).toMatchObject({
      shouldReply: false,
      reason: 'Reply policy blocked draft generation: Sender not in allowlist',
      shouldNotify: true,
      matchedAlertId: 'alert-1',
      matchedAlertDescription: 'Notify me about invoices',
    });
  });

  test('returns a degraded blocked decision when alert-only matching fails', async () => {
    prismaMocks.emailAlert.findMany.mockResolvedValue([
      { id: 'alert-1', description: 'Notify me about invoices' },
    ]);
    llmMocks.callObject.mockRejectedValue(new Error('model unavailable'));

    const result = await new ReplyRouterAgent().evaluateRealtimeRouting(createInput(false));

    expect(result.replyDecision).toEqual({
      shouldReply: false,
      reason: 'Reply policy blocked draft generation: Sender not in allowlist Alert matching unavailable.',
      shouldNotify: false,
    });
  });

  test('keeps the full router path for emails that passed deterministic filtering', async () => {
    prismaMocks.emailAlert.findMany.mockResolvedValue([
      { id: 'alert-1', description: 'Notify me about invoices' },
    ]);
    llmMocks.callObject.mockResolvedValue({
      object: {
        shouldReply: false,
        reason: 'Invoice is informational only',
        shouldNotify: true,
        matchedAlertId: 'alert-1',
        matchedAlertDescription: 'Notify me about invoices',
      },
    });

    const result = await new ReplyRouterAgent().evaluateRealtimeRouting(createInput(true));

    expect(promptMocks.readPromptFile).toHaveBeenCalledWith(
      'core-processing/replyRouterPrompt.md',
    );
    expect(llmMocks.callObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-router',
        op: 'reply.router',
      }),
    );
    expect(modelMocks.flashLite).not.toHaveBeenCalled();
    expect(result.replyDecision).toMatchObject({
      shouldReply: false,
      reason: 'Invoice is informational only',
      shouldNotify: true,
      matchedAlertId: 'alert-1',
    });
  });
});
