import { describe, expect, test } from 'vitest';
import { ProgressEmitter } from '@/lib/ai/progressEmitter';
import { wrapToolsWithTimingMetadata } from '@/lib/ai/agents/executive-agent/helpers';
import {
  createSendProgressUpdateTool,
  createSendProgressUpdateToolFromEmitter,
} from '@/lib/ai/tools/sendProgressUpdate';

type DeferredToolResult = {
  success?: boolean;
  status?: string;
  error?: string;
  message?: string;
};

type ExecutableTool<TArgs, TResult> = {
  execute: (args: TArgs) => Promise<TResult>;
};

function getExecutableTool<TArgs, TResult>(tool: unknown): ExecutableTool<TArgs, TResult> {
  expect(tool).toBeTruthy();
  expect(typeof (tool as { execute?: unknown }).execute).toBe('function');
  return tool as ExecutableTool<TArgs, TResult>;
}

function buildProgressContext(params?: { canEmitProgress?: () => boolean }) {
  const sentTexts: string[] = [];
  const persistedTexts: string[] = [];

  return {
    context: {
      channel: 'twilio' as const,
      requestId: 'req-progress',
      conversationId: 'conv-progress',
      canEmitProgress: params?.canEmitProgress,
      sendMessage: async (text: string) => {
        sentTexts.push(text);
        return { externalId: `msg-${sentTexts.length}` };
      },
      persistMessage: async ({ content }: { content: string }) => {
        persistedTexts.push(content);
      },
    },
    sentTexts,
    persistedTexts,
  };
}

describe('Side-effect tool guards', () => {
  test('stale side-effect tool calls are deferred before execution', async () => {
    let sideEffectCalls = 0;

    const wrapped = wrapToolsWithTimingMetadata({
      tools: {
        add_email_alert: {
          execute: async () => {
            sideEffectCalls += 1;
            return { success: true };
          },
        },
      },
      agentStartedAt: Date.now(),
      timeLeftMs: () => 10_000,
      getLastProgressSentAt: () => 0,
      setLastProgressSentAt: () => {},
      isRunCurrent: async () => false,
    });

    const tool = getExecutableTool<Record<string, never>, DeferredToolResult>(wrapped.add_email_alert);
    const result = await tool.execute({});

    expect(result.status).toBe('deferred');
    expect(result.error).toBe('superseded_by_newer_message');
    expect(result.success).toBe(false);
    expect(sideEffectCalls).toBe(0);
  });

  test('pending steering defers commit-boundary side-effect tools', async () => {
    let sendEmailCalls = 0;
    let commitCalendarCalls = 0;

    const wrapped = wrapToolsWithTimingMetadata({
      tools: {
        send_email: {
          execute: async () => {
            sendEmailCalls += 1;
            return { success: true };
          },
        },
        commit_calendar_change: {
          execute: async () => {
            commitCalendarCalls += 1;
            return { ok: true };
          },
        },
      },
      agentStartedAt: Date.now(),
      timeLeftMs: () => 10_000,
      getLastProgressSentAt: () => 0,
      setLastProgressSentAt: () => {},
      isRunCurrent: async () => true,
      hasPendingSteer: async () => true,
    });

    const sendEmailTool = getExecutableTool<Record<string, never>, Record<string, unknown>>(wrapped.send_email);
    const sendEmailResult = await sendEmailTool.execute({});
    expect(sendEmailResult.status).toBe('deferred');
    expect(sendEmailResult.error).toBe('pending_steer_event');
    expect(sendEmailResult.success).toBe(false);

    const commitCalendarTool = getExecutableTool<Record<string, never>, Record<string, unknown>>(wrapped.commit_calendar_change);
    const commitCalendarResult = await commitCalendarTool.execute({});
    expect(commitCalendarResult.status).toBe('deferred');
    expect(commitCalendarResult.error).toBe('pending_steer_event');
    expect(commitCalendarResult.ok).toBe(false);

    expect(sendEmailCalls).toBe(0);
    expect(commitCalendarCalls).toBe(0);
  });
});

describe('Progress update tool', () => {
  test('progress update is suppressed while burst is unstable', async () => {
    let sentCalls = 0;
    let persistedCalls = 0;

    const tool = createSendProgressUpdateTool({
      channel: 'twilio',
      requestId: 'req-unstable',
      conversationId: 'conv-unstable',
      canEmitProgress: () => false,
      sendMessage: async () => {
        sentCalls += 1;
        return { externalId: 'msg-1' };
      },
      persistMessage: async () => {
        persistedCalls += 1;
      },
    });

    const result = await tool.execute({ kind: 'ack', text: 'Checking now' });

    expect(result.sent).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.droppedReason).toBe('unstable_burst');
    expect(sentCalls).toBe(0);
    expect(persistedCalls).toBe(0);
  });

  test('progress update still emits in stable long run', async () => {
    let sentCalls = 0;
    let persistedCalls = 0;

    const tool = createSendProgressUpdateTool({
      channel: 'twilio',
      requestId: 'req-stable',
      conversationId: 'conv-stable',
      canEmitProgress: () => true,
      sendMessage: async () => {
        sentCalls += 1;
        return { externalId: 'msg-2' };
      },
      persistMessage: async () => {
        persistedCalls += 1;
      },
    });

    const result = await tool.execute({ kind: 'ack', text: 'Still working on this' });

    expect(result.sent).toBe(true);
    expect(result.persisted).toBe(true);
    expect(result.droppedReason).toBeUndefined();
    expect(sentCalls).toBe(1);
    expect(persistedCalls).toBe(1);
  });

  test('emitter-backed progress tool preserves standalone semantics', async () => {
    const standaloneState = buildProgressContext({ canEmitProgress: () => true });
    const delegatedState = buildProgressContext({ canEmitProgress: () => true });

    const standalone = createSendProgressUpdateTool(standaloneState.context);
    const delegated = createSendProgressUpdateToolFromEmitter(
      new ProgressEmitter(delegatedState.context, {
        maxEmissions: 2,
        minIntervalMs: 1_500,
        longTaskBonusAfterMs: 6_000,
        maxTextLength: 200,
        harnessFirstDelayMs: 4_500,
        harnessMinToolCalls: 1,
      }),
      delegatedState.context.channel,
      delegatedState.context.requestId,
    );

    const args = { kind: 'ack' as const, text: 'Still working on this' };
    const standaloneResult = await standalone.execute(args);
    const delegatedResult = await delegated.execute(args);

    expect(delegated.description).toBe(standalone.description);
    expect(delegated.inputSchema.safeParse(args).success).toBe(true);
    expect(delegatedResult).toEqual(standaloneResult);
    expect(delegatedState.sentTexts).toEqual(standaloneState.sentTexts);
    expect(delegatedState.persistedTexts).toEqual(standaloneState.persistedTexts);
  });

  test('emitter-backed progress tool still respects burst stability', async () => {
    const state = buildProgressContext({ canEmitProgress: () => false });
    const delegated = createSendProgressUpdateToolFromEmitter(
      new ProgressEmitter(state.context, {
        maxEmissions: 2,
        minIntervalMs: 1_500,
        longTaskBonusAfterMs: 6_000,
        maxTextLength: 200,
      }),
      state.context.channel,
      state.context.requestId,
    );

    const result = await delegated.execute({ kind: 'ack', text: 'Checking now' });

    expect(result.sent).toBe(false);
    expect(result.droppedReason).toBe('unstable_burst');
    expect(state.sentTexts).toEqual([]);
    expect(state.persistedTexts).toEqual([]);
  });
});
