import { z } from 'zod';
import { readPromptFile } from '@/lib/prompts';
import type { EmailMessage } from '@/lib/email/emailFilterService';
import { callTextWithTools } from '@/lib/ai/callLlm';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { ReplyPlanSchema, type ReplyPlanDTO } from '@/lib/ai/schemas/schemas';
import { pruneEmailContentForPlanning } from '@/lib/services/onboarding-services/utils/emailPruner';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import {
  getCalendarSnapshot,
  gatherDirectEmailHistoryForReply,
  gatherKeywordEmailContextForReply,
  gatherThreadContextForReply,
  gatherMemoryContextForReply,
} from '@/lib/services/core/replyContextTools';
import { runCalendarAnalysis } from '@/lib/ai/agents/calendarAnalysisSubagent';
import { CalendarAnalysisInputSchema } from '@/lib/ai/schemas/calendarAnalysisSchemas';
import { runLabelAnalysis } from '@/lib/ai/agents/labelAnalysisSubagent';
import { normalizeIsoDateInputToUtc } from '@/lib/utils/timezone';
import { GmailLabelClassifier } from '@/lib/services/utils/gmailLabelClassifier';
import type { AiTraceContext } from '@/lib/ai/tracing';
import {
  wrapToolsWithAiTracing,
} from '@/lib/ai/tracing';
import {
  LabelAnalysisResultSchema,
  type LabelAnalysisResultDTO,
  type AvailableLabelDTO,
  type CurrentLabelDTO,
} from '@/lib/ai/schemas/labelAnalysisSchemas';

export type ReplyPlannerAgentInput = {
  userId: string;
  userEmail: string;
  message: EmailMessage;
  receivedAt: Date;
  threadId?: string | null;
  mailboxId?: string;
  abortSignal?: AbortSignal;
  /**
   * When true, throw on Planner failures instead of falling back.
   * Useful for deterministic testing (Injection Harness).
   */
  strict?: boolean;
  traceContext?: AiTraceContext;
};

function asCsv(values: string[] | undefined): string {
  if (!values || values.length === 0) return '';
  return values.join(', ');
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

/**
 * Context computed during prompt building that is also needed by the tools.
 */
type PlannerPromptContext = {
  prompt: string;
  prunedBody: string;
  userTimezone: string;
  currentTimeUtc: string;
  currentTimeUserTz: string;
  dayOfWeek: string;
  currentDate: string;
};

async function buildReplyPlannerPrompt(input: ReplyPlannerAgentInput): Promise<PlannerPromptContext> {
  const template = readPromptFile('core-processing/replyPlannerPrompt.md');

  const prunedBody = pruneEmailContentForPlanning({
    subject: input.message.subject,
    body: input.message.body,
  }).prunedBody;

  const userSettings = await prisma.userSettings.findUnique({
    where: { userId: input.userId },
    select: { calendarTimezone: true },
  });

  const userTimezone = userSettings?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE;

  const now = new Date();
  const currentTimeUtc = now.toISOString();

  let currentTimeUserTz = currentTimeUtc;
  let dayOfWeek = '';
  let currentDate = '';

  try {
    currentTimeUserTz = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: userTimezone,
    }).format(now);

    dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: userTimezone }).format(
      now,
    );

    currentDate = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: userTimezone,
    }).format(now);
  } catch {
    // If timezone is invalid/unavailable, keep UTC-derived defaults.
    dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
    currentDate = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(
      now,
    );
  }

  const prompt = template
    .replace('{currentTimeUtc}', currentTimeUtc)
    .replace('{userTimezone}', userTimezone)
    .replace('{currentTimeUserTz}', currentTimeUserTz)
    .replace('{dayOfWeek}', dayOfWeek)
    .replace('{currentDate}', currentDate)
    .replace('{userEmail}', safeString(input.userEmail))
    .replace('{fromEmail}', safeString(input.message.from))
    .replace('{toEmails}', asCsv(input.message.to))
    .replace('{ccEmails}', asCsv(input.message.cc))
    .replace('{subject}', safeString(input.message.subject))
    .replace('{labelIds}', asCsv(input.message.labelIds))
    .replace('{emailDate}', input.receivedAt.toISOString())
    .replace('{threadId}', safeString(input.threadId ?? ''))
    .replace('{body}', prunedBody);

  return {
    prompt,
    prunedBody,
    userTimezone,
    currentTimeUtc,
    currentTimeUserTz,
    dayOfWeek,
    currentDate,
  };
}

