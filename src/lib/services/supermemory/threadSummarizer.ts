/**
 * Thread Episode Summarizer for Supermemory
 *
 * Generates 2-field JSON episode summaries from email threads using flash-lite model.
 * Per SUPERMEMORY.md Section 5, Step 5 and Section 6:
 *
 * Output: JSON with exactly:
 * - sent_email_summary (≤1400 chars): What the user communicated/committed to/decided
 * - received_thread_summary (≤1700 chars): What others wanted and thread context
 */

import { z } from 'zod';
import { callObject } from '@/lib/ai/callLlm';
import { getGoogleThinkingProviderOptions, models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import { readPromptFile } from '@/lib/prompts';
import {
  ThreadEpisodeContent,
  ThreadForProcessing,
  EPISODE_CHAR_LIMITS,
  DEFAULT_BOOTSTRAP_CONFIG,
} from './types';
import { formatMessageForSummarizer, estimateTokensFromChars } from './emailPruner';

// ============================================================================
// Zod Schema for LLM Output
// ============================================================================

const ThreadEpisodeContentSchema = z.object({
  sent_email_summary: z
    .string()
    .max(EPISODE_CHAR_LIMITS.SENT_EMAIL_SUMMARY)
    .describe(
      'Summary of what the user communicated, committed to, decided, or asked for in their reply. ≤1400 chars.',
    ),
  received_thread_summary: z
    .string()
    .max(EPISODE_CHAR_LIMITS.RECEIVED_THREAD_SUMMARY)
    .describe(
      'Summary of what others wanted and the conversation context leading up to the user reply. ≤1700 chars.',
    ),
});

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are an expert email conversation summarizer. Your task is to create high-quality, structured summaries of email threads that capture key information for future reference.

You will produce EXACTLY two summaries in JSON format:
1. sent_email_summary: What the user communicated in their reply
2. received_thread_summary: What others said/wanted and the conversation context

CRITICAL: CHARACTER LIMITS ARE HARD CONSTRAINTS - YOU MUST NEVER EXCEED THEM:
- sent_email_summary: MAXIMUM 1400 characters (not 1401, not 1402 - exactly 1400 or less)
- received_thread_summary: MAXIMUM 1700 characters (not 1701, not 1702 - exactly 1700 or less)

If your initial summary exceeds these limits, you MUST condense it by:
- Removing redundant phrases
- Using more concise language
- Prioritizing the most important details
- Abbreviating where appropriate without losing meaning
- Combining similar points into single sentences

REQUIREMENTS:
- Be information-dense and preserve nuance
- Include concrete specifics: deadlines, dates, times, amounts, deliverables, promised follow-ups
- Preserve exact names, dates, and times as stated
- Include commitments, decisions, and action items when present
- Capture relationship context (formal update to manager, declining meeting, negotiating timeline)
- Include 1-2 short verbatim quotes if critical for context (keep quotes brief)
- Avoid speculation - if unknown, state "not stated"
- Do NOT add details not present in the thread

VALIDATION: Before submitting your response, count the characters in each summary. If either exceeds its limit, rewrite it to be shorter.`;

function buildUserPrompt(thread: ThreadForProcessing, userEmail: string): string {
  const formattedMessages = thread.messages
    .map((msg) =>
      formatMessageForSummarizer({
        from: msg.from,
        to: msg.to,
        cc: msg.cc,
        body: msg.body,
        date: msg.date,
        isSent: msg.isSent,
        userEmail,
      }),
    )
    .join('\n\n---\n\n');

  const template = readPromptFile('supermemory/threadSummarizerUserPrompt.md');

  return template
    .replace('{subject}', thread.subject)
    .replace('{threadId}', thread.threadId)
    .replace('{messageCount}', thread.messages.length.toString())
    .replace('{threadStartAt}', thread.threadStartAt.toISOString())
    .replace('{threadLastAt}', thread.threadLastAt.toISOString())
    .replace('{targetMessageId}', thread.targetSentEmail.messageId)
    .replace('{targetSentAt}', thread.targetSentEmail.date.toISOString())
    .replace('{userEmail}', userEmail)
    .replace('{formattedMessages}', formattedMessages);
}

// ============================================================================
// Main Summarizer Function
// ============================================================================

/**
 * Summarize a thread into a 2-field episode content object
 *
 * @param thread - The thread to summarize
 * @param userEmail - The user's email address (to identify their messages)
 * @param abortSignal - Optional abort signal
 * @returns The episode content summary
 */
export async function summarizeThreadEpisode(
  thread: ThreadForProcessing,
  userEmail: string,
  abortSignal?: AbortSignal,
): Promise<ThreadEpisodeContent> {
  const startTime = Date.now();

  logger.info(
    `[ThreadSummarizer] Summarizing thread ${thread.threadId}: ${thread.messages.length} messages, subject="${thread.subject.substring(0, 50)}..."`,
  );

  // Check if thread is too large for single prompt (needs hierarchical summarization)
  const estimatedInputTokens = estimateThreadInputTokens(thread);
  const MAX_SINGLE_CALL_TOKENS = 100_000; // flash-lite context window safety margin

  let episodeContent: ThreadEpisodeContent;

  if (estimatedInputTokens > MAX_SINGLE_CALL_TOKENS) {
    logger.info(
      `[ThreadSummarizer] Large thread detected (${estimatedInputTokens} tokens), using hierarchical summarization`,
    );
    episodeContent = await summarizeThreadHierarchically(thread, userEmail, abortSignal);
  } else {
    episodeContent = await summarizeThreadDirect(thread, userEmail, abortSignal);
  }

  const duration = Date.now() - startTime;
  const totalChars =
    episodeContent.sent_email_summary.length + episodeContent.received_thread_summary.length;

  logger.info(
    `[ThreadSummarizer] ✅ Thread ${thread.threadId} summarized in ${duration}ms (${totalChars} chars)`,
  );

  return episodeContent;
}

/**
 * Direct summarization for normal-sized threads
 */
async function summarizeThreadDirect(
  thread: ThreadForProcessing,
  userEmail: string,
  abortSignal?: AbortSignal,
): Promise<ThreadEpisodeContent> {
  const prompt = buildUserPrompt(thread, userEmail);

  const { object } = await callObject<ThreadEpisodeContent>({
    model: models.flashLite(),
    system: SYSTEM_PROMPT,
    prompt,
    schema: ThreadEpisodeContentSchema,
    temperature: 0.3,
    providerOptions: getGoogleThinkingProviderOptions('flashLite', {
      thinkingLevel: 'medium',
    }),
    op: 'supermemory.thread.summarize',
    concurrency: { key: 'supermemory', maxConcurrency: 5 },
    retry: { maxAttempts: 2 },
    abortSignal,
  });

  // Ensure we respect character limits (LLM might exceed slightly)
  return enforceCharacterLimits(object);
}

/**
 * Hierarchical summarization for very large threads
 *
 * Strategy per SUPERMEMORY.md Section 5, Step 5 fallback:
 * 1. Chunk messages into groups of 10-15 messages
 * 2. Summarize each chunk to a compact "chunk summary"
 * 3. Final call combines chunk summaries + target sent message
 */
async function summarizeThreadHierarchically(
  thread: ThreadForProcessing,
  userEmail: string,
  abortSignal?: AbortSignal,
): Promise<ThreadEpisodeContent> {
  const CHUNK_SIZE = 12;
  const messages = thread.messages;
  const chunks: Array<typeof messages> = [];

  // Split messages into chunks
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    chunks.push(messages.slice(i, i + CHUNK_SIZE));
  }

  logger.info(`[ThreadSummarizer] Hierarchical: ${chunks.length} chunks of ${CHUNK_SIZE} messages`);

  // Summarize each chunk in parallel
  const chunkSummaries = await Promise.all(
    chunks.map((chunk, idx) =>
      summarizeMessageChunk(chunk, idx, chunks.length, thread.subject, userEmail, abortSignal),
    ),
  );

  // Final synthesis call
  const synthesisPrompt = buildSynthesisPrompt(
    thread,
    chunkSummaries,
    userEmail,
  );

  const { object } = await callObject<ThreadEpisodeContent>({
    model: models.flashLite(),
    system: SYSTEM_PROMPT,
    prompt: synthesisPrompt,
    schema: ThreadEpisodeContentSchema,
    temperature: 0.3,
    providerOptions: getGoogleThinkingProviderOptions('flashLite', {
      thinkingLevel: 'medium',
    }),
    op: 'supermemory.thread.synthesize',
    concurrency: { key: 'supermemory', maxConcurrency: 3 },
    retry: { maxAttempts: 2 },
    abortSignal,
  });

  return enforceCharacterLimits(object);
}

/**
 * Summarize a chunk of messages
 */
async function summarizeMessageChunk(
  messages: ThreadForProcessing['messages'],
  chunkIndex: number,
  totalChunks: number,
  subject: string,
  userEmail: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const formattedMessages = messages
    .map((msg) =>
      formatMessageForSummarizer({
        from: msg.from,
        to: msg.to,
        cc: msg.cc,
        body: msg.body,
        date: msg.date,
        isSent: msg.isSent,
        userEmail,
      }),
    )
    .join('\n\n---\n\n');

  const prompt = `THREAD SUBJECT: ${subject}
MESSAGE CHUNK ${chunkIndex + 1} of ${totalChunks}

${formattedMessages}

---

Summarize this portion of the email thread in 2-3 paragraphs (max 500 chars).
Focus on: key topics, decisions, questions asked, commitments made.
Preserve specific dates, names, and numbers.`;

  const ChunkSummarySchema = z.object({
    summary: z.string().max(600).describe('Compact summary of this message chunk'),
  });

  const { object } = await callObject<{ summary: string }>({
    model: models.flashLite(),
    system: 'You summarize email message chunks concisely while preserving key details.',
    prompt,
    schema: ChunkSummarySchema,
    temperature: 0.3,
    providerOptions: getGoogleThinkingProviderOptions('flashLite', {
      thinkingLevel: 'medium',
    }),
    op: 'supermemory.chunk.summarize',
    concurrency: { key: 'supermemory.chunk', maxConcurrency: 8 },
    retry: { maxAttempts: 2 },
    abortSignal,
  });

  return object.summary;
}

/**
 * Build the synthesis prompt for hierarchical summarization
 */
function buildSynthesisPrompt(
  thread: ThreadForProcessing,
  chunkSummaries: string[],
  userEmail: string,
): string {
  const targetSentFormatted = formatMessageForSummarizer({
    from: thread.targetSentEmail.from,
    to: thread.targetSentEmail.to,
    cc: thread.targetSentEmail.cc,
    body: thread.targetSentEmail.body,
    date: thread.targetSentEmail.date,
    isSent: true,
    userEmail,
  });

  const chunkSummariesText = chunkSummaries
    .map((summary, idx) => `[Chunk ${idx + 1}]\n${summary}`)
    .join('\n\n');

  const template = readPromptFile('supermemory/threadSummarizerSynthesisPrompt.md');

  return template
    .replace('{subject}', thread.subject)
    .replace('{threadId}', thread.threadId)
    .replace('{messageCount}', thread.messages.length.toString())
    .replace('{threadStartAt}', thread.threadStartAt.toISOString())
    .replace('{threadLastAt}', thread.threadLastAt.toISOString())
    .replace('{chunkSummaries}', chunkSummariesText)
    .replace('{targetSentFormatted}', targetSentFormatted);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Estimate input tokens for a thread
 */
function estimateThreadInputTokens(thread: ThreadForProcessing): number {
  let totalChars = 0;

  // System prompt and framework
  totalChars += SYSTEM_PROMPT.length + 500; // overhead

  // Messages
  for (const msg of thread.messages) {
    totalChars += msg.from.length;
    totalChars += msg.to.join(', ').length;
    totalChars += msg.cc.join(', ').length;
    totalChars += msg.subject.length;
    totalChars += Math.min(msg.body.length, DEFAULT_BOOTSTRAP_CONFIG.PER_MESSAGE_BODY_CAP);
    totalChars += 100; // formatting overhead per message
  }

  return estimateTokensFromChars(totalChars);
}

/**
 * Enforce character limits on episode content
 */
function enforceCharacterLimits(content: ThreadEpisodeContent): ThreadEpisodeContent {
  let sentSummary = content.sent_email_summary;
  let threadSummary = content.received_thread_summary;

  if (sentSummary.length > EPISODE_CHAR_LIMITS.SENT_EMAIL_SUMMARY) {
    sentSummary = sentSummary.slice(0, EPISODE_CHAR_LIMITS.SENT_EMAIL_SUMMARY - 3) + '...';
  }

  if (threadSummary.length > EPISODE_CHAR_LIMITS.RECEIVED_THREAD_SUMMARY) {
    threadSummary = threadSummary.slice(0, EPISODE_CHAR_LIMITS.RECEIVED_THREAD_SUMMARY - 3) + '...';
  }

  return {
    sent_email_summary: sentSummary,
    received_thread_summary: threadSummary,
  };
}

/**
 * Validate that a thread episode content is suitable for ingestion
 */
export function validateEpisodeContent(content: ThreadEpisodeContent): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!content.sent_email_summary || content.sent_email_summary.trim().length === 0) {
    issues.push('sent_email_summary is empty');
  }

  if (!content.received_thread_summary || content.received_thread_summary.trim().length === 0) {
    issues.push('received_thread_summary is empty');
  }

  if (content.sent_email_summary.length > EPISODE_CHAR_LIMITS.SENT_EMAIL_SUMMARY) {
    issues.push(
      `sent_email_summary exceeds limit (${content.sent_email_summary.length}/${EPISODE_CHAR_LIMITS.SENT_EMAIL_SUMMARY})`,
    );
  }

  if (content.received_thread_summary.length > EPISODE_CHAR_LIMITS.RECEIVED_THREAD_SUMMARY) {
    issues.push(
      `received_thread_summary exceeds limit (${content.received_thread_summary.length}/${EPISODE_CHAR_LIMITS.RECEIVED_THREAD_SUMMARY})`,
    );
  }

  // Check for low-quality content markers
  const lowQualityPatterns = [
    /unable to summarize/i,
    /no content available/i,
    /empty thread/i,
    /\[placeholder\]/i,
  ];

  for (const pattern of lowQualityPatterns) {
    if (pattern.test(content.sent_email_summary) || pattern.test(content.received_thread_summary)) {
      issues.push('Content contains low-quality placeholder text');
      break;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
