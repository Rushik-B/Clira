import { createHash } from 'node:crypto';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { readPromptFile } from '@/lib/prompts';
import {
  getCalendarSnapshot,
  gatherMemoryContextForReply,
} from '@/lib/services/core/replyContextTools';
import {
  listInboxEmails,
  readEmailPdfAttachment,
} from '@/lib/services/inbox-search';
import {
  addDaysToDateOnly,
  endOfDayInTimezone,
  endOfTodayInTimezone,
  formatDateTimeInTimeZone,
  getDateOnlyInTimezone,
  normalizeIsoDateInputToUtc,
  startOfDayInTimezone,
} from '@/lib/utils/timezone';
import { runCalendarAnalysis } from '@/lib/ai/agents/calendarAnalysisSubagent';
import { runCalendarSearch } from '@/lib/ai/agents/calendarSearchSubagent';
import { runEmailRetrieval } from '@/lib/ai/agents/emailRetrievalSubagent';
import {
  listInboxEmailsArgsSchema,
  listInboxEmailsProviderSchema,
  normalizeListInboxEmailsArgs,
} from '../list-inbox-emails-contract';
import {
  normalizeSearchInboxContextArgs,
  searchInboxContextArgsSchema,
  searchInboxContextProviderSchema,
} from '../search-inbox-context-contract';
import {
  normalizeReadEmailPdfAttachmentArgs,
  readEmailPdfAttachmentArgsSchema,
  readEmailPdfAttachmentProviderSchema,
} from '../read-email-pdf-attachment-contract';
import { isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import {
  CALENDAR_SEARCH_MIN_BUDGET_MS,
  MESSAGING_INBOX_CALL_LIMITS,
} from '../constants';
import {
  buildToolBudgetExceededResult,
  runWithSubagentBudget,
  truncate,
} from '../helpers';
import type {
  ExecutiveRuntimeContext,
  ListInboxEmailsArgs,
  ReadEmailPdfAttachmentArgs,
  SearchInboxContextArgs,
} from '../types';

const searchInboxContextToolDescription = readPromptFile(
  'executive-agent/searchInboxContextTool.md',
);
const listInboxEmailsToolDescription = readPromptFile(
  'executive-agent/listInboxEmailsTool.md',
);
const readEmailPdfAttachmentToolDescription = readPromptFile(
  'executive-agent/readEmailPdfAttachmentTool.md',
);

function normalizeIntentText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
}

function buildInboxIntentFingerprint(params: {
  action: SearchInboxContextArgs['action'];
  userRequestText?: string;
}): string {
  const normalizedUserRequest = normalizeIntentText(params.userRequestText);
  const hashedRequest = createHash('sha1')
    .update(normalizedUserRequest || '(empty)')
    .digest('hex')
    .slice(0, 12);
  return `${params.action}:${hashedRequest}`;
}

function buildInvalidInboxSearchResult(args: unknown, message: string) {
  const action =
    args && typeof args === 'object' && typeof (args as { action?: unknown }).action === 'string'
      ? (args as { action: 'find' | 'summarize_range' | 'count' | 'aggregate' }).action
      : 'find';

  return {
    action,
    matches: [],
    quotes: [],
    coverage: {
      action,
      queriesTried: [],
      threadsScanned: 0,
      messagesScanned: 0,
      timeWindow: 'unknown',
      pagesFetched: 0,
      truncated: false,
      filterOnly: true,
      appliedFilters: [],
      budgetNotes: [message],
      engineVersion: 'inbox-search-v2-hybrid' as const,
      indexFreshness: 'unknown' as const,
      retrievalLatencyMs: 0,
      lexicalCandidates: 0,
      semanticCandidates: 0,
      fusionMethod: 'lexical-only' as const,
      indexLag: null,
      semanticUnavailable: true,
    },
    confidence: 'low' as const,
    metadata: {
      validationError: true,
    },
    summary: message,
    followUpQuestions: [message],
  };
}

