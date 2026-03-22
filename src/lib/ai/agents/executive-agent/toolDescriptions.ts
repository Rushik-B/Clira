type ProgressPhraseOptions = {
  mcpTools?: ReadonlyMap<string, { displayTitle: string; actionClass: string }>;
  variationIndex?: number;
  requestSeed?: string;
  sentCount?: number;
  elapsedMs?: number;
};

type ProgressActionClass = 'read' | 'write' | 'delete' | 'generic';

type ToolProgressDescriptor = {
  topic: string;
  actionClass: ProgressActionClass;
};

type ProgressStage = 'initial' | 'follow_up' | 'extended';

const TOOL_PROGRESS_PHRASES: Record<string, readonly string[]> = {
  search_inbox_context: [
    'checking your inbox rn',
    'digging through your emails',
    'one sec, looking at your inbox',
    'pulling up your inbox',
    'scanning through your emails',
  ],
  list_inbox_emails: [
    'grabbing your recent emails',
    'looking at your emails rn',
    'pulling up those emails',
    'checking your inbox real quick',
    'skimming your emails',
  ],
  search_calendar: [
    'one sec, checking ur calendar',
    'pulling up your schedule',
    'looking at your calendar rn',
    'checking what u have going on',
    'glancing at your schedule',
  ],
  check_calendar: [
    'one sec, checking ur calendar',
    'pulling up your schedule',
    'looking at your calendar rn',
    'checking what u have going on',
    'glancing at your schedule',
  ],
  search_web: [
    'checking the web rn',
    'pulling up current sources',
    'looking that up online',
    'checking public sources',
    'searching the web real quick',
  ],
  search_memory: [
    'checking my notes real quick',
    'pulling up my notes on that',
    'let me check what i wrote down',
    'looking at my notes rn',
    'one sec, checking what i remember',
  ],
  get_reply_preferences: [
    'checking how u usually reply',
    'pulling up your reply settings',
    'looking at your preferences rn',
    'one sec, checking your settings',
    'checking how u like this done',
  ],
  manage_reply_preferences: [
    'updating your preferences',
    'got it, changing how u reply',
    'tweaking those settings for u',
    'saving those preferences',
    'updating your reply style',
  ],
  plan_calendar_change: [
    'getting that calendar edit ready',
    'lining up the schedule change',
    'drafting up that calendar update',
    'working on the schedule change',
    'setting up the calendar update',
  ],
  commit_calendar_change: [
    'updated your calendar',
    'locked it in the schedule',
    'all set on the calendar',
    'added it to your schedule',
    'calendar is updated',
  ],
  add_email_alert: [
    'alert is set up',
    "i'll let u know when that comes in",
    'got it, keeping an eye out',
    'setting that alert up rn',
    'alert is good to go',
  ],
  remove_email_alert: [
    'turned off that alert',
    'got rid of the alert',
    'deleted that alert for u',
    'took that alert off',
    'alert is canceled',
  ],
  list_email_alerts: [
    'pulling up your alerts',
    'checking what alerts u have',
    'getting your active alerts rn',
    'looking at your alert list',
    'checking your alerts',
  ],
  add_reminder: [
    'reminder is set',
    "got it, i'll remind u",
    'locked in the reminder',
    'saved that reminder',
    'all set, reminder added',
  ],
  list_reminders: [
    'pulling up your reminders',
    'checking what u have coming up',
    'looking at your reminders rn',
    'grabbing your reminder list',
    'one sec, checking your reminders',
  ],
  snooze_reminder: [
    'snoozed it for later',
    'pushed that reminder back',
    'got it, snoozing that',
    'will remind u later',
    'snoozed that one',
  ],
  dismiss_reminder: [
    'cleared that reminder',
    'dismissed it',
    'marked that as done',
    'got it, dismissed',
    'cleared it out',
  ],
  cancel_reminder: [
    'canceled the reminder',
    'deleted that reminder for u',
    'got it, reminder is off',
    'took that off your list',
    'canceled it',
  ],
  read_email_attachment_content: [
    'reading the attachment rn',
    'opening up that attachment',
    'taking a look at the attached file',
    'scanning the attachment',
    'reading through the attachment',
  ],
  read_email_pdf_attachment: [
    'opening up the pdf',
    'reading through the pdf',
    'taking a look at the pdf',
    'scanning the pdf real quick',
    "checking what's in the pdf",
  ],
  read_content_reference: [
    'reading the file',
    'opening up the file',
    'taking a look at the file',
    'scanning the file rn',
    'reading through it',
  ],
  deliver_content_reference: [
    'getting that file ready',
    'pulling up the file for u',
    'grabbing that file',
    'preparing the file',
    'getting the file ready',
  ],
  append_to_supermemory: [
    'saved that to my notes',
    'got it, writing that down',
    'remembering that for later',
    'noted it down',
    'saved it',
  ],
  send_email: [
    'email sent',
    'sent it off',
    'just sent the email',
    'all good, sent',
    'whoosh, sent it',
  ],
  submit_draft: [
    'draft is ready',
    'wrote up a draft for u',
    'draft is in your folder',
    'got a draft ready to go',
    'drafted it up',
  ],
  plan_mcp_action: [
    'getting that change ready',
    'setting up the update',
    'lining up that change',
    'preparing the edit',
    'working on the update',
  ],
  commit_mcp_action: [
    'applied the change',
    'all set, updated it',
    'change went through',
    'done, applied it',
    'got it updated',
  ],
  cancel_mcp_action: [
    'canceled the change',
    'stopped the update',
    'got it, canceled',
    'aborted that change',
    'nvm, canceled it',
  ],
};

