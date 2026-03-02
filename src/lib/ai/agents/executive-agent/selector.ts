import { z } from 'zod';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
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
  hasRecentSendSuccess: boolean;
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
        hasRecentSendSuccess: true,
      };
    }

    return {
      present: true,
      reason: 'recent assistant draft markers found',
      hasRecentSendSuccess: latestSendSuccessIndex !== -1,
    };
  }

  return {
    present: false,
    reason:
      latestSendSuccessIndex !== -1
        ? 'recent send_email success found but no unsent draft markers remain'
        : 'no recent assistant draft markers found',
    hasRecentSendSuccess: latestSendSuccessIndex !== -1,
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

  const pendingCalendarConfirmIntent =
    params.pendingCalendarChangePresent &&
    (explicitSendApproval ||
      hasAnyPhrase(latestMessage, ['confirm', 'approved', 'approve']) ||
      isExactShortReply(latestMessage, ['sure', 'do it']));

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

  const calendarMutationIntent =
    /\b(?:schedule|reschedule|move|push|shift|cancel|delete|remove|create|book)\b/.test(
      latestMessage,
    ) &&
    /\b(?:meeting|meetings|calendar|event|events|call|calls|1:1|appointment|appointments)\b/.test(
      latestMessage,
    );

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

  const recallIntent =
    !emailIntent &&
    !calendarMutationIntent &&
    !calendarQueryIntent &&
    /\b(?:remember|recall|my manager|my professor|my stats professor|who is my|what is my|told you|did i tell you|again)\b/.test(
      latestMessage,
    );

  const ambiguousEmailLike =
    !emailIntent &&
    !calendarMutationIntent &&
    (mentionsCommunicationContent ||
      /\b(?:alex|jake|sarah)\b/.test(latestMessage));

  const ambiguousCalendarLike =
    !calendarMutationIntent &&
    !ambiguousEmailLike &&
    /\b(?:meeting|calendar|event|events|availability|tomorrow|today|friday|monday|next week)\b/.test(
      latestMessage,
    );

  return {
    explicitSendApproval,
    explicitSendDecline,
    draftCandidatePresent: draftCandidate.present,
    pendingCalendarChangePresent: params.pendingCalendarChangePresent,
    calendarMutationIntent:
      calendarMutationIntent ||
      pendingCalendarModifyIntent,
    calendarQueryIntent,
    workloadOverviewIntent,
    emailIntent,
    reminderIntent,
    alertIntent,
    recallIntent,
    classifierDecision: params.input.runContext?.classifierDecision ?? null,
    channel: params.input.channel,
    hasRecentSendSuccess: draftCandidate.hasRecentSendSuccess,
    hasRecentPendingCalendarPreview: pendingPreviewPresent,
    pendingCalendarConfirmIntent,
    pendingCalendarCancelIntent,
    pendingCalendarModifyIntent,
    ambiguousCalendarLike,
    ambiguousEmailLike,
    draftCandidateReason: draftCandidate.reason,
  };
}

function buildSelection(packId: ToolPackId, reasons: string[], reminders: string[] = []): PackSelection {
  return { packId, reasons, reminders };
}

const selectorOutputSchema = z.object({
  packId: z.enum([
    'core_recall_pack',
    'inbox_context_pack',
    'calendar_query_pack',
    'calendar_mutation_pack',
    'reminder_alert_pack',
    'email_send_pack',
  ]),
  reason: z.string().min(1).max(220),
  confidence: z.number().min(0).max(1),
});

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

/**
 * Minimum confidence required before accepting the LLM selector output.
 * Values are clamped to [0, 1]. Invalid input falls back to 0.55.
 */
