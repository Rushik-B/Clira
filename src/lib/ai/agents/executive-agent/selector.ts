import { z } from 'zod';
import { withConcurrency } from '@/lib/ai/concurrency';
import { LlmError } from '@/lib/ai/errors';
import { withRetry } from '@/lib/ai/retry';
import { logger } from '@/lib/logger';
import {
  listSelectableMcpServerPacks,
  type McpSelectableServerPack,
} from '@/lib/services/mcp/policy/service';
import type {
  ConversationMessageDTO,
} from '@/lib/ai/schemas/executiveAgentSchemas';
import type {
  ExecutiveAgentInput,
  ExecutiveTurnFeatures,
  PackSelection,
  ToolPackId,
} from './types';

const TOOL_PACK_IDS = [
  'core_recall_pack',
  'inbox_context_pack',
  'calendar_query_pack',
  'calendar_mutation_pack',
  'reminder_alert_pack',
  'settings_mutation_pack',
  'email_send_pack',
] as const satisfies readonly ToolPackId[];

function buildAllPackSelection(params: {
  reasons: string[];
  reminders?: string[];
  mcpConnectionIds?: readonly string[];
}): PackSelection {
  return buildSelection({
    packIdOrPackIds: [...TOOL_PACK_IDS],
    reasons: params.reasons,
    reminders: params.reminders,
    mcpConnectionIds: params.mcpConnectionIds,
  });
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[.!?]+$/g, '');
}

