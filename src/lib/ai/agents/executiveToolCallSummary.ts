const MAX_SUMMARY_CHARS = 300;
const MAX_EVENT_NAME_CHARS = 40;
const MAX_EVENT_LIST_ITEMS = 25;

function truncateText(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getToolName(record: Record<string, unknown>): string | null {
  const candidate = record.toolName ?? record.name ?? record.tool;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractNameList(
  value: unknown,
  fieldNames: string[],
  maxItems = MAX_EVENT_LIST_ITEMS,
  maxChars = MAX_EVENT_NAME_CHARS,
): string[] {
  if (!Array.isArray(value)) return [];

  const names: string[] = [];
  for (const item of value) {
    if (names.length >= maxItems) break;
    const record = asRecord(item);
    if (!record) continue;

    let name: string | null = null;
    for (const fieldName of fieldNames) {
      name = getStringValue(record[fieldName]);
      if (name) break;
    }
    if (!name) continue;
    names.push(truncateText(name, maxChars));
  }

  return names;
}

function formatList(names: string[], separator: string): string {
  return `[${names.join(separator)}]`;
}

function summarizeToolResult(toolName: string, result: unknown): string | null {
  const output = asRecord(result);
  if (!output) return null;

  let summary: string | null = null;

  switch (toolName) {
    case 'search_calendar': {
      const meta = asRecord(output.meta);
      const events = Array.isArray(output.events) ? output.events : [];
      const matches =
        getNumberValue(meta?.matchesFound) ??
        getNumberValue(output.matchesFound) ??
        events.length;
      const eventNames = extractNameList(events, ['name', 'summary', 'title']);
      const searchSummary =
        getStringValue(output.summary) ??
        getStringValue(output.insights) ??
        getStringValue(output.reasoning) ??
        getStringValue(output.message);
      summary = `search_calendar: ${matches} match(es) ${formatList(eventNames, ', ')}`;
      if (searchSummary) summary += ` — ${searchSummary}`;
      break;
    }
    case 'check_calendar': {
      const freeSlots = Array.isArray(output.freeSlots) ? output.freeSlots.length : 0;
      const busyness =
        getStringValue(output.busynessLevel) ??
        getStringValue(output.busyness) ??
        'unknown';
      const recommendation =
        getStringValue(output.recommendation) ??
        getStringValue(output.message);
      summary = `check_calendar: ${busyness}, ${freeSlots} free slot(s)`;
      if (recommendation) summary += ` — ${recommendation}`;
      break;
    }
    case 'plan_calendar_change': {
      const plan = asRecord(output.plan);
      const pendingChange = asRecord(output.pendingChange);
      const action =
        getStringValue(plan?.action) ??
        getStringValue(pendingChange?.action) ??
        getStringValue(output.action) ??
        'pending';
      const pendingId =
        getStringValue(pendingChange?.pendingId) ??
        getStringValue(output.pendingId) ??
        'unknown';
      const preview =
        getStringValue(output.previewText) ??
        getStringValue(plan?.userPreviewText) ??
        getStringValue(output.message) ??
        getStringValue(output.note);
      summary = `plan_calendar_change: ${action} pendingId=${pendingId}`;
      if (preview) summary += ` — ${preview}`;
      break;
    }
    case 'commit_calendar_change': {
      const status =
        getStringValue(output.status) ??
        (output.ok === true ? 'ok' : output.ok === false ? 'failed' : 'unknown');
      const created = getNumberValue(output.createdCount);
      const updated = getNumberValue(output.updatedCount);
      const deleted = getNumberValue(output.deletedCount);
      const failed = getNumberValue(output.failedCount);
      const metrics: string[] = [];
      if (created !== null) metrics.push(`created=${created}`);
      if (updated !== null) metrics.push(`updated=${updated}`);
      if (deleted !== null) metrics.push(`deleted=${deleted}`);
      if (failed !== null) metrics.push(`failed=${failed}`);
      const message = getStringValue(output.message);
      summary = `commit_calendar_change: ${status}${metrics.length > 0 ? ` (${metrics.join(', ')})` : ''}`;
      if (message) summary += ` — ${message}`;
      break;
    }
    case 'search_inbox_context': {
      const action = getStringValue(output.action) ?? 'find';
      const matches = Array.isArray(output.matches) ? output.matches.length : getNumberValue(output.count) ?? 0;
      const coverage = asRecord(output.coverage);
      const scanned =
        getNumberValue(coverage?.messagesScanned) ??
        getNumberValue(coverage?.threadsScanned) ??
        0;
      const confidence = getStringValue(output.confidence) ?? 'unknown';
      summary = `search_inbox_context(${action}): ${matches} result(s), ${scanned} scanned, confidence=${confidence}`;
      break;
    }
    case 'search_memory': {
      const memories = Array.isArray(output.memories) ? output.memories : [];
      const count = getNumberValue(output.count) ?? memories.length;
      const snippets = extractNameList(memories, ['content'], 5, 60);
      summary = `search_memory: ${count} result(s) ${formatList(snippets, '; ')}`;
      break;
    }
    case 'append_to_supermemory': {
      if (output.stored === true) {
        summary = `memory stored (${getStringValue(output.customId) ?? 'unknown'})`;
      } else {
        summary = 'memory store failed';
      }
      break;
    }
    case 'add_reminder': {
      const message = getStringValue(output.message) ?? 'Reminder created';
      const scheduledAt =
        getStringValue(output.scheduledAtLocal) ??
        getStringValue(output.scheduledAt) ??
        'unknown time';
      summary = `add_reminder: ${message} at ${scheduledAt}`;
      break;
    }
    case 'list_reminders': {
      const reminders = Array.isArray(output.reminders) ? output.reminders : [];
      const count = getNumberValue(output.count) ?? reminders.length;
      const titles = extractNameList(reminders, ['title']);
      summary = `list_reminders: ${count} reminder(s) ${formatList(titles, ', ')}`;
      break;
    }
    case 'snooze_reminder': {
      const snoozeUntil =
        getStringValue(output.snoozedUntilLocal) ??
        getStringValue(output.snoozedUntil) ??
        'unknown time';
      summary = `snooze_reminder: snoozed until ${snoozeUntil}`;
      break;
    }
    case 'dismiss_reminder': {
      const status =
        getStringValue(output.status) ??
        (output.success === true ? 'dismissed' : 'failed');
      summary = `dismiss_reminder: ${status}`;
      break;
    }
    case 'cancel_reminder': {
      const status =
        getStringValue(output.status) ??
        (output.success === true ? 'cancelled' : 'failed');
      summary = `cancel_reminder: ${status}`;
      break;
    }
    case 'add_email_alert': {
      if (output.success === true) {
        const id = getStringValue(output.alertId) ?? 'unknown';
        const description =
          getStringValue(output.description) ??
          getStringValue(output.message);
        summary = `add_email_alert: created (${id})`;
        if (description) summary += ` — ${description}`;
      } else {
        summary = `add_email_alert: failed${getStringValue(output.message) ? ` — ${getStringValue(output.message)}` : ''}`;
      }
      break;
    }
    case 'update_email_alert': {
      if (output.success === true) {
        const id = getStringValue(output.alertId) ?? 'unknown';
        const description =
          getStringValue(output.description) ??
          getStringValue(output.message);
        summary = `update_email_alert: updated (${id})`;
        if (description) summary += ` — ${description}`;
      } else {
        summary = `update_email_alert: failed${getStringValue(output.message) ? ` — ${getStringValue(output.message)}` : ''}`;
      }
      break;
    }
    case 'remove_email_alert': {
      if (output.success === true) {
        summary = `remove_email_alert: removed (${getStringValue(output.alertId) ?? 'unknown'})`;
      } else {
        summary = `remove_email_alert: failed${getStringValue(output.message) ? ` — ${getStringValue(output.message)}` : ''}`;
      }
      break;
    }
    case 'list_email_alerts': {
      const count =
        getNumberValue(output.count) ??
        (Array.isArray(output.alerts) ? output.alerts.length : 0);
      summary = `list_email_alerts: ${count} active`;
      break;
    }
    default: {
      const contentRefs = Array.isArray(output.contentRefs) ? output.contentRefs : [];
      if (contentRefs.length > 0) {
        const status =
          output.ok === true ? 'ok' : output.ok === false ? 'failed' : 'returned';
        summary = `${toolName}: ${status}, ${contentRefs.length} content ref(s)`;
        break;
      }

      if (!toolName.startsWith('mcp__')) return null;

      const status = output.ok === true ? 'ok' : output.ok === false ? 'failed' : 'unknown';
      const displayName = getStringValue(output.displayName) ?? 'MCP';
      const snippets = Array.isArray(output.snippets) ? output.snippets : [];
      const snippetCount = snippets.length;
      const degraded = output.degraded === true;
      const errorClass = getStringValue(output.errorClass);

      if (degraded && errorClass) {
        summary = `${toolName}: ${status} via ${displayName} (${errorClass})`;
      } else if (snippetCount > 0) {
        const firstSnippet = getStringValue(snippets[0]);
        summary = `${toolName}: ${status} via ${displayName}, ${snippetCount} snippet(s)`;
        if (firstSnippet) summary += ` — ${firstSnippet}`;
      } else if (contentRefs.length > 0) {
        summary = `${toolName}: ${status} via ${displayName}, ${contentRefs.length} content ref(s)`;
      } else {
        summary = `${toolName}: ${status} via ${displayName}`;
      }
      break;
    }
  }

  return summary ? truncateText(summary, MAX_SUMMARY_CHARS) : null;
}

/**
 * Extracts a concise summary of tool calls + tool results from message metadata.
 */
export function extractToolCallsSummary(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;

  const toolCalls: string[] = [];
  const resultSummaries: string[] = [];

  if (Array.isArray(metadata.toolCalls)) {
    for (const call of metadata.toolCalls) {
      const callRecord = asRecord(call);
      if (!callRecord) continue;
      const toolName = getToolName(callRecord);
      if (!toolName) continue;

      if (toolName === 'send_email') {
        const args = asRecord(callRecord.args);
        const to = getStringValue(args?.to) ?? 'unknown';
        const subject = truncateText(getStringValue(args?.subject) ?? 'unknown', 40);
        toolCalls.push(`send_email(to: ${to}, subject: "${subject}")`);
      } else {
        toolCalls.push(toolName);
      }
    }
  }

  if (Array.isArray(metadata.toolResults)) {
    for (const result of metadata.toolResults) {
      const resultRecord = asRecord(result);
      if (!resultRecord) continue;
      const toolName = getToolName(resultRecord);
      if (!toolName) continue;
      const output = resultRecord.result;

      if (toolName === 'send_email') {
        const sendOutput = asRecord(output);
        if (!sendOutput) continue;
        if (sendOutput.success) {
          resultSummaries.push(truncateText(`✓ Email sent (ID: ${sendOutput.messageId})`, MAX_SUMMARY_CHARS));
        } else {
          resultSummaries.push(
            truncateText(
              `✗ Email failed: ${getStringValue(sendOutput.message) ?? 'Unknown error'}`,
              MAX_SUMMARY_CHARS,
            ),
          );
        }
        continue;
      }

      const summary = summarizeToolResult(toolName, output);
      if (summary) resultSummaries.push(summary);
    }
  }

  const namesText = toolCalls.join(', ');
  const resultsText = resultSummaries.join(' | ');

  if (namesText && resultsText) return `${namesText} → ${resultsText}`;
  if (namesText) return namesText;
  if (resultsText) return resultsText;
  return null;
}
