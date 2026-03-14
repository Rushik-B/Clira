import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  McpActionClass,
  McpCapabilityId,
  McpLatencyClass,
} from '@/lib/services/mcp/types';

function normalize(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function combinedText(tool: Tool): string {
  return [
    tool.name,
    tool.description,
    tool.annotations?.title,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function hasAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function classifyMcpActionClass(tool: Tool): McpActionClass {
  if (tool.annotations?.readOnlyHint === true) {
    return 'read';
  }

  const text = combinedText(tool);

  if (hasAny(text, ['delete', 'remove', 'purge', 'erase'])) {
    return 'delete';
  }

  if (hasAny(text, ['send', 'execute', 'trigger', 'publish', 'deploy', 'run'])) {
    return 'side_effectful';
  }

  if (hasAny(text, ['create', 'update', 'write', 'append', 'upsert', 'set', 'book', 'schedule', 'add'])) {
    return 'write';
  }

  if (hasAny(text, ['get', 'list', 'search', 'find', 'lookup', 'read', 'fetch', 'query'])) {
    return 'read';
  }

  return 'side_effectful';
}

export function classifyMcpCapabilityId(tool: Tool, actionClass: McpActionClass): McpCapabilityId {
  const text = combinedText(tool);

  if (actionClass !== 'read') {
    return 'generic_read';
  }

  if (hasAny(text, ['calendar', 'event', 'availability', 'freebusy', 'schedule'])) {
    return 'calendar_external_read';
  }

  if (hasAny(text, ['crm', 'customer', 'contact', 'lead', 'account', 'opportunity', 'salesforce', 'hubspot', 'company'])) {
    return 'crm_lookup';
  }

  if (hasAny(text, ['task', 'project', 'issue', 'ticket', 'linear', 'jira', 'todo'])) {
    return 'project_tasks_read';
  }

  if (hasAny(text, ['file', 'folder', 'drive', 'storage', 'attachment', 'pdf', 'sheet', 'slide'])) {
    return 'storage_read';
  }

  if (hasAny(text, ['doc', 'docs', 'notion', 'confluence', 'wiki', 'knowledge', 'page', 'manual', 'readme'])) {
    return 'docs_read';
  }

  return 'generic_read';
}

export function classifyMcpLatencyClass(tool: Tool): McpLatencyClass {
  if (tool.execution?.taskSupport === 'required') {
    return 'slow';
  }

  const text = combinedText(tool);
  if (hasAny(text, ['search', 'query', 'report', 'analytics', 'export', 'sync'])) {
    return 'standard';
  }

  if (hasAny(text, ['list', 'get', 'read', 'lookup', 'find'])) {
    return 'fast';
  }

  return 'standard';
}

export function buildMcpDisplayTitle(tool: Tool): string {
  const title = typeof tool.annotations?.title === 'string'
    ? tool.annotations.title.trim()
    : '';
  return normalize(title) ? title : tool.name;
}