function hasAnyPhrase(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
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

function getRecentAssistantMessages(history: ConversationMessageDTO[], limit = 6): ConversationMessageDTO[] {
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
    ]) ||
    hasAnyPhrase(latestMessage, [
      'send it',
      'go ahead',
      'ship it',
      'do it',
      'lock it in',
      'send now',
      'yes send',
      'please send',
      'approve it',
      'approved',
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
      'noo'
    ]) ||
    hasAnyPhrase(latestMessage, [
      "don't send",
      'dont send',
      'do not send',
      'hold off',
      'not yet',
      'cancel that',
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
    ]) ||
    hasAnyPhrase(latestMessage, [
      'confirm',
      'approve it',
      'approved',
      'go ahead',
      'go for it',
      'lock it in',
      'yes do it',
      'please do it',
    ]);

  const pendingCalendarConfirmIntent =
    params.pendingCalendarChangePresent &&
    explicitCalendarApproval;

  const pendingCalendarCancelIntent =
    params.pendingCalendarChangePresent &&
    (explicitSendDecline ||
      hasAnyPhrase(latestMessage, [
        'cancel it',
        'cancel that',
        "don't do it",
        'dont do it',
      ]));

  const pendingCalendarModifyIntent =
    params.pendingCalendarChangePresent &&
    (hasAnyPhrase(latestMessage, [
      'actually',
      'instead',
      'change it',
      'change the plan',
      'modify the plan',
      'update the plan',
      'move it',
      'push it',
      'make it',
      'reschedule it',
    ]) ||
      /\b(?:move|reschedule|push|change|update|shift)\b/.test(latestMessage));

  const hasCalendarMutationVerb =
    /\b(?:schedule|reschedule|move|push|shift|cancel|delete|remove|create|book|block(?:\s+out)?|hold|reserve)\b/.test(
      latestMessage,
    );

  const hasCalendarTargetOrContainer =
    /\b(?:meeting|meetings|calendar|event|events|call|calls|1:1|appointment|appointments|time|slot)\b/.test(
      latestMessage,
    );

  const hasDirectTimeWindow =
    /\b(?:today|tonight|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      latestMessage,
    ) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.test(latestMessage) ||
    /\b\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/.test(
      latestMessage,
    );

  const hasCalendarPlacementPhrase =
    hasAnyPhrase(latestMessage, [
      'put it on my calendar',
      'put it in my calendar',
      'put that on my calendar',
      'put that in my calendar',
      'add it to my calendar',
      'add that to my calendar',
      'book it on my calendar',
      'book that on my calendar',
    ]) ||
    (/\b(?:put|add|book|block|hold|reserve)\b/.test(latestMessage) &&
      /\b(?:calendar|cal)\b/.test(latestMessage));

  const calendarMutationIntent =
    (hasCalendarMutationVerb &&
      (hasCalendarTargetOrContainer || hasDirectTimeWindow)) ||
    hasCalendarPlacementPhrase;

  const mentionsCommunicationContent =
    /\b(?:said|say|told me|mentioned|wrote|emailed|reply|message)\b/.test(
      latestMessage,
    );

  const calendarQueryIntent =
    !calendarMutationIntent &&
    !mentionsCommunicationContent &&
    /\b(?:calendar|meeting|meetings|event|events|availability|available|free|busy|schedule|tomorrow|today|friday|monday|tuesday|wednesday|thursday|saturday|sunday|next week|this week)\b/.test(
      latestMessage,
    );

  const emailIntent =
    /\b(?:email|reply|respond|draft|message|forward|follow up|follow-up|send a note|send an email)\b/.test(
      latestMessage,
    );

  const reminderIntent =
    /\b(?:remind me|reminder|snooze|dismiss|mark complete|done|later)\b/.test(
      latestMessage,
    );

  const alertIntent =
    /\b(?:alert me|notify me|notification|email alert|watch for emails|watch emails)\b/.test(
      latestMessage,
    );

  const workloadOverviewIntent =
    !calendarMutationIntent &&
    !emailIntent &&
    (/\b(?:deadline|deadlines|priority|priorities|due|task|tasks|workload)\b/.test(
      latestMessage,
    ) ||
      hasAnyPhrase(latestMessage, [
        'on my plate',
        "what's on my plate",
        'whats on my plate',
        'top priority',
        'top priorities',
        'focus today',
        'what should i focus on',
        'what should i prioritize',
        'what should i work on',
      ]));

  return {
    explicitSendApproval,
    draftCandidatePresent: draftCandidate.present,
    pendingCalendarChangePresent: params.pendingCalendarChangePresent,
    calendarMutationIntent: calendarMutationIntent || pendingCalendarModifyIntent,
    calendarQueryIntent,
    workloadOverviewIntent,
    reminderIntent,
    alertIntent,
    channel: params.input.channel,
    hasRecentPendingCalendarPreview: pendingPreviewPresent,
    pendingCalendarConfirmIntent,
    pendingCalendarCancelIntent,
    pendingCalendarModifyIntent,
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

function buildSelection(
  params: {
    packIdOrPackIds: ToolPackId | readonly ToolPackId[];
    reasons: string[];
    reminders?: string[];
    mcpConnectionIds?: readonly string[];
  },
): PackSelection {
  const packIds = uniquePackIds(
    Array.isArray(params.packIdOrPackIds)
      ? params.packIdOrPackIds
      : [params.packIdOrPackIds],
  );
  const normalizedPackIds: ToolPackId[] =
    packIds.length > 0 ? packIds : ['core_recall_pack'];

  return {
    packId: normalizedPackIds[0],
    packIds: normalizedPackIds,
    mcpConnectionIds: uniqueConnectionIds(params.mcpConnectionIds ?? []),
    reasons: params.reasons,
    reminders: params.reminders ?? [],
  };
}

function addUniqueReminder(reminders: string[], reminder: string): string[] {
  return reminders.includes(reminder) ? reminders : [...reminders, reminder];
}

function shouldInferPendingCalendarModifyFromLlmSelection(params: {
  features: ExecutiveTurnFeatures;
  selection: Pick<PackSelection, 'packIds' | 'reasons'>;
}): boolean {
  const { features, selection } = params;

  if (!features.pendingCalendarChangePresent) return false;
  if (features.pendingCalendarConfirmIntent || features.pendingCalendarCancelIntent) {
    return false;
  }

  const selectionWasLlmDriven = selection.reasons.includes('llm selector');
  if (!selectionWasLlmDriven) return false;

  return selection.packIds.includes('calendar_mutation_pack');
}

export function resolveTurnFeaturesWithSelection(params: {
  features: ExecutiveTurnFeatures;
  selection: Pick<PackSelection, 'packIds' | 'reasons'>;
}): ExecutiveTurnFeatures {
  const selectionWasLlmDriven = params.selection.reasons.includes('llm selector');
  const inferredPendingCalendarModifyIntent = selectionWasLlmDriven
    ? shouldInferPendingCalendarModifyFromLlmSelection(params)
    : params.features.pendingCalendarModifyIntent;

  if (
    inferredPendingCalendarModifyIntent === params.features.pendingCalendarModifyIntent &&
    params.features.calendarMutationIntent
  ) {
    return params.features;
  }

  return {
    ...params.features,
    calendarMutationIntent:
      params.features.calendarMutationIntent || inferredPendingCalendarModifyIntent,
    pendingCalendarModifyIntent: inferredPendingCalendarModifyIntent,
  };
}

const toolPackIdSchema = z.enum(TOOL_PACK_IDS);

const selectorOutputSchema = z
  .object({
    packId: toolPackIdSchema.optional(),
    packIds: z.array(toolPackIdSchema).min(1).max(TOOL_PACK_IDS.length).optional(),
    mcpServerKeys: z.array(z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    const packCount =
      (value.packIds?.length ?? 0) + (value.packId ? 1 : 0);
    if (packCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide packIds or packId.',
        path: ['packIds'],
      });
    }
  });