function minimalFallbackPlan(input: ReplyPlannerAgentInput, reason: string): ReplyPlanDTO {
  return {
    thoughtProcess: `Planner fallback used: ${reason}`,
    mustAddress: [
      `Acknowledge the email about "${input.message.subject}".`,
      'Respond to the sender’s request or question using only facts present in the email.',
      'Avoid making specific commitments if key details are missing.',
    ],
    factsToPreserve: [
      {
        fact: `Email subject: ${input.message.subject}`,
        source: 'email',
        confidence: 95,
      },
    ],
    recommendedTone: {
      label: 'professional, concise, helpful',
      constraints: 'Do not commit to specifics without confirmation.',
    },
    ccSuggestions: [],
    draft: `Thanks for reaching out — I saw your note about "${input.message.subject}".\n\nI’ll review this and follow up with the appropriate next step.\n\nBest,\n${input.userEmail}`,
    toolUsage: {
      calendarUsed: false,
      threadUsed: false,
      directEmailHistoryUsed: false,
      keywordEmailSearchUsed: false,
      memorySearchUsed: false,
      labelingUsed: false,
    },
  };
}

function collectToolNames(toolCalls: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(toolCalls)) return names;

  for (const call of toolCalls) {
    if (!call || typeof call !== 'object') continue;

    const candidate =
      (call as any).toolName ??
      (call as any).name ??
      (call as any).tool ??
      (call as any).function?.name ??
      (call as any).functionName;

    if (typeof candidate === 'string' && candidate.length > 0) {
      names.add(candidate);
    }
  }

  return names;
}

// TOOL USAGE TRACKING: Collect tool names from tool results and steps.

function collectToolNamesFromResults(toolResults: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(toolResults)) return names;
  for (const item of toolResults) {
    if (!item || typeof item !== 'object') continue;
    const candidate =
      (item as any).toolName ??
      (item as any).name ??
      (item as any).tool ??
      (item as any).function?.name ??
      (item as any).functionName;
    if (typeof candidate === 'string' && candidate.length > 0) names.add(candidate);
  }
  return names;
}

function collectToolNamesFromExecution({
  toolCalls,
  toolResults,
  steps,
}: {
  toolCalls: unknown;
  toolResults: unknown;
  steps: unknown;
}): Set<string> {
  const names = new Set<string>();
  const add = (set: Set<string>) => {
    for (const n of set) names.add(n);
  };

  add(collectToolNames(toolCalls));
  add(collectToolNamesFromResults(toolResults));

  if (Array.isArray(steps)) {
    for (const step of steps) {
      add(collectToolNames((step as any)?.toolCalls));
      add(collectToolNamesFromResults((step as any)?.toolResults));
    }
  }

  return names;
}

function stopWhenToolCalled(toolName: string) {
  return ({ steps }: any) => {
    if (!Array.isArray(steps)) return false;
    for (const step of steps) {
      const calls = (step as any)?.toolCalls;
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        const name =
          (call as any)?.toolName ??
          (call as any)?.name ??
          (call as any)?.tool ??
          (call as any)?.function?.name ??
          (call as any)?.functionName;
        if (name === toolName) return true;
      }
    }
    return false;
  };
}

