export const MESSAGING_DEADLINE_MS = 120_000;
export const MESSAGING_TOOL_RESPONSE_BUFFER_MS = 3_500;
export const MESSAGING_FIRST_TOOL_MAX_BUDGET_MS = 30_000;
export const MESSAGING_SUBSEQUENT_TOOL_RESERVE_MS = 15_000;
export const MESSAGING_MIN_SUBAGENT_BUDGET_MS = 8_000;
export const PLAN_CALENDAR_CHANGE_MIN_BUDGET_MS = 35_000;
export const CALENDAR_SEARCH_MIN_BUDGET_MS = 35_000;
export const MESSAGING_MAX_STEPS = 6;
/** Total tool calls per run. Per-tool limits in MESSAGING_TOOL_BUDGETS_BASE must stay below this. */
export const MESSAGING_MAX_TOOL_CALLS_TOTAL = 70;
export const PENDING_CALENDAR_CHANGE_TTL_MS = 10 * 60 * 1000;

/** Per-tool call limits. Sum of used tools is also capped by MESSAGING_MAX_TOOL_CALLS_TOTAL. */
export const MESSAGING_TOOL_BUDGETS_BASE: Record<string, number> = {
  search_inbox_context: 4,
  search_calendar: 2,
  check_calendar: 1,
  search_memory: 3,
  append_to_supermemory: 3,
  add_email_alert: 10,
  remove_email_alert: 10,
  list_email_alerts: 2,
  plan_calendar_change: 2,
  commit_calendar_change: 1,
  add_reminder: 50,
  list_reminders: 2,
  snooze_reminder: 50,
  dismiss_reminder: 50,
  cancel_reminder: 50,
  send_email: 1,
  send_progress_update: 3,
};

export const MESSAGING_INBOX_CALL_LIMITS: Record<'quick' | 'deep', number> = {
  quick: 2,
  deep: 2,
};
