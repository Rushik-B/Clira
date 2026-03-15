import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readPromptFile } from '@/lib/prompts';
import { buildExecutiveAgentPrompt } from '@/lib/ai/agents/executive-agent/prompt';
import type { ExecutiveAgentInput } from '@/lib/ai/agents/executive-agent/types';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/supermemory/client', () => ({
  isSupermemoryConfigured: vi.fn(() => false),
}));

describe('Executive agent prompt', () => {
  beforeEach(async () => {
    const { prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue(null);
  });

  test('uses the markdown prompt as the sole system prompt and injects runtime reminders into the latest user message', async () => {
    const input: ExecutiveAgentInput = {
      userId: 'user-1',
      userEmail: 'user@example.com',
      userRequest: 'send it',
      conversationId: 'conv-1',
      channel: 'twilio',
      conversationHistory: [],
      runContext: {
        runId: 'run-1',
        burstId: 'burst-1',
        classifierDecision: 'followup',
        droppedSummary: [],
        isRunCurrent: async () => true,
        isBurstStable: () => true,
      },
    };

    const prompt = await buildExecutiveAgentPrompt(input, 'twilio', {
      pendingCalendarInstruction: 'Active pending calendar change exists (pendingId=pc-1).',
      harnessReminders: ['User approval is present; only send the already-shown draft.'],
      mcpCapabilitySummaryLines: ['Notion Workspace: docs_read via Search docs'],
      mcpDegradedSummaryLines: ['CRM Mirror: crm_lookup unavailable (auth expired)'],
    });

    expect(prompt.systemPrompt).toBe(readPromptFile('whatsapp/executiveAgentPrompt.md'));
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.messages[0]?.content).toContain('## Pending Calendar State');
    expect(prompt.messages[0]?.content).toContain('pendingId=pc-1');
    expect(prompt.messages[0]?.content).toContain('## Harness Reminders');
    expect(prompt.messages[0]?.content).toContain('only send the already-shown draft');
    expect(prompt.messages[0]?.content).toContain('## MCP Capabilities This Turn');
    expect(prompt.messages[0]?.content).toContain('Search docs');
    expect(prompt.messages[0]?.content).toContain('## MCP Degraded Capabilities');
    expect(prompt.messages[0]?.content).toContain('auth expired');
    expect(prompt.messages[0]?.content).toContain('## Current User Request');
    expect(prompt.messages[0]?.content).toContain('send it');
    expect(prompt.messages[0]?.content).not.toContain('\nUTC: ');
  });

  test('formats prior conversation timestamps in the user timezone instead of raw UTC', async () => {
    const { prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({
      calendarTimezone: 'America/Los_Angeles',
    });

    const input: ExecutiveAgentInput = {
      userId: 'user-1',
      userEmail: 'user@example.com',
      userRequest: 'so whats up with veetesh',
      conversationId: 'conv-1',
      channel: 'telegram',
      conversationHistory: [
        {
          role: 'ASSISTANT',
          content: 'Sent. See you at BierCraft on Wednesday!',
          metadata: null,
          createdAt: new Date('2026-03-15T02:53:37.903Z'),
        },
      ],
      runContext: {
        runId: 'run-1',
        burstId: 'burst-1',
        classifierDecision: 'followup',
        droppedSummary: [],
        isRunCurrent: async () => true,
        isBurstStable: () => true,
      },
    };

    const prompt = await buildExecutiveAgentPrompt(input, 'telegram');

    expect(prompt.messages).toHaveLength(2);
    expect(prompt.messages[0]?.content).toContain('[Timestamp] Mar 14, 2026, 07:53 PM PDT');
    expect(prompt.messages[0]?.content).not.toContain('2026-03-15T02:53:37.903Z');
  });
});
