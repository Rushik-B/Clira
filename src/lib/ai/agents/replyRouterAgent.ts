import { readPromptFile } from '@/lib/prompts';
import { pruneEmailContentForRouting } from '@/lib/services/onboarding-services/utils/emailPruner';
import type { EmailMessage, FilterResult } from '@/lib/email/emailFilterService';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { ReplyRouterDecisionSchema, type ReplyRouterDecisionDTO } from '@/lib/ai/schemas/schemas';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type ReplyRouterAgentInput = {
  userId: string;
  userEmail: string;
  message: EmailMessage;
  filterResult: FilterResult;
  abortSignal?: AbortSignal;
  /**
   * When true, throw on Router failures instead of falling back.
   * Useful for deterministic testing (Injection Harness).
   */
  strict?: boolean;
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

async function buildReplyRouterPrompt(input: ReplyRouterAgentInput): Promise<string> {
  const template = readPromptFile('core-processing/replyRouterPrompt.md');

  const prunedBody = pruneEmailContentForRouting({
    subject: input.message.subject,
    body: input.message.body,
  }).prunedBody;

  const alerts = await prisma.emailAlert.findMany({
    where: { userId: input.userId, isActive: true },
    select: { id: true, description: true },
  });

  const alertsSection =
    alerts.length > 0
      ? alerts.map((alert) => `- [${alert.id}] ${safeString(alert.description)}`).join('\n')
      : '(No active alerts)';

  return template
    .replace('{userEmail}', safeString(input.userEmail))
    .replace('{filterShouldReply}', String(input.filterResult.shouldReply))
    .replace('{filterCategory}', safeString(input.filterResult.category))
    .replace('{filterReason}', safeString(input.filterResult.reason))
    .replace('{fromEmail}', safeString(input.message.from))
    .replace('{toEmails}', asCsv(input.message.to))
    .replace('{ccEmails}', asCsv(input.message.cc))
    .replace('{subject}', safeString(input.message.subject))
    .replace('{labelIds}', asCsv(input.message.labelIds))
    .replace('{emailAlerts}', alertsSection)
    .replace('{body}', prunedBody);
}

/**
 * Router Agent (Gatekeeper): second-pass LLM evaluator that decides
 * whether a drafted reply should be generated.
 *
 * NOTE: This is NOT the "EmailRouterService" (folder/label routing). This is
 * purely "reply eligibility" routing.
 */
export class ReplyRouterAgent {
  async evaluate(input: ReplyRouterAgentInput): Promise<ReplyRouterDecisionDTO> {
    try {
      const prompt = await buildReplyRouterPrompt(input);
      const { object } = await callObject<ReplyRouterDecisionDTO>({
        model: models.replyRouter(),
        system:
          'You are an email reply gatekeeper. Return only a JSON object that matches the provided schema; do not include markdown, code fences, or extra commentary.',
        prompt,
        schema: ReplyRouterDecisionSchema,
        temperature: 0.2,
        op: 'reply.router',
        concurrency: { key: 'reply.router', maxConcurrency: 4 },
        retry: { maxAttempts: 4, baseDelayMs: 350 },
        abortSignal: input.abortSignal,
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[replyRouterAgent] Failed to evaluate: ${message}`);
      if (input.strict) {
        throw new Error(`ReplyRouterFailed: ${message}`);
      }

      return {
        shouldReply: true,
        reason: `Router failed; proceeding with draft generation. Error: ${message}`,
        shouldNotify: false,
      };
    }
  }
}