const TOOL_PROGRESS_DESCRIPTORS: Record<string, ToolProgressDescriptor> = {
  search_inbox_context: { topic: 'your inbox', actionClass: 'read' },
  list_inbox_emails: { topic: 'your emails', actionClass: 'read' },
  search_calendar: { topic: 'your calendar', actionClass: 'read' },
  check_calendar: { topic: 'your schedule', actionClass: 'read' },
  search_web: { topic: 'public web sources', actionClass: 'read' },
  search_memory: { topic: 'my notes on that', actionClass: 'read' },
  get_reply_preferences: { topic: 'your reply settings', actionClass: 'read' },
  manage_reply_preferences: { topic: 'your reply settings', actionClass: 'write' },
  plan_calendar_change: { topic: 'that calendar change', actionClass: 'write' },
  commit_calendar_change: { topic: 'that calendar change', actionClass: 'write' },
  add_email_alert: { topic: 'that alert', actionClass: 'write' },
  remove_email_alert: { topic: 'that alert', actionClass: 'delete' },
  list_email_alerts: { topic: 'your alerts', actionClass: 'read' },
  add_reminder: { topic: 'that reminder', actionClass: 'write' },
  list_reminders: { topic: 'your reminders', actionClass: 'read' },
  snooze_reminder: { topic: 'that reminder', actionClass: 'write' },
  dismiss_reminder: { topic: 'that reminder', actionClass: 'delete' },
  cancel_reminder: { topic: 'that reminder', actionClass: 'delete' },
  read_email_attachment_content: { topic: 'that attachment', actionClass: 'read' },
  read_email_pdf_attachment: { topic: 'that pdf', actionClass: 'read' },
  read_content_reference: { topic: 'that file', actionClass: 'read' },
  deliver_content_reference: { topic: 'that file', actionClass: 'read' },
  append_to_supermemory: { topic: 'my notes on that', actionClass: 'write' },
  send_email: { topic: 'that email', actionClass: 'write' },
  submit_draft: { topic: 'that draft', actionClass: 'write' },
  plan_mcp_action: { topic: 'that change', actionClass: 'write' },
  commit_mcp_action: { topic: 'that change', actionClass: 'write' },
  cancel_mcp_action: { topic: 'that change', actionClass: 'delete' },
};

const SUPPRESSED_TOOLS = new Set([
  'send_progress_update',
  'request_tool_pack_exposure',
  'request_skill_exposure',
  'request_mcp_server_tools',
]);