function resolveSelectorPackIds(
  selection: z.infer<typeof selectorOutputSchema>,
): ToolPackId[] {
  return uniquePackIds(selection.packIds ?? (selection.packId ? [selection.packId] : []));
}

const CEREBRAS_SELECTOR_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'executive_pack_selection',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        packIds: {
          type: 'array',
          items: {
            type: 'string',
            enum: [...TOOL_PACK_IDS],
          },
        },
        mcpServerKeys: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
      },
      required: ['packIds'],
      additionalProperties: false,
    },
  },
} as const;

type CerebrasSelectorApiResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
  id?: string;
};

/**
 * Enables the optional LLM selector path.
 *
 * Flags:
 * - EA_SELECTOR_CEREBRAS_ENABLED=true|false (global)
 * - EA_SELECTOR_CEREBRAS_<CHANNEL>=true|false (channel override)
 *
 * Channel override wins over global.
 */
function isSelectorLlmEnabled(channel: ExecutiveTurnFeatures['channel']): boolean {
  const globalFlag = process.env.EA_SELECTOR_CEREBRAS_ENABLED;
  const channelFlag = process.env[`EA_SELECTOR_CEREBRAS_${channel.toUpperCase()}`];
  if (channelFlag === 'true') return true;
  if (channelFlag === 'false') return false;
  return globalFlag === 'true';
}

function getDefaultPackRemindersForSelection(packIds: readonly ToolPackId[]): string[] {
  return packIds.every((packId) =>
    packId === 'core_recall_pack' ||
    packId === 'inbox_context_pack' ||
    packId === 'calendar_query_pack',
  )
    ? ['Only context tools are available this turn.']
    : [];
}

/**
 * Final safety firewall for any non-deterministic selector output.
 * If an unsafe pack is suggested, downgrade to the nearest safe read-only pack.
 *
 * Note: calendar_mutation_pack is no longer blocked here because the LLM
 * selector now has conversation context to detect mutation intent that regex
 * misses (e.g. anaphoric "put it in my calendar too"). The per-tool allowlist
 * in buildPackToolAllowlist still gates dangerous tools like commit_calendar_change.
 * Only email_send_pack retains a hard block because it requires verified DB state
 * (draft present + explicit approval) that the LLM cannot infer.
 */
export function enforcePackSafety(
  packId: ToolPackId,
  features: ExecutiveTurnFeatures,
): ToolPackId {
  if (
    packId === 'email_send_pack' &&
    (!features.explicitSendApproval || !features.draftCandidatePresent)
  ) {
    return 'inbox_context_pack';
  }

  return packId;
}

/**
 * Formats recent conversation history into a compact string for the LLM selector.
 * Only includes the last few messages, trimming stale ones older than the cutoff.
 */
function formatRecentHistory(
  history: ConversationMessageDTO[],
  maxMessages = 8,
  staleCutoffMs = 45 * 60 * 1000, // 45 minutes
): string {
  const now = Date.now();
  const recent = history
    .slice(-maxMessages)
    .filter((msg) => now - msg.createdAt.getTime() < staleCutoffMs);

  if (recent.length === 0) return '(no recent conversation history)';

  return recent
    .map((msg) => {
      const role = msg.role === 'USER' ? 'User' : 'Assistant';
      const time = msg.createdAt.toISOString();
      const content = (msg.content ?? '').slice(0, 500);
      return `[${time}] ${role}: ${content}`;
    })
    .join('\n');
}