function getSelectorMinConfidence(): number {
  const raw = Number.parseFloat(process.env.EA_SELECTOR_LLM_MIN_CONFIDENCE ?? '0.55');
  if (!Number.isFinite(raw)) return 0.55;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Mirrors reminder copy used by deterministic pack selection so LLM-selected
 * read-only packs preserve the same user-facing constraints.
 */
function getDefaultPackReminders(packId: ToolPackId): string[] {
  if (
    packId === 'core_recall_pack' ||
    packId === 'inbox_context_pack' ||
    packId === 'calendar_query_pack'
  ) {
    return ['Only context tools are available this turn.'];
  }
  return [];
}

/**
 * Bypass LLM routing for flows that are safety-critical or already explicit.
 * These branches are handled deterministically to avoid accidental escalation.
 */
function shouldBypassLlmSelector(features: ExecutiveTurnFeatures): boolean {
  return (
    (features.explicitSendApproval && features.draftCandidatePresent) ||
    (features.pendingCalendarChangePresent &&
      (features.pendingCalendarConfirmIntent ||
        features.pendingCalendarCancelIntent ||
        features.pendingCalendarModifyIntent)) ||
    features.calendarMutationIntent ||
    features.reminderIntent ||
    features.alertIntent
  );
}

/**
 * Final safety firewall for any non-deterministic selector output.
 * If an unsafe pack is suggested, downgrade to the nearest safe read-only pack.
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

  if (packId === 'calendar_mutation_pack') {
    const canMutateCalendar =
      features.calendarMutationIntent ||
      (features.pendingCalendarChangePresent &&
        (features.pendingCalendarConfirmIntent ||
          features.pendingCalendarCancelIntent ||
          features.pendingCalendarModifyIntent));
    if (!canMutateCalendar) {
      return 'calendar_query_pack';
    }
  }

  return packId;
}

/**
 * Compact classifier prompt for the optional LLM router.
 * We provide extracted features as the source of truth to reduce prompt variance
 * and keep routing decisions deterministic across equivalent paraphrases.
 */
function buildSelectorPrompt(params: {
  userRequest: string;
  features: ExecutiveTurnFeatures;
}): string {
  const { userRequest, features } = params;
  return [
    'You route the current user message to exactly one executive tool pack.',
    'Choose the MINIMUM safe pack that still has enough tools to answer well.',
    '',
    'Pack semantics:',
    '- core_recall_pack: memory recall only',
    '- inbox_context_pack: email/comms context lookups',
    '- calendar_query_pack: read-only calendar/inbox context',
    '- calendar_mutation_pack: planning/committing calendar edits',
    '- reminder_alert_pack: reminder/alert CRUD actions',
    '- email_send_pack: send an already approved existing draft',
    '',
    'Hard constraints:',
    '- Never pick email_send_pack without explicit send approval + draft candidate present.',
    '- Never pick calendar_mutation_pack unless this turn/pending state clearly asks for calendar mutation.',
    '',
    `User message: ${userRequest}`,
    '',
    'Extracted turn features (truth):',
    JSON.stringify(features),
    '',
    'Return JSON with packId, reason, confidence (0-1).',
  ].join('\n');
}

export function selectExecutiveToolPack(
  features: ExecutiveTurnFeatures,
): PackSelection {
  if (features.explicitSendApproval && features.draftCandidatePresent) {
    return buildSelection(
      'email_send_pack',
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
    return buildSelection(
      'calendar_mutation_pack',
      [
        features.pendingCalendarModifyIntent
          ? 'pending calendar change exists and latest turn explicitly modifies the plan'
          : 'pending calendar change exists and latest turn resolves it',
      ],
      ['A pending calendar change exists; confirm, cancel, or explicitly modify it.'],
    );
  }

  if (features.calendarMutationIntent) {
    return buildSelection(
      'calendar_mutation_pack',
      ['latest turn clearly requests calendar mutation behavior'],
    );
  }

  if (features.reminderIntent || features.alertIntent) {
    return buildSelection(
      'reminder_alert_pack',
      [
        features.reminderIntent
          ? 'latest turn is reminder-oriented'
          : 'latest turn is alert-oriented',
      ],
    );
  }

  if (features.workloadOverviewIntent) {
    return buildSelection(
      'calendar_query_pack',
      ['latest turn asks for workload/deadline overview'],
      ['Only context tools are available this turn.'],
    );
  }

  if (features.calendarQueryIntent) {
    return buildSelection(
      'calendar_query_pack',
      ['latest turn is calendar-oriented but read-only'],
      ['Only context tools are available this turn.'],
    );
  }

  if (features.emailIntent) {
    return buildSelection(
      'inbox_context_pack',
      ['latest turn is email/comms-oriented without send approval'],
      ['Only context tools are available this turn.'],
    );
  }

  if (features.recallIntent) {
    return buildSelection(
      'core_recall_pack',
      ['latest turn is recall-oriented'],
      ['Only context tools are available this turn.'],
    );
  }

  if (
    features.classifierDecision === 'ambiguous' &&
    features.ambiguousCalendarLike
  ) {
    return buildSelection(
      'calendar_query_pack',
      ['ambiguous turn failed open to calendar read tools'],
      ['Only context tools are available this turn.'],
    );
  }

  if (
    features.classifierDecision === 'ambiguous' &&
    features.ambiguousEmailLike
  ) {
    return buildSelection(
      'inbox_context_pack',
      ['ambiguous turn failed open to inbox read tools'],
      ['Only context tools are available this turn.'],
    );
  }

  return buildSelection(
    'core_recall_pack',
    ['defaulted to smallest recall pack'],
    ['Only context tools are available this turn.'],
  );
}

export async function selectExecutiveToolPackForTurn(params: {
  input: ExecutiveAgentInput;
  features: ExecutiveTurnFeatures;
}): Promise<PackSelection> {
  // Baseline deterministic selector is always available and is used as fallback
  // for disabled, low-confidence, or failed LLM selector runs.
  const deterministic = selectExecutiveToolPack(params.features);

  if (!isSelectorLlmEnabled(params.features.channel)) {
    return deterministic;
  }

  if (shouldBypassLlmSelector(params.features)) {
    return deterministic;
  }

  try {
    const { object } = await callObject<z.infer<typeof selectorOutputSchema>>({
      model: models.execSelector(),
      system:
        'You are a routing classifier for executive tool packs. Return strict JSON only.',
      prompt: buildSelectorPrompt({
        userRequest: params.input.userRequest,
        features: params.features,
      }),
      schema: selectorOutputSchema,
      temperature: 0,
      op: `${params.features.channel}.executive.selector`,
      concurrency: {
        key: `${params.features.channel}.executive.selector`,
        maxConcurrency: 4,
      },
      retry: { maxAttempts: 2, baseDelayMs: 250 },
      abortSignal: params.input.abortSignal,
    });

    if (object.confidence < getSelectorMinConfidence()) {
      logger.info('[executiveAgent] selector.llm_low_confidence_fallback', {
        confidence: object.confidence,
        minConfidence: getSelectorMinConfidence(),
        llmPack: object.packId,
      });
      return deterministic;
    }

    // Even with high confidence, route through hard safety constraints.
    const safePack = enforcePackSafety(object.packId, params.features);
    if (safePack !== object.packId) {
      logger.warn('[executiveAgent] selector.llm_safety_override', {
        llmPack: object.packId,
        safePack,
        reason: object.reason,
      });
    }

    return buildSelection(
      safePack,
      [`llm selector: ${object.reason}`],
      getDefaultPackReminders(safePack),
    );
  } catch (error) {
    logger.warn('[executiveAgent] selector.llm_failed_fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministic;
  }
}
