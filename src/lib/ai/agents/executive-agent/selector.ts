import {
  listSelectableMcpServerPacks,
  type McpSelectableServerPack,
} from '@/lib/services/mcp/policy/service';
import type {
  SelectableSkill,
} from '@/lib/services/skills';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import type {
  ExecutiveAgentInput,
  ExecutiveTurnFeatures,
  ToolExposurePlan,
  ToolPackId,
} from './types';
import {
  buildPackToolAllowlist,
  getOwningPackForToolName,
} from './toolPacks';

const MCP_ALIAS_NOISE_WORDS = new Set([
  'mcp',
  'server',
  'servers',
  'tool',
  'tools',
  'toolkit',
  'workspace',
  'lms',
]);

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[.!?]+$/g, '');
}

function normalizeMcpMatchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPositiveEmoji(text: string): boolean {
  return /(👍|👌|✅|🙌|👏|🔥|💯|✨|🎉|🚀|❤️|💖|💕|💗|💙|💚|😁|😄|😃|😀|😊|🙂|😎|🤩|🥰|🥳|🤗|🙏)/u.test(
    text,
  );
}

function hasNegativeEmoji(text: string): boolean {
  return /(👎|❌|🚫|🛑|⚠️|☹️|🙁|😞|😟|😕|😣|😖|😫|😩|😠|😡|🤬|😤|😒|😬|😭|😢|🤢|🤮|💀)/u.test(
    text,
  );
}

function isExactShortReply(text: string, choices: readonly string[]): boolean {
  return choices.includes(text);
}

function getRecentAssistantMessages(
  history: ConversationMessageDTO[],
  limit = 6,
): ConversationMessageDTO[] {
  return history.filter((message) => message.role === 'ASSISTANT').slice(-limit);
}

function getToolResults(message: ConversationMessageDTO): Array<Record<string, unknown>> {
  const toolResults = message.metadata && typeof message.metadata === 'object'
    ? (message.metadata as Record<string, unknown>).toolResults
    : null;
  return Array.isArray(toolResults)
    ? toolResults.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object',
      )
    : [];
}

function hasToolResult(
  message: ConversationMessageDTO,
  toolName: string,
  predicate?: (result: Record<string, unknown>) => boolean,
): boolean {
  return getToolResults(message).some((entry) => {
    if (entry.toolName !== toolName) return false;
    const result = entry.result;
    if (!result || typeof result !== 'object') return false;
    return predicate ? predicate(result as Record<string, unknown>) : true;
  });
}

function detectDraftCandidate(history: ConversationMessageDTO[]): {
  present: boolean;
  reason: string | null;
} {
  const assistantMessages = getRecentAssistantMessages(history, 6);
  let latestSendSuccessIndex = -1;
  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    if (
      hasToolResult(
        assistantMessages[index],
        'send_email',
        (result) => result.success === true,
      )
    ) {
      latestSendSuccessIndex = index;
      break;
    }
  }

  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const message = assistantMessages[index];
    const content = message.content ?? '';
    const hasDraftMarkers =
      /\bto:\s*\S+/i.test(content) &&
      /\b(?:sub:|subject:)\s*\S+/i.test(content);

    if (!hasDraftMarkers) {
      continue;
    }

    if (latestSendSuccessIndex > index) {
      return {
        present: false,
        reason: 'later send_email success found after latest draft candidate',
      };
    }

    return {
      present: true,
      reason: 'recent assistant draft markers found',
    };
  }

  return {
    present: false,
    reason:
      latestSendSuccessIndex !== -1
        ? 'recent send_email success found but no unsent draft markers remain'
        : 'no recent assistant draft markers found',
  };
}

function hasRecentPendingCalendarPreview(history: ConversationMessageDTO[]): boolean {
  return getRecentAssistantMessages(history, 6).some((message) =>
    hasToolResult(
      message,
      'plan_calendar_change',
      (result) =>
        result.ok === true &&
        typeof result.pendingChange === 'object' &&
        result.pendingChange !== null,
    ),
  );
}

