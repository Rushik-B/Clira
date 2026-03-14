import type {
  ExecutiveTurnFeatures,
  ToolPackId,
} from './types';

export const EXECUTIVE_AGENT_PACK_VERSION = 'ea-packs-v2';

export const EXECUTIVE_TOOL_NAMES = [
  'search_memory',
  'append_to_supermemory',
  'send_progress_update',
  'search_inbox_context',
  'list_inbox_emails',
  'read_email_pdf_attachment',
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
  'get_reply_preferences',
  'manage_reply_preferences',
  'send_email',
] as const;

export type ExecutiveToolName = (typeof EXECUTIVE_TOOL_NAMES)[number];

const RAW_TOOL_PACKS: Record<ToolPackId, readonly ExecutiveToolName[]> = {
  core_recall_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'list_inbox_emails',
  ],
  inbox_context_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'search_inbox_context',
    'list_inbox_emails',
    'read_email_pdf_attachment',
    'search_calendar',
  ],
  calendar_query_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'search_calendar',
    'check_calendar',
    'search_inbox_context',
    'list_inbox_emails',
    'read_email_pdf_attachment',
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
  settings_mutation_pack: [
    'search_memory',
    'send_progress_update',
    'get_reply_preferences',
    'manage_reply_preferences',
  ],
  email_send_pack: [
    'search_memory',
    'append_to_supermemory',
    'send_progress_update',
    'search_inbox_context',
    'read_email_pdf_attachment',
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
  settings_mutation_pack: sortToolNames(RAW_TOOL_PACKS.settings_mutation_pack),
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

function isResolutionIntent(features: ExecutiveTurnFeatures): boolean {
  return features.pendingCalendarConfirmIntent || features.pendingCalendarCancelIntent;
}

export function buildPackToolAllowlist(
  packId: ToolPackId,
  features: ExecutiveTurnFeatures,
): readonly ExecutiveToolName[] {
  const allowlist = new Set<ExecutiveToolName>(getToolPackToolNames(packId));
  const resolutionIntent = isResolutionIntent(features);

  if (!features.explicitSendApproval || !features.draftCandidatePresent) {
    allowlist.delete('send_email');
  }

  // commit_calendar_change is available whenever a pending change exists and the user
  // is not explicitly trying to modify the plan. The tool's own decision parameter
  // ("confirm" | "cancel") is the real safety gate — the model must choose explicitly.
  if (!features.pendingCalendarChangePresent || features.pendingCalendarModifyIntent) {
    allowlist.delete('commit_calendar_change');
  }

  // Remove plan_calendar_change unless:
  // - regex detected mutation intent, OR
  // - pending calendar change is being modified, OR
  // - the selector explicitly chose calendar_mutation_pack (LLM detected intent from context)
  if (
    !features.calendarMutationIntent &&
    !features.pendingCalendarModifyIntent &&
    packId !== 'calendar_mutation_pack'
  ) {
    allowlist.delete('plan_calendar_change');
  }

  // Don't re-plan when user is confirming or cancelling an existing pending change.
  if (features.pendingCalendarChangePresent && resolutionIntent) {
    allowlist.delete('plan_calendar_change');
  }

  return [...allowlist].sort();
}

export function buildPackToolAllowlistForSelection(
  packIds: readonly ToolPackId[],
  features: ExecutiveTurnFeatures,
): readonly ExecutiveToolName[] {
  const allowlist = new Set<ExecutiveToolName>();

  for (const packId of packIds) {
    for (const toolName of buildPackToolAllowlist(packId, features)) {
      allowlist.add(toolName);
    }
  }

  return [...allowlist].sort();
}