function buildSelectorPrompt(params: {
  userRequest: string;
  features: ExecutiveTurnFeatures;
  conversationHistory: ConversationMessageDTO[];
  mcpServerPacks: readonly McpSelectableServerPack[];
}): string {
  const { userRequest, features, conversationHistory, mcpServerPacks } = params;

  return [
    'Pick one or more packIds for the user message.',
    'Classify by user intent and the minimum tool family needed to answer or act safely.',
    'Do not rely on exact wording. Infer the underlying job the assistant must do.',
    'Return multiple packs only when the same turn genuinely needs multiple tool families.',
    'Order matters: put the primary pack first.',
    'Read the recent conversation carefully before routing.',
    'Pay special attention to the latest 4-5 turns. Short follow-ups often depend on that immediate context.',
    'If the current user message is short, ambiguous, or referential (for example: "?", "what about that?", "what is that?", "what does that mean?", "and this?"), resolve what it refers to from the recent conversation before choosing a pack.',
    'If the recent conversation is about a specific email thread, quoted email text, reply draft, sender, or message detail, and the current user is asking about that detail, prefer inbox_context_pack over core_recall_pack.',
    'Use core_recall_pack for durable personal memory and long-term facts about the user. Do not use it when the real job is interpreting a recent conversation artifact.',
    '',
    'Routing principles:',
    '- If the user wants to remember, inspect, or change standing reply behavior, choose settings_mutation_pack.',
    '- settings_mutation_pack covers BOTH reading saved reply rules and writing/updating them.',
    '- Use settings_mutation_pack for questions like "what preferences do you have saved", "show my style rules", "how do you reply to my mom", or "from now on keep replies shorter".',
    '- Use inbox_context_pack when the user wants email lookup, drafting, or to know what someone said.',
    '- Use inbox_context_pack for follow-up questions about a recent email, draft, sender, quoted snippet, place, name, or phrase mentioned in the conversation, even when the latest user message does not explicitly say "email".',
    '- Use core_recall_pack for personal memory/facts recall when inbox lookup or drafting is not the main job.',
    '- Use calendar_query_pack for calendar lookup or availability/workload questions.',
    '- Use calendar_mutation_pack for creating, moving, cancelling, or changing calendar items.',
    '- If pendingCalendarChangePresent=true, treat the latest user message as potentially referring to the staged calendar draft, even when the message is short or indirect.',
    '- If pendingCalendarChangePresent=true and the user is revising the staged draft, choose calendar_mutation_pack.',
    '- Pending-draft revisions include adding or removing reminders, changing the time, location, title, attendees, notes, or any other event detail.',
    '- Pending-draft revisions may be phrased indirectly, like "add another reminder", "also 24 hrs before", "12 hrs too", "make it BierCraft", or "actually 8pm". Do not require words like "change" or "update".',
    '- If pendingCalendarChangePresent=true and the user is explicitly approving or declining the staged change, choose calendar_mutation_pack so the runtime can resolve it safely.',
    '- Use reminder_alert_pack for reminders and email alerts.',
    '- Use email_send_pack only when there is an already-approved unsent draft and the user is clearly approving send.',
    '- If the user both changes reply preferences AND asks for a reminder/calendar action in the same turn, include both relevant packs.',
    '',
    'core_recall_pack — personal facts, memory, preferences',
    'inbox_context_pack — email lookup, what someone said/wrote, drafting',
    'calendar_query_pack — read calendar, check availability, workload overview',
    'calendar_mutation_pack — create/move/cancel calendar events; includes anaphoric "add it", "put it in my cal", "book it"',
    'reminder_alert_pack — set/snooze/dismiss reminders or email alerts',
    'settings_mutation_pack — read or write standing reply preferences for planner/style behavior',
    'email_send_pack — send approved draft (only when draftCandidatePresent=true AND explicitSendApproval=true)',
    ...(mcpServerPacks.length > 0
      ? [
          '',
          'Dynamic MCP server packs:',
          ...mcpServerPacks.map(
            (pack) => `mcp_server:${pack.serverKey} — ${pack.packDescription}`,
          ),
          '',
          'MCP routing principles:',
          '- Use mcp_server:<serverKey> when the user request involves capabilities provided by that external server.',
          '- You may select both a native pack and one or more MCP server packs in the same turn.',
        ]
      : []),
    '',
    'Intent examples:',
    '"when is my next meeting?" → calendar_query_pack',
    '"am i free after 3 tomorrow?" → calendar_query_pack',
    '"block tomorrow 2-3pm" → calendar_mutation_pack',
    '"put it in my cal too" → calendar_mutation_pack',
    '"what did alex say in his email?" → inbox_context_pack',
    '"draft a reply to sarah" → inbox_context_pack',
    '"what does that place mean?" right after discussing a recent email thread → inbox_context_pack',
    '"what is that?" right after an assistant quoted an email → inbox_context_pack',
    '"who is my manager?" → core_recall_pack',
    '"when was my whistler trip?" → core_recall_pack',
    '"remind me in an hour" → reminder_alert_pack',
    '"always reply to my mom informally and end with love you" → settings_mutation_pack',
    '"for replies to investors, keep it formal and short" → settings_mutation_pack',
    '"never volunteer calendar times unless i ask" → settings_mutation_pack',
    '"what reply preferences do you have saved?" → settings_mutation_pack',
    '"show me how you reply to my mom right now" → settings_mutation_pack',
    '"update my reply rules and remind me tomorrow at 9" → ["settings_mutation_pack", "reminder_alert_pack"]',
    '"yes send it" [draftCandidatePresent=true] → email_send_pack',
    '',
    `State: draftCandidatePresent=${features.draftCandidatePresent}, explicitSendApproval=${features.explicitSendApproval}, pendingCalendarChangePresent=${features.pendingCalendarChangePresent}`,
    '',
    'Recent conversation (newest at the bottom):',
    formatRecentHistory(conversationHistory),
    '',
    `User: ${userRequest}`,
    '',
    'Return JSON: { "packIds": ["...", "..."], "mcpServerKeys": ["..."] }',
  ].join('\n');
}

