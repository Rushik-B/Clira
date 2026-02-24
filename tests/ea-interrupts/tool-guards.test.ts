import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wrapToolsWithTimingMetadata } from '@/lib/ai/agents/executive-agent/helpers';
import { createSendProgressUpdateTool } from '@/lib/ai/tools/sendProgressUpdate';

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
  assert.ok(tool && typeof tool === 'object');
  const executeCandidate = (tool as { execute?: unknown }).execute;
  assert.equal(typeof executeCandidate, 'function');
  return tool as ExecutableTool<TArgs, TResult>;
}

test('scenario 8: stale side-effect tool calls are deferred before execution', async () => {
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

  assert.equal(result.status, 'deferred');
  assert.equal(result.error, 'superseded_by_newer_message');
  assert.equal(result.success, false);
  assert.equal(sideEffectCalls, 0);
});

test('scenario 8: pending steering defers commit-boundary side-effect tools', async () => {
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
  assert.equal(sendEmailResult.status, 'deferred');
  assert.equal(sendEmailResult.error, 'pending_steer_event');
  assert.equal(sendEmailResult.success, false);

  const commitCalendarTool = getExecutableTool<Record<string, never>, Record<string, unknown>>(wrapped.commit_calendar_change);
  const commitCalendarResult = await commitCalendarTool.execute({});
  assert.equal(commitCalendarResult.status, 'deferred');
  assert.equal(commitCalendarResult.error, 'pending_steer_event');
  assert.equal(commitCalendarResult.ok, false);

  assert.equal(sendEmailCalls, 0);
  assert.equal(commitCalendarCalls, 0);
});

test('scenario 9: progress update is suppressed while burst is unstable', async () => {
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

  assert.equal(result.sent, false);
  assert.equal(result.persisted, false);
  assert.equal(result.droppedReason, 'unstable_burst');
  assert.equal(sentCalls, 0);
  assert.equal(persistedCalls, 0);
});

test('scenario 9: progress update still emits in stable long run', async () => {
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

  assert.equal(result.sent, true);
  assert.equal(result.persisted, true);
  assert.equal(result.droppedReason, undefined);
  assert.equal(sentCalls, 1);
  assert.equal(persistedCalls, 1);
});