function buildInvalidListInboxEmailsResult(message: string) {
  return {
    items: [],
    matchedCount: 0,
    returnedCount: 0,
    truncated: false,
    note: message,
    metadata: {
      validationError: true,
    },
  };
}

function buildInvalidReadEmailPdfAttachmentResult(messageId: string, message: string) {
  return {
    ok: false as const,
    status: 'invalid_request' as const,
    message,
    retryable: false,
    messageContext: {
      messageId,
    },
    metadata: {
      validationError: true,
    },
  };
}

function formatUserVisibleTimestamp(value: string | null | undefined, userTimezone: string): string | null {
  if (!value) return value ?? null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return formatDateTimeInTimeZone(parsed, userTimezone);
}

function localizeEmailEvidencePackDates<T extends Record<string, unknown>>(result: T, userTimezone: string): T {
  const nextResult: Record<string, unknown> = { ...result };

  if (Array.isArray(result.matches)) {
    nextResult.matches = result.matches.map((match) => {
      if (!match || typeof match !== 'object') return match;
      const typedMatch = match as Record<string, unknown>;
      return {
        ...typedMatch,
        date:
          typeof typedMatch.date === 'string'
            ? formatUserVisibleTimestamp(typedMatch.date, userTimezone)
            : typedMatch.date,
      };
    });
  }

  if (Array.isArray(result.expandedThreads)) {
    nextResult.expandedThreads = result.expandedThreads.map((thread) => {
      if (!thread || typeof thread !== 'object') return thread;
      const typedThread = thread as Record<string, unknown>;
      const messages = Array.isArray(typedThread.messages) ? typedThread.messages : [];
      return {
        ...typedThread,
        messages: messages.map((message) => {
          if (!message || typeof message !== 'object') return message;
          const typedMessage = message as Record<string, unknown>;
          return {
            ...typedMessage,
            date:
              typeof typedMessage.date === 'string'
                ? formatUserVisibleTimestamp(typedMessage.date, userTimezone)
                : typedMessage.date,
          };
        }),
      };
    });
  }

  return nextResult as T;
}

function localizeListInboxEmailsDates<T extends { items?: Array<Record<string, unknown>> }>(
  result: T,
  userTimezone: string,
): T {
  if (!Array.isArray(result.items)) {
    return result;
  }

  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      sentAt:
        typeof item.sentAt === 'string'
          ? formatUserVisibleTimestamp(item.sentAt, userTimezone)
          : item.sentAt,
    })),
  };
}

function localizePdfAttachmentDates<T extends Record<string, unknown>>(result: T, userTimezone: string): T {
  const nextResult: Record<string, unknown> = { ...result };

  if (result.message && typeof result.message === 'object' && !Array.isArray(result.message)) {
    const message = result.message as Record<string, unknown>;
    nextResult.message = {
      ...message,
      sentAt:
        typeof message.sentAt === 'string'
          ? formatUserVisibleTimestamp(message.sentAt, userTimezone)
          : message.sentAt,
    };
  }

  if (
    result.messageContext &&
    typeof result.messageContext === 'object' &&
    !Array.isArray(result.messageContext)
  ) {
    const messageContext = result.messageContext as Record<string, unknown>;
    nextResult.messageContext = {
      ...messageContext,
      sentAt:
        typeof messageContext.sentAt === 'string'
          ? formatUserVisibleTimestamp(messageContext.sentAt, userTimezone)
          : messageContext.sentAt,
    };
  }

  return nextResult as T;
}