async function callCerebrasSelector(params: {
  userRequest: string;
  features: ExecutiveTurnFeatures;
  conversationHistory: ConversationMessageDTO[];
  mcpServerPacks: readonly McpSelectableServerPack[];
  abortSignal?: AbortSignal;
}): Promise<z.infer<typeof selectorOutputSchema>> {
  const apiKey = process.env.CEREBRAS_API_KEY?.trim();
  if (!apiKey) {
    throw new LlmError(
      'CEREBRAS_API_KEY is required when EA selector Cerebras routing is enabled',
      {
        code: 'provider',
        provider: 'cerebras',
        model: process.env.EA_SELECTOR_CEREBRAS_MODEL?.trim() || 'llama3.1-8b',
      },
    );
  }

  const model = process.env.EA_SELECTOR_CEREBRAS_MODEL?.trim() || 'llama3.1-8b';
  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a routing classifier for executive tool packs. Route by intent and required capabilities, not exact word overlap. Return strict JSON only.',
      },
      {
        role: 'user',
        content: buildSelectorPrompt({
          userRequest: params.userRequest,
          features: params.features,
          conversationHistory: params.conversationHistory,
          mcpServerPacks: params.mcpServerPacks,
        }),
      },
    ],
    response_format: CEREBRAS_SELECTOR_RESPONSE_FORMAT,
  };

  const exec = async () => {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new LlmError(
        `Cerebras selector request failed: ${response.status} ${errorText}`.slice(
          0,
          1200,
        ),
        {
          code: 'provider',
          status: response.status,
          provider: 'cerebras',
          model,
        },
      );
    }

    const payload = (await response.json()) as CerebrasSelectorApiResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmError('Cerebras selector returned empty content', {
        code: 'invalid_output',
        provider: 'cerebras',
        model,
        requestId: payload.id,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new LlmError(
        `Cerebras selector returned non-JSON content: ${content}`.slice(0, 1200),
        {
          code: 'invalid_output',
          provider: 'cerebras',
          model,
          requestId: payload.id,
          cause: error,
        },
      );
    }

    return selectorOutputSchema.parse(parsed);
  };

  return withConcurrency(
    () =>
      withRetry(exec, {
        maxAttempts: 2,
        baseDelayMs: 250,
      }),
    {
      key: `${params.features.channel}.executive.selector`,
      maxConcurrency: 4,
    },
  );
}

