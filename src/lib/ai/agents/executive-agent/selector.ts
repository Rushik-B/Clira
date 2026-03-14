import { z } from 'zod';
import { withConcurrency } from '@/lib/ai/concurrency';
import { LlmError } from '@/lib/ai/errors';
import { withRetry } from '@/lib/ai/retry';
import { logger } from '@/lib/logger';
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

function buildAllPackSelection(reasons: string[], reminders: string[] = []): PackSelection {
  return buildSelection([...TOOL_PACK_IDS], reasons, reminders);
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

  const replyPreferenceIntent =
    /\b(?:always|never|whenever|every time|from now on)\b/.test(latestMessage) &&
      /\b(?:reply|respond|email|emails)\b/.test(latestMessage) &&
      /\b(?:tone|informal|formal|shorter|short|longer|brief|sign off|signoff|end with|ending|calendar times|volunteer|mention|say)\b/.test(
        latestMessage,
      ) ||
    hasAnyPhrase(latestMessage, [
      'always reply',
      'when replying',
      'for replies to',
      'reply to my mom',
      'reply to my manager',
      'keep replies shorter',
      'end with',
      'never volunteer calendar times',
    ]);

  return {
    explicitSendApproval,
    draftCandidatePresent: draftCandidate.present,
    pendingCalendarChangePresent: params.pendingCalendarChangePresent,
    calendarMutationIntent: calendarMutationIntent || pendingCalendarModifyIntent,
    calendarQueryIntent,
    workloadOverviewIntent,
    reminderIntent,
    alertIntent,
    replyPreferenceIntent,
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

function buildSelection(
  packIdOrPackIds: ToolPackId | readonly ToolPackId[],
  reasons: string[],
  reminders: string[] = [],
): PackSelection {
  const packIds = uniquePackIds(
    Array.isArray(packIdOrPackIds) ? packIdOrPackIds : [packIdOrPackIds],
  );
  const normalizedPackIds: ToolPackId[] =
    packIds.length > 0 ? packIds : ['core_recall_pack'];

  return {
    packId: normalizedPackIds[0],
    packIds: normalizedPackIds,
    reasons,
    reminders,
  };
}

const toolPackIdSchema = z.enum(TOOL_PACK_IDS);

const selectorOutputSchema = z
  .object({
    packId: toolPackIdSchema.optional(),
    packIds: z.array(toolPackIdSchema).min(1).max(TOOL_PACK_IDS.length).optional(),
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
  maxMessages = 6,
  staleCutoffMs = 30 * 60 * 1000, // 30 minutes
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
      const content = (msg.content ?? '').slice(0, 300);
      return `[${time}] ${role}: ${content}`;
    })
    .join('\n');
}

function buildSelectorPrompt(params: {
  userRequest: string;
  features: ExecutiveTurnFeatures;
  conversationHistory: ConversationMessageDTO[];
}): string {
  const { userRequest, features, conversationHistory } = params;

  return [
    'Pick one or more packIds for the user message.',
    'Return multiple packs only when the same turn genuinely needs multiple tool families.',
    'Order matters: put the primary pack first.',
    '',
    'core_recall_pack — personal facts, memory, preferences',
    'inbox_context_pack — email lookup, what someone said/wrote, drafting',
    'calendar_query_pack — read calendar, check availability, workload overview',
    'calendar_mutation_pack — create/move/cancel calendar events; includes anaphoric "add it", "put it in my cal", "book it"',
    'reminder_alert_pack — set/snooze/dismiss reminders or email alerts',
    'settings_mutation_pack — save standing reply preferences for planner/style behavior',
    'email_send_pack — send approved draft (only when draftCandidatePresent=true AND explicitSendApproval=true)',
    '',
    'Examples:',
    '"when is my next meeting?" → calendar_query_pack',
    '"block tomorrow 2-3pm" → calendar_mutation_pack',
    '"add that to my calendar" → calendar_mutation_pack',
    '"put it in my cal too" → calendar_mutation_pack',
    '"what did alex say in his email?" → inbox_context_pack',
    '"draft a reply to sarah" → inbox_context_pack',
    '"who is my manager?" → core_recall_pack',
    '"when was my whistler trip?" → core_recall_pack',
    '"remind me in an hour" → reminder_alert_pack',
    '"always reply to my mom informally and end with love you" → settings_mutation_pack',
    '"keep replies shorter by default" → settings_mutation_pack',
    '"never volunteer calendar times unless i ask" → settings_mutation_pack',
    '"remind me on march 9 at 9pm and put it on my calendar" → ["calendar_mutation_pack", "reminder_alert_pack"]',
    '"yes send it" [draftCandidatePresent=true] → email_send_pack',
    '',
    `State: draftCandidatePresent=${features.draftCandidatePresent}, explicitSendApproval=${features.explicitSendApproval}, pendingCalendarChangePresent=${features.pendingCalendarChangePresent}`,
    '',
    'Recent conversation:',
    formatRecentHistory(conversationHistory),
    '',
    `User: ${userRequest}`,
    '',
    'Return JSON: { "packIds": ["...", "..."] }',
  ].join('\n');
}

async function callCerebrasSelector(params: {
  userRequest: string;
  features: ExecutiveTurnFeatures;
  conversationHistory: ConversationMessageDTO[];
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
          'You are a routing classifier for executive tool packs. Return strict JSON only.',
      },
      {
        role: 'user',
        content: buildSelectorPrompt({
          userRequest: params.userRequest,
          features: params.features,
          conversationHistory: params.conversationHistory,
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
  features: ExecutiveTurnFeatures,
): PackSelection | null {
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

    return buildSelection(
      packIds,
      ['explicit send approval with recent unsent draft candidate'],
      ['User approval is present; only send the already-shown draft.'],
    );
  }

  if (
    features.pendingCalendarChangePresent &&
    (features.pendingCalendarConfirmIntent ||
      features.pendingCalendarCancelIntent ||
      features.pendingCalendarModifyIntent)
  ) {
    const packIds: ToolPackId[] = ['calendar_mutation_pack'];
    if (features.reminderIntent || features.alertIntent) {
      packIds.push('reminder_alert_pack');
    }

    return buildSelection(
      packIds,
      [
        features.pendingCalendarModifyIntent
          ? 'pending calendar change exists and latest turn explicitly modifies the plan'
          : 'pending calendar change exists and latest turn resolves it',
      ],
      ['A pending calendar change exists; confirm, cancel, or explicitly modify it.'],
    );
  }

  if (features.replyPreferenceIntent) {
    const packIds: ToolPackId[] = ['settings_mutation_pack'];
    if (features.reminderIntent || features.alertIntent) {
      packIds.push('reminder_alert_pack');
    } else if (features.calendarMutationIntent) {
      packIds.push('calendar_mutation_pack');
    } else if (features.calendarQueryIntent || features.workloadOverviewIntent) {
      packIds.push('calendar_query_pack');
    }

    return buildSelection(
      packIds,
      ['standing reply preference update intent detected'],
      ['Update explicit planner/style reply instructions before continuing.'],
    );
  }

  return null;
}

export async function selectExecutiveToolPackForTurn(params: {
  input: ExecutiveAgentInput;
  features: ExecutiveTurnFeatures;
}): Promise<PackSelection> {
  if (!isSelectorLlmEnabled(params.features.channel)) {
    return buildAllPackSelection(['selector unavailable; exposed all packs']);
  }

  const bypassSelection = selectDeterministicBypassSelection(params.features);
  if (bypassSelection) {
    return bypassSelection;
  }

  try {
    const object = await callCerebrasSelector({
      userRequest: params.input.userRequest,
      features: params.features,
      conversationHistory: params.input.conversationHistory,
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

    return buildSelection(
      safePackIds,
      ['llm selector'],
      getDefaultPackRemindersForSelection(safePackIds),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('[executiveAgent] selector.llm_failed_expose_all_packs', {
      error: errorMessage,
    });
    return buildAllPackSelection(['selector failed; exposed all packs']);
  }
}
