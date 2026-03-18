import type {
  ExecutiveTurnFeatures,
  ToolPackId,
} from './types';

export const EXECUTIVE_AGENT_PACK_VERSION = 'ea-packs-v3';

export const EXECUTIVE_TOOL_NAMES = [
  'search_memory',
  'append_to_supermemory',
  'send_progress_update',
  'search_inbox_context',
  'list_inbox_emails',
  'read_email_attachment_content',
  'read_email_pdf_attachment',
  'search_calendar',
  'check_calendar',
  'get_reply_preferences',
  'plan_calendar_change',
  'commit_calendar_change',
  'add_email_alert',
  'remove_email_alert',
  'list_email_alerts',
  'deliver_content_reference',
  'add_reminder',
  'list_reminders',
  'snooze_reminder',
  'dismiss_reminder',
  'cancel_reminder',
  'manage_reply_preferences',
  'send_email',
] as const;

export type ExecutiveToolName = (typeof EXECUTIVE_TOOL_NAMES)[number];

export const SAFE_CONTEXT_PACK_TOOLS = [
  'search_memory',
  'append_to_supermemory',
  'send_progress_update',
  'search_inbox_context',
  'list_inbox_emails',
  'read_email_attachment_content',
  'read_email_pdf_attachment',
  'search_calendar',
  'check_calendar',
  'get_reply_preferences',
] as const satisfies readonly ExecutiveToolName[];

const ACTION_PACK_TOOLS = {
  calendar_mutation_pack: [
    'plan_calendar_change',
    'commit_calendar_change',
  ],
  reminder_alert_pack: [
    'add_email_alert',
    'remove_email_alert',
    'list_email_alerts',
    'add_reminder',
    'list_reminders',
    'snooze_reminder',
    'dismiss_reminder',
    'cancel_reminder',
  ],
  media_delivery_pack: ['deliver_content_reference'],
  settings_mutation_pack: ['manage_reply_preferences'],
  email_send_pack: ['send_email'],
} as const satisfies Record<
  Exclude<ToolPackId, 'safe_context_pack'>,
  readonly ExecutiveToolName[]
>;

const RAW_TOOL_PACKS: Record<ToolPackId, readonly ExecutiveToolName[]> = {
  safe_context_pack: SAFE_CONTEXT_PACK_TOOLS,
  ...ACTION_PACK_TOOLS,
};

export const EXECUTIVE_TOOL_PACKS = RAW_TOOL_PACKS;

export const EXECUTIVE_PACK_ORDER = [
  'safe_context_pack',
  'calendar_mutation_pack',
  'reminder_alert_pack',
  'media_delivery_pack',
  'settings_mutation_pack',
  'email_send_pack',
] as const satisfies readonly ToolPackId[];

const REQUESTABLE_ACTION_PACK_ORDER = [
  'calendar_mutation_pack',
  'reminder_alert_pack',
  'media_delivery_pack',
  'settings_mutation_pack',
  'email_send_pack',
] as const satisfies readonly Exclude<ToolPackId, 'safe_context_pack'>[];

const ACTION_PACK_REQUEST_SUMMARIES: Record<
  Exclude<ToolPackId, 'safe_context_pack'>,
  string
> = {
  calendar_mutation_pack:
    'Calendar changes: plan or confirm create/update/delete calendar actions. Commit only works when a pending calendar change exists.',
  reminder_alert_pack:
    'Reminders and alerts: create, list, snooze, dismiss, cancel, and manage email alerts.',
  media_delivery_pack:
    'Media delivery: send a previously returned content reference to the user on Telegram as the original file.',
  settings_mutation_pack:
    'Reply preference updates: store standing planner/style instructions and sender-specific reply rules.',
  email_send_pack:
    'Email send: send the already-approved draft only when explicit approval and a valid draft candidate exist.',
};

const TOOL_TO_PACK_ID = new Map<ExecutiveToolName, ToolPackId>();
for (const packId of EXECUTIVE_PACK_ORDER) {
  for (const toolName of EXECUTIVE_TOOL_PACKS[packId]) {
    TOOL_TO_PACK_ID.set(toolName, packId);
  }
}

export function getToolPackToolNames(packId: ToolPackId): readonly ExecutiveToolName[] {
  return EXECUTIVE_TOOL_PACKS[packId];
}

export function getOwningPackForToolName(
  toolName: string,
): ToolPackId | null {
  return (TOOL_TO_PACK_ID.get(toolName as ExecutiveToolName) ?? null);
}

export function isReadOnlyPack(packId: ToolPackId): boolean {
  return packId === 'safe_context_pack';
}

function isPendingCalendarResolutionIntent(features: ExecutiveTurnFeatures): boolean {
  return features.pendingCalendarConfirmIntent || features.pendingCalendarCancelIntent;
}

export function listRequestableActionPackIds(
  features: ExecutiveTurnFeatures,
): Exclude<ToolPackId, 'safe_context_pack'>[] {
  return REQUESTABLE_ACTION_PACK_ORDER.filter((packId) => {
    if (packId === 'email_send_pack') {
      return features.explicitSendApproval && features.draftCandidatePresent;
    }

    return true;
  });
}

export function getActionPackRequestSummary(
  packId: Exclude<ToolPackId, 'safe_context_pack'>,
): string {
  return ACTION_PACK_REQUEST_SUMMARIES[packId];
}

export function buildPackToolAllowlist(
  packId: ToolPackId,
  features: ExecutiveTurnFeatures,
): readonly ExecutiveToolName[] {
  const allowlist = new Set<ExecutiveToolName>(getToolPackToolNames(packId));

  if (packId === 'email_send_pack') {
    if (!features.explicitSendApproval || !features.draftCandidatePresent) {
      allowlist.delete('send_email');
    }
  }

  if (packId === 'calendar_mutation_pack') {
    const resolutionIntent = isPendingCalendarResolutionIntent(features);

    if (!features.pendingCalendarChangePresent || !resolutionIntent) {
      allowlist.delete('commit_calendar_change');
    }

    if (features.pendingCalendarChangePresent && resolutionIntent) {
      allowlist.delete('plan_calendar_change');
    }
  }

  return getToolPackToolNames(packId).filter((toolName) => allowlist.has(toolName));
}

function getOrderedPackIdsForSelection(packIds: readonly ToolPackId[]): ToolPackId[] {
  const packSet = new Set(packIds);
  const ordered: ToolPackId[] = [];

  for (const packId of EXECUTIVE_PACK_ORDER) {
    if (packSet.has(packId)) {
      ordered.push(packId);
    }
  }

  return ordered;
}

export function buildPackToolAllowlistForSelection(
  packIds: readonly ToolPackId[],
  features: ExecutiveTurnFeatures,
): readonly ExecutiveToolName[] {
  const allowlist = new Set<ExecutiveToolName>();

  for (const packId of getOrderedPackIdsForSelection(packIds)) {
    for (const toolName of buildPackToolAllowlist(packId, features)) {
      allowlist.add(toolName);
    }
  }

  return EXECUTIVE_TOOL_NAMES.filter((toolName) => allowlist.has(toolName));
}
