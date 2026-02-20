import { callObject } from '../callLlm';
import { models } from '../models';
import { ReplyGenerationResultSchema, type ReplyGenerationResultDTO } from '../schemas/schemas';
import { getReplyGenerationPrompt } from '../../prompts';

const PROMPT_LEAK_MARKERS = [
  '1. INPUT VALIDATION & STRATEGIC ASSESSMENT',
  '# THINKING ORDER',
  '# OUTPUT SPEC',
  '# ADVANCED SYNTHESIS PRINCIPLES',
  '# CRITICAL CONSTRAINTS',
  'EMAIL_SUMMARY:',
  'POS ASSESSMENT:',
];

const stripPromptLeakage = (text: string): string => {
  if (!text) {
    return text;
  }

  let sanitized = text;
  for (const marker of PROMPT_LEAK_MARKERS) {
    const idx = sanitized.indexOf(marker);
    if (idx !== -1) {
      sanitized = sanitized.slice(0, idx).trimEnd();
      break;
    }
  }

  if (sanitized.length !== text.length) {
    console.warn('⚠️ Detected and removed prompt instructions leaked into reply output.');
  }

  if (sanitized.trim().length === 0) {
    return text.trim();
  }

  return sanitized;
};

export type EmailContext = {
  incomingEmail: {
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
  };
  conversationThread?: Array<{
    from: string;
    to: string[];
    subject: string;
    body: string;
    date: Date;
    isSent: boolean;
  }>;
};

/**
 * Generate a structured email reply using AI SDK and Zod schema enforcement.
 */
export async function generateReply({
  masterPrompt,
  emailContext,
  styleSummary,
  contextualDraft,
  abortSignal,
}: {
  masterPrompt: string;
  emailContext: EmailContext;
  styleSummary?: string;
  contextualDraft?: string;
  abortSignal?: AbortSignal;
}): Promise<ReplyGenerationResultDTO> {
  const template = getReplyGenerationPrompt();

  const styleContext = styleSummary
    ? `Communication Style Analysis:\n${styleSummary}\n`
    : 'No previous communication history available.\n';

  const threadContext = emailContext.conversationThread && emailContext.conversationThread.length > 0
    ? `\nCONVERSATION THREAD HISTORY (chronological order):\n${
        emailContext.conversationThread
          .map((email, index) => {
            const direction = email.isSent ? '[YOU SENT]' : '[THEY SENT]';
            const date = email.date.toLocaleDateString();
            const content = email.body.substring(0, 300) + (email.body.length > 300 ? '...' : '');
            return `${index + 1}. ${direction} on ${date}\nFrom: ${email.from}\nTo: ${email.to.join(', ')}\nSubject: ${email.subject}\nContent: ${content}\n---`;
          })
          .join('\n')
      }\n`
    : '\nNo conversation thread history available.\n';

  const prompt = template
    .replace(/\{masterPrompt\}/g, masterPrompt)
    .replace(/\{fromEmail\}/g, emailContext.incomingEmail.from)
    .replace(/\{toEmails\}/g, emailContext.incomingEmail.to.join(', '))
    .replace(/\{subject\}/g, emailContext.incomingEmail.subject)
    .replace(/\{emailBody\}/g, emailContext.incomingEmail.body)
    .replace(/\{emailDate\}/g, emailContext.incomingEmail.date.toISOString())
    .replace(/\{styleContext\}/g, styleContext)
    .replace(/\{threadContext\}/g, threadContext)
    .replace(/\{contextualDraftInput\}/g, contextualDraft || '');

  const system =
    'You are an expert email assistant that generates professional, contextually appropriate email replies. Return only a JSON object with fields reply, confidence (0-100), reasoning, and optional ccRecipients[]. Do not include markdown, code fences, or any text outside the JSON. The reply field MUST preserve line breaks (\n) and include blank lines between paragraphs; never collapse the email body into a single line.';

  const { object } = await callObject<ReplyGenerationResultDTO>({
    model: models.pro(),
    system,
    prompt,
    schema: ReplyGenerationResultSchema,
    temperature: 0.7,
    op: 'reply.generate',
    concurrency: { key: 'reply', maxConcurrency: 2 },
    retry: { maxAttempts: 4 },
    abortSignal,
  });

  // Normalize whitespace defensively: ensure \r\n → \n, trim trailing spaces per line, and enforce single blank line between paragraphs
  const normalizeNewlines = (text: string): string => {
    if (!text) return text;
    // Normalize CRLF to LF
    let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Trim trailing spaces per line
    t = t
      .split('\n')
      .map((line) => line.replace(/[\t ]+$/g, ''))
      .join('\n');
    // Collapse multiple blank lines to a maximum of 2 consecutive newlines (one blank line)
    t = t.replace(/\n{3,}/g, '\n\n');
    return t;
  };

  const normalizedReply = stripPromptLeakage(normalizeNewlines(object.reply));

  const normalized = {
    ...object,
    reply: normalizedReply,
    reasoning: object.reasoning ? object.reasoning.replace(/\s+/g, ' ').trim() : object.reasoning,
  };

  return normalized;
}