const PREFIXES_TO_STRIP = [
  'get',
  'list',
  'search',
  'find',
  'lookup',
  'fetch',
  'query',
  'read',
  'check',
  'create',
  'update',
  'set',
  'book',
  'schedule',
  'add',
  'append',
  'upsert',
  'delete',
  'remove',
  'cancel',
  'dismiss',
  'clear',
  'send',
  'run',
  'execute',
  'trigger',
  'publish',
  'commit',
];

function toWords(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeTopic(value: string): string {
  const words = toWords(value).split(/\s+/).filter(Boolean);

  while (words.length > 1 && PREFIXES_TO_STRIP.includes(words[0] ?? '')) {
    words.shift();
  }

  if (words[0] === 'my') {
    words[0] = 'your';
  }

  return words.join(' ').trim();
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function pickVariant(
  toolName: string,
  variants: readonly string[],
  variationIndex = 0,
  requestSeed?: string,
): string {
  const offset = hashSeed(`${toolName}:${requestSeed ?? 'default'}`) % variants.length;
  return variants[(offset + variationIndex) % variants.length]!;
}

function buildMcpProgressDescription(
  toolName: string,
  descriptor: { displayTitle: string; actionClass: string },
  variationIndex = 0,
  requestSeed?: string,
): string {
  const topic = normalizeTopic(descriptor.displayTitle || toolName);
  if (!topic) {
    return pickVariant(toolName, [
      'one sec, checking that',
      'looking into that rn',
      'pulling that up now',
      'gimme a sec to check',
      'working on that now',
    ], variationIndex, requestSeed);
  }

  if (descriptor.actionClass === 'read') {
    return pickVariant(toolName, [
      `one sec, checking ${topic}`,
      `looking at ${topic} now`,
      `pulling up ${topic}`,
      `checking ${topic} rn`,
      `digging into ${topic}`,
    ], variationIndex, requestSeed);
  }

  if (descriptor.actionClass === 'delete') {
    return pickVariant(toolName, [
      `got it, canceling ${topic}`,
      `taking ${topic} off now`,
      `removing ${topic} rn`,
      `one sec, canceling ${topic}`,
      `working on removing ${topic}`,
    ], variationIndex, requestSeed);
  }

  if (descriptor.actionClass === 'write') {
    return pickVariant(toolName, [
      `updating ${topic} now`,
      `working on ${topic} rn`,
      `one sec, setting up ${topic}`,
      `taking care of ${topic}`,
      `getting ${topic} sorted`,
    ], variationIndex, requestSeed);
  }

  return pickVariant(toolName, [
    `working on ${topic} rn`,
    `taking care of ${topic}`,
    `one sec, handling ${topic}`,
    `getting ${topic} sorted`,
    `on it, doing ${topic} now`,
  ], variationIndex, requestSeed);
}

function resolveProgressStage(options?: ProgressPhraseOptions): ProgressStage {
  const nextSequence = (options?.sentCount ?? 0) + 1;
  const elapsedMs = options?.elapsedMs ?? 0;

  if (nextSequence >= 3 || elapsedMs >= 45_000) {
    return 'extended';
  }

  if (nextSequence >= 2 || elapsedMs >= 20_000) {
    return 'follow_up';
  }

  return 'initial';
}

function inferActionClass(toolName: string): ProgressActionClass {
  const normalized = toWords(toolName);

  if (/^(get|list|search|find|lookup|fetch|query|read|check)\b/.test(normalized)) {
    return 'read';
  }

  if (/^(delete|remove|cancel|dismiss|clear)\b/.test(normalized)) {
    return 'delete';
  }

  if (/^(create|update|set|book|schedule|add|append|upsert|send|run|execute|trigger|publish|commit|plan|manage)\b/.test(normalized)) {
    return 'write';
  }

  return 'generic';
}

function inferNativeDescriptor(toolName: string): ToolProgressDescriptor {
  const known = TOOL_PROGRESS_DESCRIPTORS[toolName];
  if (known) {
    return known;
  }

  return {
    topic: normalizeTopic(toolName) || 'that',
    actionClass: inferActionClass(toolName),
  };
}

function buildStageVariants(
  topic: string,
  actionClass: ProgressActionClass,
  stage: Exclude<ProgressStage, 'initial'>,
): readonly string[] {
  if (stage === 'follow_up') {
    if (actionClass === 'delete') {
      return [
        `still removing ${topic}`,
        `still taking care of ${topic}`,
        `still working on canceling ${topic}`,
        `still getting ${topic} cleared out`,
        `still wrapping up ${topic}`,
      ];
    }

    if (actionClass === 'write') {
      return [
        `still working on ${topic}`,
        `still getting ${topic} sorted`,
        `still taking care of ${topic}`,
        `still finishing up ${topic}`,
        `still on ${topic}`,
      ];
    }

    if (actionClass === 'read') {
      return [
        `still checking ${topic}`,
        `still going through ${topic}`,
        `still looking through ${topic}`,
        `still on ${topic}`,
        `still pulling details from ${topic}`,
      ];
    }

    return [
      `still on ${topic}`,
      `still working through ${topic}`,
      `still checking ${topic}`,
      `still taking care of ${topic}`,
      `still sorting through ${topic}`,
    ];
  }

  if (actionClass === 'delete') {
    return [
      `still on ${topic}, just making sure it clears cleanly`,
      `this is taking a sec, still removing ${topic}`,
      `still wrapping up ${topic}`,
      `still working through ${topic}`,
      `taking a bit, still clearing ${topic}`,
    ];
  }

  if (actionClass === 'write') {
    return [
      `still on ${topic}, just making sure it goes through cleanly`,
      `this is taking a sec, still working on ${topic}`,
      `still wrapping up ${topic}`,
      `taking a bit, still getting ${topic} sorted`,
      `still at it with ${topic}`,
    ];
  }

  if (actionClass === 'read') {
    return [
      `still on this, going through ${topic}`,
      `this is taking a sec, still checking ${topic}`,
      `taking a bit, still going through ${topic}`,
      `still working through ${topic}, wanna make sure i get it right`,
      `still at it with ${topic}`,
    ];
  }

  return [
    `still on this, working through ${topic}`,
    `this is taking a sec, still checking ${topic}`,
    `taking a bit, still sorting through ${topic}`,
    `still at it with ${topic}`,
    `still working on ${topic}`,
  ];
}

function buildSequenceAwareProgressDescription(params: {
  toolName: string;
  topic: string;
  actionClass: ProgressActionClass;
  stage: Exclude<ProgressStage, 'initial'>;
  variationIndex: number;
  requestSeed?: string;
}): string {
  return pickVariant(
    params.toolName,
    buildStageVariants(params.topic, params.actionClass, params.stage),
    params.variationIndex,
    params.requestSeed,
  );
}

export function getToolProgressDescription(
  toolName: string,
  options?: ProgressPhraseOptions,
): string | null {
  if (SUPPRESSED_TOOLS.has(toolName)) {
    return null;
  }

  const variationIndex = options?.variationIndex ?? 0;
  const requestSeed = options?.requestSeed;
  const stage = resolveProgressStage(options);
  const mcpTool = options?.mcpTools?.get(toolName);
  if (mcpTool) {
    if (stage === 'initial') {
      return buildMcpProgressDescription(toolName, mcpTool, variationIndex, requestSeed);
    }

    return buildSequenceAwareProgressDescription({
      toolName,
      topic: normalizeTopic(mcpTool.displayTitle || toolName) || 'that',
      actionClass:
        mcpTool.actionClass === 'read' || mcpTool.actionClass === 'write' || mcpTool.actionClass === 'delete'
          ? mcpTool.actionClass
          : 'generic',
      stage,
      variationIndex,
      requestSeed,
    });
  }

  const phrases = TOOL_PROGRESS_PHRASES[toolName];
  if (!phrases || phrases.length === 0) {
    return null;
  }

  if (stage === 'initial') {
    return pickVariant(toolName, phrases, variationIndex, requestSeed);
  }

  const descriptor = inferNativeDescriptor(toolName);
  return buildSequenceAwareProgressDescription({
    toolName,
    topic: descriptor.topic,
    actionClass: descriptor.actionClass,
    stage,
    variationIndex,
    requestSeed,
  });
}