/**
 * Bypass LLM routing only for flows that must stay deterministic.
 */
function selectDeterministicBypassSelection(
  params: {
    features: ExecutiveTurnFeatures;
  },
): PackSelection | null {
  const { features } = params;

  if (features.explicitSendApproval && features.draftCandidatePresent) {
    const packIds: ToolPackId[] = ['email_send_pack'];
    if (features.calendarMutationIntent) {
      packIds.push('calendar_mutation_pack');
    } else if (features.calendarQueryIntent || features.workloadOverviewIntent) {
      packIds.push('calendar_query_pack');
    }
    if (features.reminderIntent || features.alertIntent) {
      packIds.push('reminder_alert_pack');
    }

    return buildSelection({
      packIdOrPackIds: packIds,
      reasons: ['explicit send approval with recent unsent draft candidate'],
      reminders: ['User approval is present; only send the already-shown draft.'],
    });
  }

  if (
    features.pendingCalendarChangePresent &&
    (features.pendingCalendarConfirmIntent ||
      features.pendingCalendarCancelIntent)
  ) {
    const packIds: ToolPackId[] = ['calendar_mutation_pack'];
    if (features.reminderIntent || features.alertIntent) {
      packIds.push('reminder_alert_pack');
    }

    return buildSelection({
      packIdOrPackIds: packIds,
      reasons: [
        'pending calendar change exists and latest turn resolves it',
      ],
      reminders: ['A pending calendar change exists; confirm, cancel, or explicitly modify it.'],
    });
  }

  return null;
}

export async function selectExecutiveToolPackForTurn(params: {
  input: ExecutiveAgentInput;
  features: ExecutiveTurnFeatures;
}): Promise<PackSelection> {
  const mcpServerPacks = await listSelectableMcpServerPacks({
    userId: params.input.userId,
    channel: params.features.channel,
  });

  if (!isSelectorLlmEnabled(params.features.channel)) {
    return buildAllPackSelection({
      reasons: ['selector unavailable; exposed all packs'],
      mcpConnectionIds: mcpServerPacks.map((pack) => pack.connectionId),
    });
  }

  const bypassSelection = selectDeterministicBypassSelection({
    features: params.features,
  });
  if (bypassSelection) {
    return bypassSelection;
  }

  try {
    const object = await callCerebrasSelector({
      userRequest: params.input.userRequest,
      features: params.features,
      conversationHistory: params.input.conversationHistory,
      mcpServerPacks,
      abortSignal: params.input.abortSignal,
    });

    // Route through hard safety constraints.
    const llmPackIds = resolveSelectorPackIds(object);
    const safePackIds = uniquePackIds(
      llmPackIds.map((packId) => enforcePackSafety(packId, params.features)),
    );

    if (safePackIds.join(',') !== llmPackIds.join(',')) {
      logger.warn('[executiveAgent] selector.llm_safety_override', {
        llmPacks: llmPackIds,
        safePacks: safePackIds,
      });
    }

    const selection = buildSelection({
      packIdOrPackIds: safePackIds,
      reasons: ['llm selector'],
      reminders: getDefaultPackRemindersForSelection(safePackIds),
      mcpConnectionIds: (object.mcpServerKeys ?? [])
        .map((serverKey) => {
          return mcpServerPacks.find((pack) => pack.serverKey === serverKey)?.connectionId ?? null;
        })
        .filter((connectionId): connectionId is string => Boolean(connectionId)),
    });

    if (
      shouldInferPendingCalendarModifyFromLlmSelection({
        features: params.features,
        selection,
      })
    ) {
      return {
        ...selection,
        reasons: [...selection.reasons, 'llm selector inferred pending calendar draft modification'],
        reminders: addUniqueReminder(
          selection.reminders,
          'A pending calendar change exists; confirm, cancel, or explicitly modify it.',
        ),
      };
    }

    return selection;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('[executiveAgent] selector.llm_failed_expose_all_packs', {
      error: errorMessage,
    });
    return buildAllPackSelection({
      reasons: ['selector failed; exposed all packs'],
      mcpConnectionIds: mcpServerPacks.map((pack) => pack.connectionId),
    });
  }
}
