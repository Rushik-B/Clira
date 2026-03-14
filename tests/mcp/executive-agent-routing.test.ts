import { describe, expect, test } from 'vitest';
import { resolveExecutiveMcpCapabilityIntents } from '@/lib/ai/agents/executive-agent/mcp/capabilityResolver';
import type { ExecutiveTurnFeatures } from '@/lib/ai/agents/executive-agent/types';

function buildFeatures(overrides?: Partial<ExecutiveTurnFeatures>): ExecutiveTurnFeatures {
  return {
    explicitSendApproval: false,
    draftCandidatePresent: false,
    pendingCalendarChangePresent: false,
    calendarMutationIntent: false,
    calendarQueryIntent: false,
    workloadOverviewIntent: false,
    reminderIntent: false,
    alertIntent: false,
    channel: 'twilio',
    hasRecentPendingCalendarPreview: false,
    pendingCalendarConfirmIntent: false,
    pendingCalendarCancelIntent: false,
    pendingCalendarModifyIntent: false,
    draftCandidateReason: null,
    ...overrides,
  };
}

describe('Executive MCP capability routing', () => {
  test('maps inbox context turns to docs, storage, and CRM read intents', () => {
    const intents = resolveExecutiveMcpCapabilityIntents({
      packIds: ['inbox_context_pack'],
      userRequest: 'Find the notion spec, the attached pdf, and the HubSpot account for Acme.',
      turnFeatures: buildFeatures(),
    });

    expect(intents).toEqual(['crm_lookup', 'docs_read', 'storage_read']);
  });

  test('maps calendar query turns to external calendar read', () => {
    const intents = resolveExecutiveMcpCapabilityIntents({
      packIds: ['calendar_query_pack'],
      userRequest: 'What does my calendar look like tomorrow afternoon?',
      turnFeatures: buildFeatures(),
    });

    expect(intents).toEqual(['calendar_external_read']);
  });

  test('does not add arbitrary MCP intents for reminders or settings turns', () => {
    const intents = resolveExecutiveMcpCapabilityIntents({
      packIds: ['reminder_alert_pack', 'settings_mutation_pack'],
      userRequest: 'Remind me tomorrow and keep my replies casual.',
      turnFeatures: buildFeatures({
        reminderIntent: true,
      }),
    });

    expect(intents).toEqual([]);
  });
});
