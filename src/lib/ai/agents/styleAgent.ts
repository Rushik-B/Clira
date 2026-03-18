import { readPromptFile } from '@/lib/prompts';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { ReplyGenerationResultSchema, type ReplyGenerationResultDTO, type ReplyPlanDTO } from '@/lib/ai/schemas/schemas';
import type { AiTraceContext } from '@/lib/ai/tracing';
import {
  compileEffectiveReplyInstructionDoc,
  resolveReplyInstructionSenderEmail,
} from '@/lib/services/reply-instructions';

type IncomingEmailForStyleAgent = {
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: Date;
  threadId?: string;
};

export type StyleAgentInput = {
  userId: string;
  userEmail: string;
  incomingEmail: IncomingEmailForStyleAgent;
  plan: ReplyPlanDTO;
  masterPrompt: string;
  styleExamples: Array<{
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
  }>;
  abortSignal?: AbortSignal;
  /**
   * When true, throw on failures instead of falling back.
   * Useful for deterministic testing (Injection Harness).
   */
  strict?: boolean;
  traceContext?: AiTraceContext;
};

function truncate(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatStyleExamples(examples: StyleAgentInput['styleExamples']): string {
  if (!examples || examples.length === 0) {
    return '(none)';
  }

  // Keep examples compact to avoid token blow-ups.
  return examples
    .slice(0, 6)
    .map((e, idx) => {
      const date = e.date instanceof Date ? e.date.toISOString() : String(e.date);
      const body = truncate(e.body ?? '', 900);
      return [
        `Example ${idx + 1}:`,
        `Date: ${date}`,
        `To: ${(e.to ?? []).join(', ')}`,
        `Subject: ${e.subject ?? ''}`,
        `Body: ${body}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

export async function buildStylePrompt(input: StyleAgentInput): Promise<string> {
  const template = readPromptFile('core-processing/styleAgentPrompt.md');
  const senderEmail = resolveReplyInstructionSenderEmail(input.incomingEmail.from);
  const replyInstructionDoc = await compileEffectiveReplyInstructionDoc({
    userId: input.userId,
    target: 'style',
    senderEmail,
  });

  const incomingEmail = safeJson({
    from: input.incomingEmail.from,
    to: input.incomingEmail.to,
    subject: input.incomingEmail.subject,
    body: truncate(input.incomingEmail.body ?? '', 4000),
    date: input.incomingEmail.date.toISOString(),
    threadId: input.incomingEmail.threadId ?? null,
  });

  const replyPlan = safeJson(input.plan);

  return template
    .replace('{replyInstructionDoc}', replyInstructionDoc)
    .replace('{masterPrompt}', input.masterPrompt)
    .replace('{incomingEmail}', incomingEmail)
    .replace('{replyPlan}', replyPlan)
    .replace('{styleExamples}', formatStyleExamples(input.styleExamples));
}

export class StyleAgent {
  async generate(input: StyleAgentInput): Promise<ReplyGenerationResultDTO> {
    const prompt = await buildStylePrompt(input);

    try {
      const { object } = await callObject<ReplyGenerationResultDTO>({
        model: models.pro(),
        system:
          'You are a Style Agent that rewrites a planner draft into the user’s authentic voice. You must follow the Planner Plan and never introduce new facts. Return only a JSON object matching the schema.',
        prompt,
        schema: ReplyGenerationResultSchema,
        temperature: 0.6,
        op: 'reply.style',
        concurrency: { key: 'reply', maxConcurrency: 2 },
        retry: { maxAttempts: 3, baseDelayMs: 600 },
        abortSignal: input.abortSignal,
        traceContext: input.traceContext,
      });

      return object;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (input.strict) {
        throw new Error(`StyleAgentFailed: ${message}`);
      }

      // Non-strict fallback: return the planner draft (minimal rewrite) to keep the app functional.
      const fallback = (input.plan?.draft ?? '').trim();
      return {
        reply:
          fallback.length > 0
            ? fallback
            : `Thanks for reaching out.\n\nI saw your note about "${input.incomingEmail.subject}". Could you share any additional details so I can respond accurately?\n\nBest,\n${input.userEmail}`,
        confidence: 20,
        reasoning: `Style agent fallback used: ${message}`.slice(0, 500),
      };
    }
  }
}