function extractPlanFromToolResults(toolResults: unknown): ReplyPlanDTO | null {
  if (!Array.isArray(toolResults)) return null;
  for (const item of toolResults) {
    const tr = item as any;
    if (tr?.toolName === 'submit_reply_plan') {
      const parsed = ReplyPlanSchema.safeParse(tr.result);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

function extractPlanFromSteps(steps: unknown): ReplyPlanDTO | null {
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const plan = extractPlanFromToolResults((step as any)?.toolResults);
    if (plan) return plan;
  }
  return null;
}

function extractLabelAnalysisFromToolResults(
  toolResults: unknown,
): LabelAnalysisResultDTO | null {
  if (!Array.isArray(toolResults)) return null;
  let latest: LabelAnalysisResultDTO | null = null;
  for (const item of toolResults) {
    const tr = item as any;
    if (tr?.toolName !== 'analyze_labels') continue;
    const parsed = LabelAnalysisResultSchema.safeParse(tr.result);
    if (parsed.success) {
      latest = parsed.data;
    }
  }
  return latest;
}

function extractLabelAnalysisFromSteps(steps: unknown): LabelAnalysisResultDTO | null {
  if (!Array.isArray(steps)) return null;
  let latest: LabelAnalysisResultDTO | null = null;
  for (const step of steps) {
    const fromStep = extractLabelAnalysisFromToolResults((step as any)?.toolResults);
    if (fromStep) {
      latest = fromStep;
    }
  }
  return latest;
}

function safeJsonForPrompt(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function recoverPlanViaSchema({
  input,
  prompt,
  toolCalls,
  toolResults,
  modelText,
  abortSignal,
  traceContext,
}: {
  input: ReplyPlannerAgentInput;
  prompt: string;
  toolCalls: unknown;
  toolResults: unknown;
  modelText: string | undefined;
  abortSignal?: AbortSignal;
  traceContext?: AiTraceContext;
}): Promise<ReplyPlanDTO> {
  const repairPrompt = [
    prompt,
    '',
    '---',
    'The model used tools but did not call submit_reply_plan.',
    'Return a valid ReplyPlan object that matches the schema exactly.',
    '',
    'Raw model output (if any):',
    modelText ? truncate(modelText, 12000) : '(empty)',
    '',
    'Tool calls:',
    toolCalls ? truncate(safeJsonForPrompt(toolCalls), 12000) : '(none)',
    '',
    'Tool results:',
    toolResults ? truncate(safeJsonForPrompt(toolResults), 12000) : '(none)',
    '',
    `User email: ${input.userEmail}`,
  ].join('\n');

  const repaired = await callObject<ReplyPlanDTO>({
    model: models.pro(),
    system:
      'You are an email reply Planner. Using ONLY the provided email + tool context, return a ReplyPlan object. Never invent facts. Do not include markdown or extra keys.',
    prompt: repairPrompt,
    schema: ReplyPlanSchema,
    temperature: 0.2,
    op: 'reply.planner.recover',
    concurrency: { key: 'reply.planner', maxConcurrency: 2 },
    retry: { maxAttempts: 2, baseDelayMs: 800 },
    abortSignal,
    traceContext,
  });

  return repaired.object;
}

async function forceSubmitPlanFromContext({
  prompt,
  toolCalls,
  toolResults,
  abortSignal,
  traceContext,
}: {
  prompt: string;
  toolCalls: unknown;
  toolResults: unknown;
  abortSignal?: AbortSignal;
  traceContext?: AiTraceContext;
}): Promise<ReplyPlanDTO | null> {
  // Second pass that exposes ONLY the submit tool. This prevents re-running expensive tools
  // and focuses the model on producing a schema-valid plan as tool arguments.
  const finalizePrompt = [
    prompt,
    '',
    '---',
    'You MUST now call submit_reply_plan.',
    'You may NOT call any other tools.',
    'Use the tool results below as your only evidence and produce the final ReplyPlan.',
    '',
    'Tool calls:',
    toolCalls ? truncate(safeJsonForPrompt(toolCalls), 12000) : '(none)',
    '',
    'Tool results:',
    toolResults ? truncate(safeJsonForPrompt(toolResults), 12000) : '(none)',
  ].join('\n');

  const tools = {
    submit_reply_plan: {
      description:
        'Submit the final ReplyPlan. This ends planning; do not output anything else. The plan MUST match the schema exactly.',
      inputSchema: ReplyPlanSchema,
      execute: async (plan: ReplyPlanDTO) => plan,
    },
  };

  const { toolResults: finalizeToolResults, steps: finalizeSteps } = await callTextWithTools({
    model: models.pro(),
    system:
      'Call submit_reply_plan with a ReplyPlan object that matches the schema exactly. Do not output any other text.',
    prompt: finalizePrompt,
    tools,
    maxSteps: 2,
    stopWhen: stopWhenToolCalled('submit_reply_plan'),
    temperature: 0.2,
    op: 'reply.planner.finalize',
    concurrency: { key: 'reply.planner', maxConcurrency: 2 },
    retry: { maxAttempts: 2, baseDelayMs: 800 },
    abortSignal,
    traceContext,
  });

  return extractPlanFromToolResults(finalizeToolResults) ?? extractPlanFromSteps(finalizeSteps);
}

/**
 * Planner Agent (Brain): tool-using agent that produces a typed ReplyPlan.
 */
export class ReplyPlannerAgent {
  async plan(input: ReplyPlannerAgentInput): Promise<ReplyPlanDTO> {
    const promptContext = await buildReplyPlannerPrompt(input);
    const {
      prompt,
      prunedBody,
      userTimezone,
      currentTimeUtc,
      currentTimeUserTz,
      dayOfWeek,
    } = promptContext;

    // Check if automatic sorting is enabled to determine if labeling should be mandatory
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId: input.userId },
      select: { autoSortingEnabled: true },
    });
    const autoSortingEnabled = userSettings?.autoSortingEnabled ?? false;
    logger.info(
      `[replyPlanner] autoSortingEnabled=${autoSortingEnabled} for userId=${input.userId}, ` +
        `labeling tool will be ${autoSortingEnabled ? 'MANDATORY' : 'disabled'}`,
    );

    // Calendar Analysis Subagent tool input (replaces the raw get_calendar tool)
    const calendarAnalysisToolInput = z
      .object({
        start_date: z.string().describe('Start date in ISO format (e.g., "2026-01-07" or "2026-01-07T09:00:00")'),
        end_date: z.string().describe('End date in ISO format (e.g., "2026-01-07" or "2026-01-08T18:00:00")'),
        duration_needed: z
          .string()
          .optional()
          .describe('How long the meeting/event needs to be (e.g., "30 minutes", "1 hour")'),
        preferences: z
          .string()
          .optional()
          .describe('Scheduling preferences (e.g., "prefer mornings", "avoid Fridays", "after 2pm")'),
        meeting_context: z
          .string()
          .optional()
          .describe('Brief context about the meeting purpose (helps prioritize slots)'),
      })
      .strict();

    const threadToolInput = z.object({ threadId: z.string().min(1) }).strict();
    const directHistoryToolInput = z
      .object({
        senderEmail: z.string().min(1).max(320),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict();
    const keywordContextToolInput = z
      .object({
        keywords: z.array(z.string().min(1).max(80)).min(1).max(8),
        dateWindowHint: z.enum(['recent', 'last_month']).optional(),
        maxResults: z.number().int().min(1).max(50).optional(),
        senderFilter: z.array(z.string().min(1).max(320)).optional(),
      })
      .strict();
    const memorySearchToolInput = z
      .object({
        query: z.string().min(1).max(300),
        limit: z.number().int().min(1).max(10).optional(),
      })
      .strict();

    // Prepare email context for the calendar subagent (once, reused across calls)
    const emailContextForCalendar = {
      subject: safeString(input.message.subject),
      fromEmail: safeString(input.message.from),
      bodySnippet: truncate(prunedBody, 400),
    };

    // Prepare current time context (shared with subagent)
    const currentTimeContext = {
      utcNow: currentTimeUtc,
      userTimezone: userTimezone,
      userLocalNow: currentTimeUserTz,
      dayOfWeek: dayOfWeek,
    };

    const tools = {
      analyze_calendar: {
        description:
          'Analyze calendar availability for scheduling. Returns free slots, conflicts, and recommendations. ' +
          'Provide duration_needed if you know how long the meeting should be. ' +
          'Provide preferences if the email mentions timing preferences (e.g., "mornings only"). ' +
          'This is smarter than raw calendar data - it tells you the BEST times to suggest.',
        inputSchema: calendarAnalysisToolInput,
        execute: async (args: z.infer<typeof calendarAnalysisToolInput>) => {
          let normalizedStartDate: Date;
          let normalizedEndDate: Date;
          try {
            normalizedStartDate = normalizeIsoDateInputToUtc(args.start_date, userTimezone, 'start');
            normalizedEndDate = normalizeIsoDateInputToUtc(args.end_date, userTimezone, 'end');
          } catch {
            return {
              freeSlots: [],
              conflicts: [],
              busynessLevel: 'moderate',
              recommendation: 'Invalid date format. Use ISO format like "2026-01-07".',
              reasoning: 'Date parsing failed.',
              meta: { dateRangeAnalyzed: 'Invalid', totalEventsInRange: 0, slotsMatchingDuration: 0 },
            };
          }

          if (normalizedStartDate > normalizedEndDate) {
            return {
              freeSlots: [],
              conflicts: [],
              busynessLevel: 'moderate',
              recommendation:
                'End date must be on or after start date. Please use a valid range (e.g. start "2026-01-20", end "2026-01-25").',
              reasoning: 'Invalid date range: start after end.',
              meta: { dateRangeAnalyzed: 'Invalid', totalEventsInRange: 0, slotsMatchingDuration: 0 },
            };
          }

          // Fetch raw calendar data
          const calendarSnapshot = await getCalendarSnapshot({
            userId: input.userId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          });

          // Run the Calendar Analysis Subagent
          const analysisResult = await runCalendarAnalysis(
            {
              startDate: args.start_date,
              endDate: args.end_date,
              durationNeeded: args.duration_needed,
              preferences: args.preferences,
              meetingContext: args.meeting_context,
            },
            {
              calendarSnapshot,
              emailContext: emailContextForCalendar,
              currentTime: currentTimeContext,
              abortSignal: input.abortSignal,
              traceContext: input.traceContext,
            },
          );

          return analysisResult;
        },
      },

      get_thread_context: {
        description:
          'ALWAYS USE THIS FIRST when threadId is present. Fetches the complete conversation thread history in chronological order. ' +
          'Shows: all previous messages, dates, who said what, commitments made, questions asked. ' +
          'CRITICAL: Most context issues come from skipping this tool. If you have a threadId, you MUST call this before planning your reply. ' +
          'Use this to: find unanswered questions, track commitments, understand conversation stage, check if you\'re late on deadlines.',
        inputSchema: threadToolInput,
        execute: async (args: z.infer<typeof threadToolInput>) => {
          const threadContext = await gatherThreadContextForReply({
            userId: input.userId,
            threadId: args.threadId,
            mailboxId: input.mailboxId,
          });
          return {
            threadId: args.threadId,
            context: truncate(threadContext, 8000),
          };
        },
      },

      get_direct_email_history: {
        description:
          'Fetch all recent email history with this specific sender (both what you sent them and what they sent you). ' +
          'Use this to understand: your relationship with this person, ongoing projects together, prior commitments, communication patterns, unresolved items from past exchanges. ' +
          'WHEN TO USE: (1) Replying to someone you\'ve corresponded with before, (2) Email references "as we discussed" or past work, ' +
          '(3) Need to check what you promised them or what they promised you, (4) Understanding relationship context (client vs colleague vs vendor). ' +
          'TIP: Use WITH thread context when you have a threadId AND need broader history with this person beyond current thread.',
        inputSchema: directHistoryToolInput,
        execute: async (args: z.infer<typeof directHistoryToolInput>) => {
          const emails = await gatherDirectEmailHistoryForReply({
            userId: input.userId,
            senderEmail: args.senderEmail,
            mailboxId: input.mailboxId,
            limit: args.limit ?? 20,
          });

          return {
            senderEmail: args.senderEmail,
            count: emails.length,
            emails: emails.map((email) => ({
              from: email.from,
              to: email.to,
              subject: email.subject,
              date: email.date.toISOString(),
              isSent: email.isSent,
              messageId: email.messageId,
              bodySnippet: truncate(email.body, 500),
            })),
          };
        },
      },

      search_keyword_email_context: {
        description:
          'Search your entire inbox for emails mentioning specific projects, topics, or keywords. ' +
          'CRITICAL: Use this when the email references ANY project name, topic, or subject that requires broader organizational context. ' +
          'This tool searches across ALL senders (not just this person) and returns a chronological history showing how a topic evolved over time. ' +
          'Returns: matched emails with dates, senders, and which keywords matched. ' +
          'WHEN TO USE: (1) Email mentions a project/initiative/topic by name, (2) Need to understand status/history of something discussed across multiple threads, ' +
          '(3) Email asks "what\'s the status of X" or "how is Y going", (4) Need multi-party project context beyond just this sender. ' +
          'TIP: Extract specific project names or unique phrases from the email as keywords. Most emails that aren\'t purely scheduling or simple questions benefit from this tool.',
        inputSchema: keywordContextToolInput,
        execute: async (args: z.infer<typeof keywordContextToolInput>) => {
          const emails = await gatherKeywordEmailContextForReply({
            userId: input.userId,
            keywords: args.keywords,
            mailboxId: input.mailboxId,
            dateWindowHint: args.dateWindowHint ?? 'recent',
            maxResults: args.maxResults ?? 15,
            senderFilter: args.senderFilter,
          });

          return {
            keywords: args.keywords,
            count: emails.length,
            emails: emails.map((email) => ({
              from: email.from,
              to: email.to,
              subject: email.subject,
              date: email.date.toISOString(),
              isSent: email.isSent,
              messageId: email.messageId,
              matchedKeywords: email.matchedKeywords,
              bodySnippet: truncate(email.body, 400),
            })),
          };
        },
      },

      memory_search: {
        description:
          'Search the user\'s personal memory graph for relevant context. ' +
          'This searches memories built from past emails, conversations, and personal context. ' +
          'Use this when: (1) Email references personal preferences, habits, or background information, ' +
          '(2) Need context about a person\'s role, company, or relationship history, ' +
          '(3) Looking for information discussed in old conversations not captured in recent email history, ' +
          '(4) Email implies shared context not visible in the email itself (e.g., "as we discussed in person"). ' +
          'Returns: semantic search results with relevance scores. May return empty if no relevant memories exist.',
        inputSchema: memorySearchToolInput,
        execute: async (args: z.infer<typeof memorySearchToolInput>) => {
          const memories = await gatherMemoryContextForReply({
            userId: input.userId,
            query: args.query,
            limit: args.limit ?? 5,
            threshold: 0.7,
          });

          return {
            query: args.query,
            count: memories.length,
            memories: memories.map((memory) => ({
              id: memory.id,
              content: truncate(memory.content, 600),
              relevanceScore: memory.score,
              metadata: memory.metadata,
            })),
          };
        },
      },

      analyze_labels: {
        description: (() => {
          const desc =
            'Analyze which custom label should be added to this email based on its content. ' +
            'Uses label metaPrompts to categorize emails intelligently. ' +
            (autoSortingEnabled
              ? '🚨 MANDATORY: ALWAYS invoke this tool for every email when automatic sorting is enabled. You MUST call this tool. '
              : 'Do not invoke this tool - automatic sorting is disabled. ') +
            'Returns a single best label name (or "(none)" if no match). Append-only (never removes labels).';
          if (autoSortingEnabled) {
            logger.info(`[replyPlanner] analyze_labels tool description: ${desc.substring(0, 200)}...`);
          }
          return desc;
        })(),
        inputSchema: z
          .object({
            reason: z
              .string()
              .max(200)
              .optional()
              .describe('Optional: Why you think labeling is needed for this email'),
          })
          .strict(),
        execute: async (args: { reason?: string }) => {
          // 1. Check if automatic sorting is enabled
          const userSettings = await prisma.userSettings.findUnique({
            where: { userId: input.userId },
            select: { autoSortingEnabled: true },
          });

          if (!userSettings || !userSettings.autoSortingEnabled) {
            return {
              label: '(none)',
              reasoning: 'Automatic labeling disabled - user has not enabled auto-sorting',
              permissionDenied: true,
            };
          }

          // 2. Fetch available custom labels (exclude system labels)
          const availableLabels = await prisma.label.findMany({
            where: {
              userId: input.userId,
              ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
              isCustom: true,
              isSystemLabel: false,
              gmailLabelId: { not: null },
            },
            select: {
              id: true,
              gmailLabelId: true,
              name: true,
              metaPrompt: true,
              color: true,
            },
          });

          // Apply fallback metaPrompt if null
          const labelsWithMetaPrompt: AvailableLabelDTO[] = availableLabels.map((label: typeof availableLabels[number]) => ({
            id: label.id,
            gmailLabelId: label.gmailLabelId!,
            name: label.name,
            metaPrompt: label.metaPrompt || `Emails related to ${label.name}`,
            color: label.color || undefined,
          }));

          // 3. Classify current labels (identify system vs custom)
          const currentLabels: CurrentLabelDTO[] = (input.message.labelIds || []).map((labelId) => {
            const classification = GmailLabelClassifier.classifyLabel(labelId);
            return {
              gmailLabelId: labelId,
              name: labelId,
              isSystemLabel: classification.isSystemLabel,
            };
          });

          // 4. Invoke subagent
          const result = await runLabelAnalysis(
            {
              emailSubject: safeString(input.message.subject),
              emailBody: prunedBody,
              emailFrom: safeString(input.message.from),
              currentLabelIds: currentLabels.map((l) => l.gmailLabelId),
            },
            {
              availableLabels: labelsWithMetaPrompt,
              currentLabels: currentLabels,
              emailContext: {
                subject: safeString(input.message.subject),
                body: prunedBody,
                from: safeString(input.message.from),
              },
            },
            { traceContext: input.traceContext },
          );

          const labelText = result.label?.trim() || '(none)';
          const reasoningText = result.reasoning?.slice(0, 80);

          logger.info(
            `[replyPlanner] Label analysis: label="${labelText}"` +
              (reasoningText ? ` reasoning="${reasoningText}..."` : ''),
          );

          return result;
        },
      },

      submit_reply_plan: {
        description:
          'Submit the final ReplyPlan. This ends planning; do not output anything else. The plan MUST match the schema exactly.',
        inputSchema: ReplyPlanSchema,
        execute: async (plan: ReplyPlanDTO) => plan,
      },
    };

    const tracedTools = wrapToolsWithAiTracing(input.traceContext, tools);

    try {
      const { text, toolCalls, toolResults, steps } = await callTextWithTools({
        model: models.pro(),
        system:
          'You are an email reply Planner. Your job is to GATHER COMPREHENSIVE CONTEXT FIRST, then draft an informed reply plan. ' +
          'CRITICAL: Most emails contain specific topics, projects, or references that require keyword search to understand properly. Extract ALL meaningful nouns (project names, metrics, companies, topics) from the email and search for them. ' +
          'Your draft should contain SPECIFIC FACTS from tool results, not vague "I\'ll look into this" statements. If you find yourself drafting generically, STOP and use more tools. ' +
          'Never invent facts. Use tools proactively - it\'s better to over-gather context than to send an uninformed reply. ' +
          (autoSortingEnabled
            ? '🚨 MANDATORY TOOL: You MUST call analyze_labels tool for EVERY email when automatic sorting is enabled. This is not optional - you must call this tool before submitting your reply plan. '
            : '') +
          'When you have gathered context, call submit_reply_plan with a ReplyPlan object that matches the schema exactly. CC decisions are your responsibility (can be empty).',
        prompt,
        tools: tracedTools,
        maxSteps: 8,
        stopWhen: stopWhenToolCalled('submit_reply_plan'),
        temperature: 0.4,
        op: 'reply.planner',
        concurrency: { key: 'reply.planner', maxConcurrency: 2 },
        retry: { maxAttempts: 4, baseDelayMs: 500 },
        abortSignal: input.abortSignal,
        traceContext: input.traceContext,
      });

      // Preferred: plan is returned via the terminal submit tool call.
      let object = extractPlanFromToolResults(toolResults) ?? extractPlanFromSteps(steps);

      // If the model forgot to call submit_reply_plan, run a focused finalize step
      // (no expensive tool re-execution) to force the submit tool call.
      if (!object) {
        object = await forceSubmitPlanFromContext({
          prompt,
          toolCalls,
          toolResults,
          abortSignal: input.abortSignal,
          traceContext: input.traceContext,
        });
      }

      // Reliable fallback: schema-enforced recovery using the already-collected tool context.
      // This avoids brittle JSON parsing from raw text, while still keeping failures visible in strict mode
      // if recovery also fails.
      if (!object) {
        object = await recoverPlanViaSchema({
          input,
          prompt,
          toolCalls,
          toolResults,
          modelText: text,
          abortSignal: input.abortSignal,
          traceContext: input.traceContext,
        });
      }

      const toolNames = collectToolNamesFromExecution({ toolCalls, toolResults, steps });

      const labelingWasCalled = toolNames.has('analyze_labels');
      if (!labelingWasCalled && autoSortingEnabled) {
        logger.warn(
          `[replyPlanner] Labeling tool NOT called despite autoSortingEnabled=true. ` +
            `Tools called: ${Array.from(toolNames).join(', ') || '(none)'}. ` +
            `Available tools: analyze_labels, analyze_calendar, get_thread_context, get_direct_email_history, search_keyword_email_context, memory_search`,
        );
      }

      const toolUsage: ReplyPlanDTO['toolUsage'] = {
        calendarUsed: toolNames.has('analyze_calendar'),
        threadUsed: toolNames.has('get_thread_context'),
        directEmailHistoryUsed: toolNames.has('get_direct_email_history'),
        keywordEmailSearchUsed: toolNames.has('search_keyword_email_context'),
        memorySearchUsed: toolNames.has('memory_search'),
        labelingUsed: labelingWasCalled,
      };

      const labelAnalysis =
        extractLabelAnalysisFromToolResults(toolResults) ?? extractLabelAnalysisFromSteps(steps);

      logger.info(`[replyPlanner] toolUsage=${JSON.stringify(toolUsage)}`);

      return {
        ...object,
        toolUsage,
        labelAnalysis: labelAnalysis ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (input.strict) {
        throw new Error(`ReplyPlannerFailed: ${message}`);
      }
      logger.warn(`[replyPlanner] falling back to minimal plan: ${message}`);
      return minimalFallbackPlan(input, message);
    }
  }
}