export function extractExecutiveTurnFeatures(params: {
  input: ExecutiveAgentInput;
  pendingCalendarChangePresent: boolean;
}): ExecutiveTurnFeatures {
  const latestMessage = normalizeText(params.input.userRequest);
  const draftCandidate = detectDraftCandidate(params.input.conversationHistory);
  const pendingPreviewPresent = hasRecentPendingCalendarPreview(
    params.input.conversationHistory,
  );

  const explicitSendApproval =
    hasPositiveEmoji(latestMessage) ||
    isExactShortReply(latestMessage, [
      'yes',
      'y',
      'yeah',
      'yep',
      'yup',
      'sure',
      'ok send',
      'okay send',
      'confirm',
      'approved',
      'approve',
      'ship it',
      'send it',
      'go ahead',
      'go for it',
      'do it',
      'lock it in',
      'yea',
    ]);

  const explicitSendDecline =
    hasNegativeEmoji(latestMessage) ||
    isExactShortReply(latestMessage, [
      'no',
      'nope',
      'dont send',
      "don't send",
      'not yet',
      'hold off',
      'cancel',
      'stop',
      'nah',
      'noo',
    ]);

  const explicitCalendarApproval =
    isExactShortReply(latestMessage, [
      'yes',
      'y',
      'yeah',
      'yep',
      'yup',
      'sure',
      'ok',
      'okay',
      'k',
      'alright',
      'alright then',
      'sounds good',
      'perfect',
      'great',
      'works',
      'works for me',
      'confirm',
      'approved',
      'approve',
      'ship it',
      'send it',
      'go ahead',
      'go for it',
      'do it',
      'lock it in',
      'yea',
    ]);

  const pendingCalendarConfirmIntent =
    params.pendingCalendarChangePresent &&
    explicitCalendarApproval;

  const pendingCalendarCancelIntent =
    params.pendingCalendarChangePresent &&
    (explicitSendDecline ||
      isExactShortReply(latestMessage, [
        'cancel it',
        'cancel that',
        "don't do it",
        'dont do it',
      ]));

  return {
    explicitSendApproval,
    draftCandidatePresent: draftCandidate.present,
    pendingCalendarChangePresent: params.pendingCalendarChangePresent,
    channel: params.input.channel,
    hasRecentPendingCalendarPreview: pendingPreviewPresent,
    pendingCalendarConfirmIntent,
    pendingCalendarCancelIntent,
    draftCandidateReason: draftCandidate.reason,
  };
}

function uniquePackIds(packIds: readonly ToolPackId[]): ToolPackId[] {
  const seen = new Set<ToolPackId>();
  const ordered: ToolPackId[] = [];

  for (const packId of packIds) {
    if (seen.has(packId)) continue;
    seen.add(packId);
    ordered.push(packId);
  }

  return ordered;
}

function uniqueConnectionIds(connectionIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const connectionId of connectionIds) {
    if (!connectionId || seen.has(connectionId)) continue;
    seen.add(connectionId);
    ordered.push(connectionId);
  }

  return ordered;
}

function uniqueSkillIds(skillIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const skillId of skillIds) {
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    ordered.push(skillId);
  }

  return ordered;
}

function buildSelection(params: {
  packIds?: readonly ToolPackId[];
  reasons: string[];
  reminders?: string[];
  mcpConnectionIds?: readonly string[];
  skillIds?: readonly string[];
  repairAttempted?: boolean;
}): ToolExposurePlan {
  const actionPackIds = uniquePackIds(
    (params.packIds ?? []).filter((packId) => packId !== 'safe_context_pack'),
  );

  return {
    primaryPack: actionPackIds[0] ?? 'safe_context_pack',
    packIds: ['safe_context_pack', ...actionPackIds],
    mcpConnectionIds: uniqueConnectionIds(params.mcpConnectionIds ?? []),
    skillIds: uniqueSkillIds(params.skillIds ?? []),
    reasons: params.reasons,
    reminders: params.reminders ?? [],
    repairAttempted: params.repairAttempted === true,
  };
}

function addUniqueReminder(reminders: string[], reminder: string): string[] {
  return reminders.includes(reminder) ? reminders : [...reminders, reminder];
}

