import type { ExecutiveTurnFeatures, ToolPackId } from '@/lib/ai/agents/executive-agent/types';
import type { McpCapabilityIntent } from '@/lib/services/mcp/types';

function hasAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function resolveExecutiveMcpCapabilityIntents(params: {
  packIds: readonly ToolPackId[];
  userRequest: string;
  turnFeatures: ExecutiveTurnFeatures;
}): McpCapabilityIntent[] {
  const request = params.userRequest.trim().toLowerCase();
  const intents = new Set<McpCapabilityIntent>();

  if (params.packIds.includes('calendar_query_pack')) {
    intents.add('calendar_external_read');
  }

  if (params.packIds.includes('inbox_context_pack')) {
    if (
      hasAny(request, [
        'doc',
        'docs',
        'notion',
        'confluence',
        'wiki',
        'knowledge base',
        'manual',
        'readme',
        'spec',
      ])
    ) {
      intents.add('docs_read');
    }

    if (
      hasAny(request, [
        'file',
        'folder',
        'drive',
        'storage',
        'pdf',
        'deck',
        'slide',
        'sheet',
        'attachment',
        'contract',
      ])
    ) {
      intents.add('storage_read');
    }

    if (
      hasAny(request, [
        'crm',
        'customer',
        'client',
        'account',
        'contact',
        'company',
        'deal',
        'lead',
        'opportunity',
        'salesforce',
        'hubspot',
      ])
    ) {
      intents.add('crm_lookup');
    }
  }

  if (
    params.turnFeatures.workloadOverviewIntent &&
    params.packIds.includes('calendar_query_pack') &&
    hasAny(request, ['project', 'task', 'issue', 'ticket', 'deadline'])
  ) {
    intents.add('project_tasks_read');
  }

  return [...intents].sort();
}