export function buildContextTools({
  context,
  nextSubagentCallIndex,
}: {
  context: ExecutiveRuntimeContext;
  nextSubagentCallIndex: () => number;
}): Record<string, unknown> {
  const {
    input,
    retrievalProfile,
    selectedPack,
    userTimezone,
    currentTimeUtc,
    currentTimeUserTz,
    dayOfWeek,
    toolAbort,
    toolAbortSignal,
    toolResultCache,
  } = context;

  const inboxCallTracker = {
    quickCalls: 0,
    deepCalls: 0,
  };
  context.registerToolResultCacheStatsReader?.(() => toolResultCache.getStats());

  let inboxMinStoredAtMsPromise: Promise<number | undefined> | null = null;
  const getInboxMinStoredAtMs = async (): Promise<number | undefined> => {
    if (!inboxMinStoredAtMsPromise) {
      inboxMinStoredAtMsPromise = prisma.mailbox.findMany({
        where: {
          userId: input.userId,
          status: 'CONNECTED',
        },
        select: {
          updatedAt: true,
          gmailHistoryId: true,
        },
      }).then((mailboxes) => {
        const updatedAtValues = mailboxes
          .map((mailbox) => mailbox.updatedAt?.getTime())
          .filter((value): value is number => Number.isFinite(value));

        if (updatedAtValues.length === 0) {
          return undefined;
        }

        const maxUpdatedAtMs = Math.max(...updatedAtValues);
        const historyMarkerCount = mailboxes.filter((mailbox) => !!mailbox.gmailHistoryId).length;
        logger.debug(
          `[executiveAgent] search_inbox_context freshness marker: connectedMailboxes=${mailboxes.length} historyMarkers=${historyMarkerCount} minStoredAtMs=${maxUpdatedAtMs}`,
        );
        return maxUpdatedAtMs;
      }).catch((error) => {
        logger.warn('[executiveAgent] Failed to load inbox freshness marker', error);
        return undefined;
      });
    }

    return inboxMinStoredAtMsPromise;
  };

  return {
      // Tool 1: Search Inbox Context
      // ─────────────────────────────────────────────────────────────────────────
      search_inbox_context: {
        description: searchInboxContextToolDescription,
        inputSchema: searchInboxContextArgsSchema,
        providerInputSchema: searchInboxContextProviderSchema,
        execute: async (args: SearchInboxContextArgs) => {
          let normalizedArgs;
          try {
            normalizedArgs = normalizeSearchInboxContextArgs(args, {
              defaultTimezone: userTimezone,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid inbox search request.';
            logger.warn('[executiveAgent] search_inbox_context invalid args', {
              userId: input.userId,
              message,
              args,
            });
            return buildInvalidInboxSearchResult(args, message);
          }

          const mode = normalizedArgs.mode;
          const intentFingerprint = buildInboxIntentFingerprint({
            action: normalizedArgs.action,
            userRequestText: input.userRequest,
          });
          const cacheArgs = {
            ...normalizedArgs,
            intentFingerprint,
          };
          const inboxMinStoredAtMs = await getInboxMinStoredAtMs();
          const cachedResult = toolResultCache.get('search_inbox_context', cacheArgs, {
            minStoredAtMs: inboxMinStoredAtMs,
          });
          if (cachedResult) {
            logger.info(
              `[executiveAgent] search_inbox_context cache hit: action=${normalizedArgs.action} mode=${mode} query="${truncate(normalizedArgs.queryText ?? '(none)', 80)}"`,
            );
            return cachedResult;
          }

          const totalCalls = inboxCallTracker.quickCalls + inboxCallTracker.deepCalls;
          const modeCalls = mode === 'deep' ? inboxCallTracker.deepCalls : inboxCallTracker.quickCalls;
          const modeLimit = MESSAGING_INBOX_CALL_LIMITS[mode];

          if (modeCalls >= modeLimit) {
            logger.warn(
              `[executiveAgent] search_inbox_context budget exceeded: mode=${mode} calls=${modeCalls} limit=${modeLimit}`,
            );
            return buildToolBudgetExceededResult(
              'search_inbox_context',
              `Max ${mode} inbox searches reached.`,
              { total: totalCalls, tool: modeCalls },
            );
          }

          if (mode === 'deep') {
            inboxCallTracker.deepCalls += 1;
          } else {
            inboxCallTracker.quickCalls += 1;
          }

          logger.info(
            `[executiveAgent] search_inbox_context: action=${normalizedArgs.action} mode=${mode} query="${truncate(normalizedArgs.queryText ?? '(none)', 80)}"`,
          );

          const toolCallIndex = nextSubagentCallIndex();
          const result = await runWithSubagentBudget({
            toolName: 'search_inbox_context',
            counts: { total: totalCalls, tool: modeCalls },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            run: (budgetContext) =>
              runEmailRetrieval(
                {
                  action: normalizedArgs.action,
                  mode,
                  mailboxId: normalizedArgs.mailboxId,
                  mailboxEmail: normalizedArgs.mailboxEmail,
                  queryText: normalizedArgs.queryText,
                  filters: normalizedArgs.filters,
                  options: normalizedArgs.options,
                  profile: retrievalProfile,
                  userRequestText: input.userRequest,
                  selectedPack,
                },
                {
                  userId: input.userId,
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
          const localizedResult = localizeEmailEvidencePackDates(result, userTimezone);
          toolResultCache.set('search_inbox_context', cacheArgs, localizedResult);
          return localizedResult;
        },
      },

      list_inbox_emails: {
        description: listInboxEmailsToolDescription,
        inputSchema: listInboxEmailsArgsSchema,
        providerInputSchema: listInboxEmailsProviderSchema,
        execute: async (args: ListInboxEmailsArgs) => {
          let normalizedArgs;
          try {
            normalizedArgs = normalizeListInboxEmailsArgs(args, {
              defaultTimezone: userTimezone,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Invalid inbox list request.';
            logger.warn('[executiveAgent] list_inbox_emails invalid args', {
              userId: input.userId,
              message,
              args,
            });
            return buildInvalidListInboxEmailsResult(message);
          }

          const inboxMinStoredAtMs = await getInboxMinStoredAtMs();
          const cachedResult = toolResultCache.get('list_inbox_emails', normalizedArgs, {
            minStoredAtMs: inboxMinStoredAtMs,
          });
          if (cachedResult) {
            logger.info(
              `[executiveAgent] list_inbox_emails cache hit: mailbox="${truncate(normalizedArgs.mailboxEmail ?? normalizedArgs.mailboxId ?? '(all)', 80)}"`,
            );
            return cachedResult;
          }

          logger.info(
            `[executiveAgent] list_inbox_emails: mailbox="${truncate(normalizedArgs.mailboxEmail ?? normalizedArgs.mailboxId ?? '(all)', 80)}" limit=${normalizedArgs.options.limit}`,
          );

          const result = await listInboxEmails(normalizedArgs, {
            userId: input.userId,
          });
          const localizedResult = localizeListInboxEmailsDates(result, userTimezone);
          toolResultCache.set('list_inbox_emails', normalizedArgs, localizedResult);
          return localizedResult;
        },
      },

      read_email_pdf_attachment: {
        description: readEmailPdfAttachmentToolDescription,
        inputSchema: readEmailPdfAttachmentArgsSchema,
        providerInputSchema: readEmailPdfAttachmentProviderSchema,
        execute: async (args: ReadEmailPdfAttachmentArgs) => {
          let normalizedArgs;
          try {
            normalizedArgs = normalizeReadEmailPdfAttachmentArgs(args);
          } catch (error) {
            const message =
              error instanceof z.ZodError
                ? error.issues[0]?.message ?? 'Invalid read_email_pdf_attachment request.'
                : error instanceof Error
                  ? error.message
                  : 'Invalid read_email_pdf_attachment request.';
            logger.warn('[executiveAgent] read_email_pdf_attachment invalid args', {
              userId: input.userId,
              message,
              args,
            });
            const fallbackMessageId =
              args && typeof args === 'object' && typeof args.messageId === 'string'
                ? args.messageId
                : 'unknown';
            return buildInvalidReadEmailPdfAttachmentResult(fallbackMessageId, message);
          }

          const cachedResult = toolResultCache.get('read_email_pdf_attachment', normalizedArgs);
          if (cachedResult) {
            logger.info(
              `[executiveAgent] read_email_pdf_attachment cache hit: messageId="${truncate(normalizedArgs.messageId, 80)}"`,
            );
            return cachedResult;
          }

          logger.info(
            `[executiveAgent] read_email_pdf_attachment: messageId="${truncate(normalizedArgs.messageId, 80)}" mailbox="${truncate(normalizedArgs.mailboxEmail ?? normalizedArgs.mailboxId ?? '(auto)', 80)}"`,
          );

          const toolCallIndex = nextSubagentCallIndex();
          const result = await runWithSubagentBudget({
            toolName: 'read_email_pdf_attachment',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            run: (budgetContext) =>
              readEmailPdfAttachment({
                userId: input.userId,
                messageId: normalizedArgs.messageId,
                mailboxId: normalizedArgs.mailboxId,
                mailboxEmail: normalizedArgs.mailboxEmail,
                attachmentId: normalizedArgs.attachmentId,
                attachmentFilename: normalizedArgs.attachmentFilename,
                abortSignal: budgetContext.abortSignal,
                traceContext: input.traceContext,
              }),
          });

          const localizedResult = localizePdfAttachmentDates(result, userTimezone);
          toolResultCache.set('read_email_pdf_attachment', normalizedArgs, localizedResult);
          return localizedResult;
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 2: Search Memory
      // ─────────────────────────────────────────────────────────────────────────
      search_memory: {
        description:
          'Search the user\'s personal memory for relevant context. ' +
          'Memories include: names and roles (professors, managers, contacts), preferences, facts, communication style. ' +
          'Use this when: the user asks a RECALL question (e.g. "what\'s my stat prof\'s name?", "who\'s my manager?", "what did I tell you about X?"). ' +
          'Call search_memory first; only say you don\'t know if the search returns nothing. ' +
          'Parallelism: call this in the same step as any other independent tool calls. Every sequential step adds latency.',
        inputSchema: z.object({
          query: z.string().min(1).max(200).describe('Natural language search query'),
          limit: z.number().int().min(1).max(10).optional().describe('Max memories to return (default: 5)'),
        }),
        execute: async (args: { query: string; limit?: number }) => {
          const cacheArgs = {
            query: args.query,
            limit: args.limit ?? 5,
          };
          const cachedResult = toolResultCache.get('search_memory', cacheArgs);
          if (cachedResult) {
            logger.info(`[executiveAgent] search_memory cache hit: "${truncate(args.query, 50)}"`);
            return cachedResult;
          }

          logger.info(`[executiveAgent] search_memory: "${truncate(args.query, 50)}"`);

          if (!isSupermemoryConfigured()) {
            return { query: args.query, count: 0, memories: [], note: 'Memory system not configured' };
          }

          const memories = await gatherMemoryContextForReply({
            userId: input.userId,
            query: args.query,
            limit: args.limit ?? 5,
            threshold: 0.4,
          });

          const result = {
            query: args.query,
            count: memories.length,
            memories: memories.map((m) => ({
              content: truncate(m.content, 400),
              relevanceScore: m.score,
            })),
          };
          toolResultCache.set('search_memory', cacheArgs, result);
          return result;
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 3: Check Calendar
      // ─────────────────────────────────────────────────────────────────────────
      check_calendar: {
        description:
          'Analyze calendar availability for scheduling. Returns free slots, conflicts, and recommendations. ' +
          'Use this when: user wants to schedule a meeting, needs availability, or email involves dates/times. ' +
          'IMPORTANT: Dates are interpreted in the USER\'S timezone. Prefer date-only strings ("YYYY-MM-DD") for day-based queries. ' +
          'Parallelism: call this in the same step as any other independent tool calls. Every sequential step adds latency.',
        inputSchema: z.object({
          startDate: z
            .string()
            .describe('Start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          endDate: z
            .string()
            .describe('End date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          durationNeeded: z.string().optional().describe('Meeting duration (e.g., "30 minutes", "1 hour")'),
          preferences: z.string().optional().describe('Scheduling preferences (e.g., "prefer mornings")'),
        }),
        execute: async (args: {
          startDate: string;
          endDate: string;
          durationNeeded?: string;
          preferences?: string;
        }) => {
          const cacheArgs = {
            startDate: args.startDate,
            endDate: args.endDate,
            durationNeeded: args.durationNeeded,
            preferences: args.preferences,
          };
          const cachedResult = toolResultCache.get('check_calendar', cacheArgs);
          if (cachedResult) {
            logger.info(
              `[executiveAgent] check_calendar cache hit: ${args.startDate} to ${args.endDate}`,
            );
            return cachedResult;
          }

          logger.info(`[executiveAgent] check_calendar: ${args.startDate} to ${args.endDate}`);
          let normalizedStartDate: Date;
          let normalizedEndDate: Date;
          try {
            normalizedStartDate = normalizeIsoDateInputToUtc(args.startDate, userTimezone, 'start');
            normalizedEndDate = normalizeIsoDateInputToUtc(args.endDate, userTimezone, 'end');
          } catch {
            return {
              freeSlots: [],
              conflicts: [],
              recommendation: 'Invalid date format. Use ISO format like "2026-01-20".',
            };
          }

          if (normalizedStartDate > normalizedEndDate) {
            return {
              freeSlots: [],
              conflicts: [],
              recommendation:
                'End date must be on or after start date. Please use a valid range (e.g. start "2026-01-20", end "2026-01-25").',
            };
          }

          const calendarSnapshot = await getCalendarSnapshot({
            userId: input.userId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          });

          const toolCallIndex = nextSubagentCallIndex();
          const result = await runWithSubagentBudget({
            toolName: 'check_calendar',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            run: (budgetContext) =>
              runCalendarAnalysis(
                {
                  startDate: args.startDate,
                  endDate: args.endDate,
                  durationNeeded: args.durationNeeded,
                  preferences: args.preferences,
                },
                {
                  calendarSnapshot,
                  emailContext: {
                    subject: 'WhatsApp scheduling request',
                    fromEmail: input.userEmail,
                    bodySnippet: truncate(input.userRequest, 200),
                  },
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone: userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek: dayOfWeek,
                  },
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                  traceContext: input.traceContext,
                },
              ),
          });
          toolResultCache.set('check_calendar', cacheArgs, result);
          return result;
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 4: Search Calendar
      // ─────────────────────────────────────────────────────────────────────────
      search_calendar: {
        description:
          'Search for specific events in the user\'s calendar using natural language queries. ' +
          'Returns semantically relevant events with ranking and insights. ' +
          'Use this when: user asks to find specific meetings/events, wants to recall past events, ' +
          'needs to check if a particular meeting happened, or wants to find events with specific people or topics. ' +
          'IMPORTANT: Dates are interpreted in the USER\'S timezone. Prefer date-only strings ("YYYY-MM-DD") for full-day ranges. ' +
          'Examples: "events today" -> startDate="YYYY-MM-DD", endDate="YYYY-MM-DD" (user-local). ' +
          'Other examples: "find my meetings with John last week", "show me all-day events in January", "when did I last meet with the team?" ' +
          'Parallelism: call this in the same step as any other independent tool calls. Every sequential step adds latency.',
        inputSchema: z.object({
          query: z.string().min(1).max(500).describe('Natural language search query describing what events to find'),
          startDate: z
            .string()
            .optional()
            .describe('Start date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          endDate: z
            .string()
            .optional()
            .describe('End date/time (ISO). Prefer date-only "YYYY-MM-DD" (user-local) unless an exact time is needed.'),
          maxResults: z.number().int().min(1).max(50).optional().describe('Maximum number of matching events to return (default: 10)'),
          minRelevance: z.number().min(0).max(100).optional().describe('Minimum relevance score (0-100) for results (default: 40)'),
        }),
        execute: async (args: {
          query: string;
          startDate?: string;
          endDate?: string;
          maxResults?: number;
          minRelevance?: number;
        }) => {
          const cacheArgs = {
            query: args.query,
            startDate: args.startDate,
            endDate: args.endDate,
            maxResults: args.maxResults ?? 10,
            minRelevance: args.minRelevance ?? 40,
          };
          const cachedResult = toolResultCache.get('search_calendar', cacheArgs);
          if (cachedResult) {
            logger.info(`[executiveAgent] search_calendar cache hit: "${truncate(args.query, 50)}"`);
            return cachedResult;
          }

          logger.info(`[executiveAgent] search_calendar: "${truncate(args.query, 50)}"`);

          // Default date range: 30 days ago to today (in user's timezone)
          const now = new Date();
          const userToday = getDateOnlyInTimezone(now, userTimezone);

          // Compute normalized start date
          let normalizedStartDate: Date;
          if (args.startDate) {
            try {
              normalizedStartDate = normalizeIsoDateInputToUtc(args.startDate, userTimezone, 'start');
            } catch {
              return {
                events: [],
                summary: 'Invalid start date format. Use ISO format like "2026-01-20".',
                reasoning: 'Date parsing failed',
                meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
              };
            }
          } else {
            // Default: 30 days ago at start of day in user's timezone
            const thirtyDaysAgo = addDaysToDateOnly(userToday, -30);
            normalizedStartDate = startOfDayInTimezone(thirtyDaysAgo, userTimezone);
          }

          // Compute normalized end date
          let normalizedEndDate: Date;
          if (args.endDate) {
            try {
              normalizedEndDate = normalizeIsoDateInputToUtc(args.endDate, userTimezone, 'end');
            } catch {
              return {
                events: [],
                summary: 'Invalid end date format. Use ISO format like "2026-01-20".',
                reasoning: 'Date parsing failed',
                meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
              };
            }
          } else {
            // Default: end of today in user's timezone
            const endOfToday = endOfTodayInTimezone(now, userTimezone);
            if (args.startDate && normalizedStartDate > endOfToday) {
              // startDate is in the future — "end of today" would create an invalid range (start > end).
              // Default to end of startDate's day so we search that full day.
              const startDateOnly = getDateOnlyInTimezone(normalizedStartDate, userTimezone);
              normalizedEndDate = endOfDayInTimezone(startDateOnly, userTimezone);
            } else {
              normalizedEndDate = endOfToday;
            }
          }

          if (normalizedStartDate > normalizedEndDate) {
            return {
              events: [],
              summary: 'Invalid date range: end date must be on or after start date.',
              reasoning: 'Date range validation failed',
              meta: { totalEventsSearched: 0, matchesFound: 0, dateRangeSearched: '', queryType: 'general' },
            };
          }

          const calendarSnapshot = await getCalendarSnapshot({
            userId: input.userId,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          });

          const toolCallIndex = nextSubagentCallIndex();
          const result = await runWithSubagentBudget({
            toolName: 'search_calendar',
            counts: { total: 0, tool: 0 },
            timeLeftMs: toolAbort.timeLeftMs(),
            abortSignal: toolAbortSignal,
            toolCallIndex,
            minBudgetMs: CALENDAR_SEARCH_MIN_BUDGET_MS,
            maxBudgetMs: CALENDAR_SEARCH_MIN_BUDGET_MS,
            uncappedBudget: true,
            run: (budgetContext) =>
              runCalendarSearch(
                {
                  query: args.query,
                  startDate: args.startDate,
                  endDate: args.endDate,
                  maxResults: args.maxResults,
                  minRelevance: args.minRelevance,
                },
                {
                  calendarSnapshot,
                  currentTime: {
                    utcNow: currentTimeUtc,
                    userTimezone: userTimezone,
                    userLocalNow: currentTimeUserTz,
                    dayOfWeek: dayOfWeek,
                  },
                  userContext: {
                    userEmail: input.userEmail,
                    requestContext: truncate(input.userRequest, 500),
                  },
                  abortSignal: budgetContext.abortSignal,
                  deadlineAt: budgetContext.deadlineAt,
                },
              ),
          });
          toolResultCache.set('search_calendar', cacheArgs, result);
          return result;
        },
      },
  };
}