function buildMcpAliasCandidates(pack: McpSelectableServerPack): string[] {
  const aliases = new Set<string>();

  const addAlias = (value: string) => {
    const normalized = normalizeMcpMatchText(value);
    if (!normalized || normalized.length < 2) return;
    aliases.add(normalized);
  };

  const addFromSource = (value: string) => {
    const normalized = normalizeMcpMatchText(value);
    if (!normalized) return;

    addAlias(normalized);

    const strippedTokens = normalized
      .split(' ')
      .filter((token) => token && !MCP_ALIAS_NOISE_WORDS.has(token));

    if (strippedTokens.length === 0) return;

    const stripped = strippedTokens.join(' ');
    addAlias(stripped);

    if (strippedTokens.length === 1) {
      addAlias(strippedTokens[0]!);
    }
  };

  addFromSource(pack.serverKey);
  addFromSource(pack.displayName);

  return Array.from(aliases).sort((left, right) => right.length - left.length);
}

function hasExplicitAliasMatch(normalizedText: string, alias: string): boolean {
  return ` ${normalizedText} `.includes(` ${alias} `);
}

function normalizeSkillMatchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectExplicitMcpServerMentions(params: {
  userRequest: string;
  mcpServerPacks: readonly McpSelectableServerPack[];
}): string[] {
  const normalizedUserRequest = normalizeMcpMatchText(params.userRequest);
  if (!normalizedUserRequest) return [];

  return params.mcpServerPacks
    .filter((pack) =>
      buildMcpAliasCandidates(pack).some((alias) =>
        hasExplicitAliasMatch(normalizedUserRequest, alias),
      ),
    )
    .map((pack) => pack.connectionId);
}

function detectExplicitSkillMentions(params: {
  userRequest: string;
  selectableSkills: readonly SelectableSkill[];
}): string[] {
  const normalizedUserRequest = normalizeSkillMatchText(params.userRequest);
  if (!normalizedUserRequest) return [];

  return params.selectableSkills
    .filter((skill) =>
      hasExplicitAliasMatch(normalizedUserRequest, normalizeSkillMatchText(skill.name)),
    )
    .map((skill) => skill.id);
}

async function selectDeterministicMcpConnectionIds(params: {
  input: ExecutiveAgentInput;
  features: ExecutiveTurnFeatures;
  mcpServerPacks?: readonly McpSelectableServerPack[];
}): Promise<{ connectionIds: string[]; reasons: string[] }> {
  const mcpServerPacks =
    params.mcpServerPacks ??
    await listSelectableMcpServerPacks({
      userId: params.input.userId,
      channel: params.features.channel,
    });

  const explicitAliasMatches = detectExplicitMcpServerMentions({
    userRequest: params.input.userRequest,
    mcpServerPacks,
  });
  if (explicitAliasMatches.length > 0) {
    return {
      connectionIds: explicitAliasMatches,
      reasons: ['explicit MCP server alias match'],
    };
  }

  return {
    connectionIds: [],
    reasons: [],
  };
}

export function hasDeterministicActionIntent(features: ExecutiveTurnFeatures): boolean {
  return (
    features.pendingCalendarConfirmIntent ||
    features.pendingCalendarCancelIntent ||
    (features.explicitSendApproval && features.draftCandidatePresent)
  );
}

export async function selectExecutiveToolPackForTurn(params: {
  input: ExecutiveAgentInput;
  features: ExecutiveTurnFeatures;
  mcpServerPacks?: readonly McpSelectableServerPack[];
  selectableSkills?: readonly SelectableSkill[];
}): Promise<ToolExposurePlan> {
  const mcpSelection = await selectDeterministicMcpConnectionIds({
    input: params.input,
    features: params.features,
    mcpServerPacks: params.mcpServerPacks,
  });
  const preselectedSkillIds = detectExplicitSkillMentions({
    userRequest: params.input.userRequest,
    selectableSkills: params.selectableSkills ?? [],
  });

  const reasons = [
    'safe context substrate available every turn',
    ...mcpSelection.reasons,
    ...(preselectedSkillIds.length > 0 ? ['explicit skill name match'] : []),
  ];
  const reminders = [
    'Safe context tools for inbox, calendar, memory, PDF reads, progress updates, and reply preference reads are available every turn.',
    'Action packs stay hidden until the executive agent explicitly requests them.',
  ];

  if (params.features.pendingCalendarChangePresent) {
    reminders.push('A pending calendar change exists; confirm it, cancel it, or explicitly modify it.');
  }

  if (params.features.explicitSendApproval && params.features.draftCandidatePresent) {
    reminders.push('An approved draft candidate exists; request the email send pack only if you truly intend to send it.');
  }

  return buildSelection({
    packIds: [],
    reasons,
    reminders,
    mcpConnectionIds: mcpSelection.connectionIds,
    skillIds: preselectedSkillIds,
  });
}

