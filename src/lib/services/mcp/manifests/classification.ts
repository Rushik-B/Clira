import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  McpActionClass,
  McpLatencyClass,
} from '@/lib/services/mcp/types';

const ACTION_KEYWORDS: Record<McpActionClass, readonly string[]> = {
  delete: ['delete', 'remove', 'purge', 'erase'],
  side_effectful: ['send', 'execute', 'trigger', 'publish', 'deploy', 'run'],
  write: ['create', 'update', 'write', 'append', 'upsert', 'set', 'book', 'schedule', 'add'],
  read: ['get', 'list', 'search', 'find', 'lookup', 'read', 'fetch', 'query'],
};

const ACTION_CLASS_PRIORITY: readonly McpActionClass[] = [
  'delete',
  'side_effectful',
  'write',
  'read',
];
const PRIMARY_VERB_WEIGHT = 6;
const NAME_WEIGHT = 3;
const TITLE_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;

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

function tokenize(value: string | undefined | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function scoreKeywordMatches(tokens: readonly string[], keywords: readonly string[]): number {
  if (tokens.length === 0) {
    return 0;
  }

  const keywordSet = new Set(keywords);
  return tokens.reduce((score, token) => score + (keywordSet.has(token) ? 1 : 0), 0);
}

function scoreActionClass(
  actionClass: McpActionClass,
  nameTokens: readonly string[],
  titleTokens: readonly string[],
  descriptionTokens: readonly string[],
): number {
  const keywords = ACTION_KEYWORDS[actionClass];
  const primaryVerbBoost = keywords.includes(nameTokens[0] ?? '')
    ? PRIMARY_VERB_WEIGHT
    : 0;

  return (
    primaryVerbBoost +
    (scoreKeywordMatches(nameTokens, keywords) * NAME_WEIGHT) +
    (scoreKeywordMatches(titleTokens, keywords) * TITLE_WEIGHT) +
    (scoreKeywordMatches(descriptionTokens, keywords) * DESCRIPTION_WEIGHT)
  );
}

export function classifyMcpActionClass(tool: Tool): McpActionClass {
  if (tool.annotations?.readOnlyHint === true) {
    return 'read';
  }

  const nameTokens = tokenize(tool.name);
  const titleTokens = tokenize(tool.annotations?.title);
  const descriptionTokens = tokenize(tool.description);

  let bestClass: McpActionClass = 'side_effectful';
  let bestScore = 0;

  for (const actionClass of ACTION_CLASS_PRIORITY) {
    const score = scoreActionClass(actionClass, nameTokens, titleTokens, descriptionTokens);
    const currentPriority = ACTION_CLASS_PRIORITY.indexOf(actionClass);
    const bestPriority = ACTION_CLASS_PRIORITY.indexOf(bestClass);

    if (score > bestScore || (score === bestScore && score > 0 && currentPriority < bestPriority)) {
      bestClass = actionClass;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestClass : 'side_effectful';
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
