import type {
  ExecutiveTurnFeatures,
  ToolPackId,
} from './types';

export const EXECUTIVE_AGENT_PACK_VERSION = 'ea-packs-v1';

export const EXECUTIVE_TOOL_NAMES = [
  'search_memory',
  'append_to_supermemory',
  'send_progress_update',
  'search_inbox_context',
  'search_calendar',
  'check_calendar',
  'plan_calendar_change',
  'commit_calendar_change',
  'add_email_alert',
  'remove_email_alert',
  'list_email_alerts',
  'add_reminder',
  'list_reminders',
  'snooze_reminder',
  'dismiss_reminder',
  'cancel_reminder',
  'send_email',
] as const;

export type ExecutiveToolName = (typeof EXECUTIVE_TOOL_NAMES)[number];

const RAW_TOOL_PACKS: Record<ToolPackId, readonly ExecutiveToolName[]> = {
  core_recall_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
  ],
  inbox_context_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'search_inbox_context',
    'search_calendar',
  ],
  calendar_query_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'search_calendar',
    'check_calendar',
    'search_inbox_context',
  ],
  calendar_mutation_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'search_calendar',
    'check_calendar',
    'plan_calendar_change',
    'commit_calendar_change',
  ],
  reminder_alert_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'add_email_alert',
    'remove_email_alert',
    'list_email_alerts',
    'add_reminder',
    'list_reminders',
    'snooze_reminder',
    'dismiss_reminder',
    'cancel_reminder',
  ],
  email_send_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'search_inbox_context',
    'send_email',
  ],
};

function sortToolNames(
  toolNames: readonly ExecutiveToolName[],
): readonly ExecutiveToolName[] {
  return [...toolNames].sort();
}

export const EXECUTIVE_TOOL_PACKS = {
  core_recall_pack: sortToolNames(RAW_TOOL_PACKS.core_recall_pack),
  inbox_context_pack: sortToolNames(RAW_TOOL_PACKS.inbox_context_pack),
  calendar_query_pack: sortToolNames(RAW_TOOL_PACKS.calendar_query_pack),
  calendar_mutation_pack: sortToolNames(RAW_TOOL_PACKS.calendar_mutation_pack),
  reminder_alert_pack: sortToolNames(RAW_TOOL_PACKS.reminder_alert_pack),
  email_send_pack: sortToolNames(RAW_TOOL_PACKS.email_send_pack),
} satisfies Record<ToolPackId, readonly ExecutiveToolName[]>;

export function getToolPackToolNames(packId: ToolPackId): readonly ExecutiveToolName[] {
  return EXECUTIVE_TOOL_PACKS[packId];
}

export function isReadOnlyPack(packId: ToolPackId): boolean {
  return (
    packId === 'core_recall_pack' ||
    packId === 'inbox_context_pack' ||
    packId === 'calendar_query_pack'
  );
}

export function buildPackToolAllowlist(
  packId: ToolPackId,
  features: ExecutiveTurnFeatures,
): readonly ExecutiveToolName[] {
  const allowlist = new Set<ExecutiveToolName>(getToolPackToolNames(packId));

  if (!features.explicitSendApproval || !features.draftCandidatePresent) {
    allowlist.delete('send_email');
  }

  if (!features.pendingCalendarChangePresent) {
    allowlist.delete('commit_calendar_change');
  }

  if (
    !features.calendarMutationIntent &&
    !features.pendingCalendarModifyIntent
  ) {
    allowlist.delete('plan_calendar_change');
  }

  if (
    features.pendingCalendarChangePresent &&
    (features.pendingCalendarConfirmIntent || features.pendingCalendarCancelIntent)
  ) {
    allowlist.delete('plan_calendar_change');
  }

  if (
    features.pendingCalendarChangePresent &&
    features.pendingCalendarModifyIntent
  ) {
    allowlist.delete('commit_calendar_change');
  }

  return [...allowlist].sort();
}