function mapMissingNativeToolToRepairPack(params: {
  toolName: string;
  features: ExecutiveTurnFeatures;
}): ToolPackId | null {
  const owningPack = getOwningPackForToolName(params.toolName);
  if (!owningPack || owningPack === 'safe_context_pack') {
    return owningPack;
  }

  const allowlist = buildPackToolAllowlist(owningPack, params.features);
  return allowlist.includes(params.toolName as (typeof allowlist)[number])
    ? owningPack
    : null;
}

function mapMissingMcpToolsToConnections(params: {
  toolNames: readonly string[];
  mcpServerPacks: readonly McpSelectableServerPack[];
}): string[] {
  const toolSet = new Set(params.toolNames);
  return params.mcpServerPacks
    .filter((pack) =>
      pack.eligibleModelToolNames.some((toolName) => toolSet.has(toolName)),
    )
    .map((pack) => pack.connectionId);
}

export async function expandExposurePlanForRepair(params: {
  input: ExecutiveAgentInput;
  features: ExecutiveTurnFeatures;
  plan: ToolExposurePlan;
  outOfPackToolNames: readonly string[];
  reason: 'missing_tools' | 'action_intent_stall';
  mcpServerPacks?: readonly McpSelectableServerPack[];
}): Promise<{
  plan: ToolExposurePlan;
  expandedPackIds: ToolPackId[];
  expandedMcpConnectionIds: string[];
}> {
  const mcpServerPacks =
    params.mcpServerPacks ??
    await listSelectableMcpServerPacks({
      userId: params.input.userId,
      channel: params.features.channel,
    });

  const expandedPackIds = new Set<ToolPackId>();
  const expandedMcpConnectionIds = new Set<string>();

  if (params.reason === 'missing_tools') {
    for (const toolName of params.outOfPackToolNames) {
      const nativePack = mapMissingNativeToolToRepairPack({
        toolName,
        features: params.features,
      });
      if (nativePack) {
        expandedPackIds.add(nativePack);
      }
    }

    for (const connectionId of mapMissingMcpToolsToConnections({
      toolNames: params.outOfPackToolNames,
      mcpServerPacks,
    })) {
      expandedMcpConnectionIds.add(connectionId);
    }
  } else {
    // Keep the repair rerun conservative. Use it to reinforce that packs must be
    // requested explicitly instead of silently widening semantic action exposure.
  }

  const nextPackIds = uniquePackIds([
    ...params.plan.packIds,
    ...expandedPackIds,
  ]);
  const nextMcpConnectionIds = uniqueConnectionIds([
    ...params.plan.mcpConnectionIds,
    ...expandedMcpConnectionIds,
  ]);

  const plan = buildSelection({
    packIds: nextPackIds,
    reasons: addUniqueReminder(
      [...params.plan.reasons],
      params.reason === 'missing_tools'
        ? 'repair rerun expanded missing tool families deterministically'
        : 'repair rerun preserved safe context and reinforced explicit pack requests after zero-tool stall',
    ),
    reminders:
      params.reason === 'action_intent_stall'
        ? addUniqueReminder(
            params.plan.reminders,
            'If you need native action tools, call request_tool_pack_exposure before claiming you can act.',
          )
        : params.plan.reminders,
    mcpConnectionIds: nextMcpConnectionIds,
    skillIds: params.plan.skillIds,
    repairAttempted: true,
  });

  return {
    plan,
    expandedPackIds: [...expandedPackIds].filter(
      (packId) => !params.plan.packIds.includes(packId),
    ),
    expandedMcpConnectionIds: [...expandedMcpConnectionIds].filter(
      (connectionId) => !params.plan.mcpConnectionIds.includes(connectionId),
    ),
  };
}
