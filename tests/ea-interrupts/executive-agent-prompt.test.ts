import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readPromptFile } from '@/lib/prompts';
import {
  buildExecutiveAgentPrompt,
  buildPendingCalendarInstruction,
} from '@/lib/ai/agents/executive-agent/prompt';
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
      actionPackSummaryLines: ['calendar_mutation_pack: Calendar changes with confirmation-required previews.'],
      mcpToolSummaryLines: ['Notion Workspace: Search docs (read)'],
      mcpAvailableServerLines: ['Exa Search (exa): Exa Search: 3 read tools'],
      mcpDegradedSummaryLines: ['CRM Mirror: Search CRM unavailable (auth expired)'],
    });

    expect(prompt.systemPrompt).toBe(readPromptFile('whatsapp/executiveAgentPrompt.md'));
    expect(prompt.systemPrompt).toContain('Action-forward');
    expect(prompt.systemPrompt).toContain('Reminder awareness in normal conversation');
    expect(prompt.systemPrompt).toContain('Avoid sentence-final periods by default in short replies');
    expect(prompt.systemPrompt).toContain('confirming the draft, canceling it, revising it, or switching to a different topic');
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.messages[0]?.content).toContain('## Pending Calendar State');
    expect(prompt.messages[0]?.content).toContain('pendingId=pc-1');
    expect(prompt.messages[0]?.content).toContain('## Harness Reminders');
    expect(prompt.messages[0]?.content).toContain('only send the already-shown draft');
    expect(prompt.messages[0]?.content).toContain('## Available Action Packs');
    expect(prompt.messages[0]?.content).toContain('calendar_mutation_pack');
    expect(prompt.messages[0]?.content).toContain('## MCP Tools This Turn');
    expect(prompt.messages[0]?.content).toContain('Search docs');
    expect(prompt.messages[0]?.content).toContain('## Available MCP Server Packs');
    expect(prompt.messages[0]?.content).toContain('Exa Search');
    expect(prompt.messages[0]?.content).toContain('## MCP Degraded Tools');
    expect(prompt.messages[0]?.content).toContain('auth expired');
    expect(prompt.messages[0]?.content).toContain('## Current User Request');
    expect(prompt.messages[0]?.content).toContain('send it');
    expect(prompt.messages[0]?.content).not.toContain('\nUTC: ');
  });

  test('formats a compact structured pending calendar draft snapshot', () => {
    const instruction = buildPendingCalendarInstruction({
      pendingId: 'pc-42',
      status: 'PENDING',
      createdAt: new Date('2026-03-31T22:08:00.000Z'),
      expiresAt: new Date('2026-03-31T22:38:00.000Z'),
      fallbackTimeZone: 'America/Vancouver',
      payload: {
        userTimezone: 'America/Vancouver',
        userRequest: 'add that mario thing to calendar and pls set multiple reminders starting 2 days before',
        plan: {
          action: 'bundle',
          confidence: 0.97,
          requiresConfirmation: true,
          sendUpdates: 'none',
          createMeetLink: false,
          calendarId: 'home',
          userPreviewText: 'Ready to add "Interview with Mario Mendez (EvoTrux)" on Apr 7, 11 AM to 11:45 AM in Home',
          ops: [
            {
              kind: 'create',
              createMeetLink: false,
              eventDraft: {
                calendarId: 'home',
                summary: 'Interview with Mario Mendez (EvoTrux)',
                start: {
                  dateTime: '2026-04-07T11:00:00',
                  timeZone: 'America/Vancouver',
                },
                end: {
                  dateTime: '2026-04-07T11:45:00',
                  timeZone: 'America/Vancouver',
                },
                attendees: [
                  { email: 'mario@evotrux.com', displayName: 'Mario Mendez' },
                ],
                reminders: {
                  useDefault: false,
                  overrides: [
                    { method: 'popup', minutes: 2880 },
                    { method: 'popup', minutes: 1440 },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    expect(instruction).toContain('pendingDraft:');
    expect(instruction).toContain('pendingId: "pc-42"');
    expect(instruction).toContain('originalUserRequest: "add that mario thing to calendar and pls set multiple reminders starting 2 days before"');
    expect(instruction).toContain('defaultCalendarId: "home"');
    expect(instruction).toContain('previewText: "Ready to add');
    expect(instruction).toContain('ops:');
    expect(instruction).toContain('summary: "Interview with Mario Mendez (EvoTrux)"');
    expect(instruction).toContain('attendees: "Mario Mendez"');
    expect(instruction).toContain('reminders: "useDefault=false; overrides=popup:2880, popup:1440"');
  });

  test('formats prior conversation timestamps in the user timezone instead of raw UTC', async () => {
    const { prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({
      calendarTimezone: 'America/Los_Angeles',
    } as never);

    const input: ExecutiveAgentInput = {
      userId: 'user-1',
      userEmail: 'user@example.com',
      userRequest: 'so whats up with veetesh',
      conversationId: 'conv-1',
      channel: 'telegram',
      conversationHistory: [
        {
          id: 'msg-1',
          role: 'ASSISTANT',
          direction: 'OUTBOUND',
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
