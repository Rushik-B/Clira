import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { EmailFilterService, type EmailMessage, type FilterResult } from '@/lib/email/emailFilterService';
import { ReplyGeneratorService, type EnhancedReplyResult } from '@/lib/services/core/replyGenerator';
import { ReplyRouterAgent } from '@/lib/ai/agents/replyRouterAgent';
import type { ReplyRouterDecisionDTO } from '@/lib/ai/schemas/schemas';

const InjectedEmailSchema = z.object({
  from: z.string().min(1),
  to: z.array(z.string().min(1)).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.array(z.string().min(1)).optional().default([]),
  labelIds: z.array(z.string().min(1)).optional().default([]),
  date: z.string().optional(),
  messageId: z.string().min(1).optional(),

  /**
   * Optional DB thread ID to fetch thread context during reply generation.
   * When omitted, generation runs without DB thread context unless `simulateReply`
   * + `parentMessageId` resolves to an existing thread.
   */
  threadId: z.string().min(1).optional(),

  simulateReply: z.boolean().optional(),
  parentMessageId: z.string().min(1).optional(),
}).strict();

export type InjectedEmailInput = z.infer<typeof InjectedEmailSchema>;

export type InjectionHarnessResult =
  | {
      success: true;
      filtered: true;
      message: string;
      routerDecision?: ReplyRouterDecisionDTO | null;
      injectedEmail: {
        from: string;
        to: string[];
        cc: string[];
        subject: string;
        body: string;
        date: string;
        messageId: string;
        rfc2822MessageId: string;
        labelIds: string[];
        threadId: string | null;
        simulateReply: boolean;
        parentMessageId: string | null;
      };
      filterResult: FilterResult;
      generatedReply: null;
      timingsMs: { total: number; filter: number; router?: number };
    }
  | {
      success: true;
      filtered: false;
      message: string;
      routerDecision?: ReplyRouterDecisionDTO | null;
      injectedEmail: {
        from: string;
        to: string[];
        cc: string[];
        subject: string;
        body: string;
        date: string;
        messageId: string;
        rfc2822MessageId: string;
        labelIds: string[];
        threadId: string | null;
        simulateReply: boolean;
        parentMessageId: string | null;
      };
      filterResult: FilterResult;
      generatedReply: EnhancedReplyResult;
      timingsMs: { total: number; filter: number; router?: number; reply: number };
    };

function stableHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 24);
}

function parseInjectedDate(date: string | undefined): Date {
  if (!date) {
    return new Date();
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date "${date}". Use an ISO date string (e.g. "2025-12-19T17:00:00Z") or omit it.`);
  }

  return parsed;
}

async function resolveThreadIdFromParentMessage({
  userId,
  parentMessageId,
}: {
  userId: string;
  parentMessageId: string;
}): Promise<string | null> {
  const parent = await prisma.email.findFirst({
    where: {
      messageId: parentMessageId,
      thread: { userId },
    },
    select: { threadId: true },
  });

  return parent?.threadId ?? null;
}

export async function runInjectionHarness({
  userId,
  userEmail,
  rawEmail,
}: {
  userId: string;
  userEmail: string;
  rawEmail: unknown;
}): Promise<InjectionHarnessResult> {
  const startTotal = Date.now();
  const injected = InjectedEmailSchema.parse(rawEmail);

  const injectedDate = parseInjectedDate(injected.date);
  const dateIso = injectedDate.toISOString();

  const deterministicMessageId =
    injected.messageId ??
    `${stableHash(
      JSON.stringify({
        userId,
        from: injected.from,
        to: injected.to,
        cc: injected.cc,
        subject: injected.subject,
        body: injected.body,
        date: dateIso,
      }),
    )}@test-simulator.clira.com`;

  const rfc2822MessageId = `<${deterministicMessageId}>`;

  const shouldResolveThreadFromParent = (injected.simulateReply ?? false) && !!injected.parentMessageId;
  const resolvedThreadId = shouldResolveThreadFromParent
    ? await resolveThreadIdFromParentMessage({ userId, parentMessageId: injected.parentMessageId! })
    : null;

  const threadId = injected.threadId ?? resolvedThreadId ?? null;

  const emailMessage: EmailMessage = {
    messageId: deterministicMessageId,
    labelIds: injected.labelIds,
    from: injected.from,
    to: injected.to,
    cc: injected.cc,
    subject: injected.subject,
    body: injected.body,
  };

  const emailFilterService = new EmailFilterService();
  const startFilter = Date.now();
  const filterResult = await emailFilterService.shouldReplyToEmail(emailMessage, userId, userEmail);
  const filterMs = Date.now() - startFilter;

  // Router is always enabled in the new reply system
  let routerDecision: ReplyRouterDecisionDTO | null = null;
  let routerMs: number | undefined;

  if (filterResult.shouldReply) {
    const startRouter = Date.now();
    const router = new ReplyRouterAgent();
    routerDecision = await router.evaluate({
      userId,
      userEmail,
      message: emailMessage,
      filterResult,
      strict: true,
    });
    routerMs = Date.now() - startRouter;
    console.log(
      `[reply-router] Decision: ${routerDecision.shouldReply ? 'ALLOW' : 'BLOCK'} (${routerDecision.reason})`,
    );
  }

  const injectedEmailPayload = {
    from: injected.from,
    to: injected.to,
    cc: injected.cc,
    subject: injected.subject,
    body: injected.body,
    date: dateIso,
    messageId: deterministicMessageId,
    rfc2822MessageId,
    labelIds: injected.labelIds,
    threadId,
    simulateReply: injected.simulateReply ?? false,
    parentMessageId: injected.parentMessageId ?? null,
  };

  if (!filterResult.shouldReply) {
    const total = Date.now() - startTotal;
    return {
      success: true,
      filtered: true,
      message: 'Email injected but filtered out',
      routerDecision: routerDecision ?? null,
      injectedEmail: injectedEmailPayload,
      filterResult,
      generatedReply: null,
      timingsMs: { total, filter: filterMs, router: routerMs },
    };
  }

  if (routerDecision && !routerDecision.shouldReply) {
    const total = Date.now() - startTotal;
    return {
      success: true,
      filtered: true,
      message: 'Email injected but blocked by Router LLM',
      routerDecision,
      injectedEmail: injectedEmailPayload,
      filterResult,
      generatedReply: null,
      timingsMs: { total, filter: filterMs, router: routerMs },
    };
  }

  const replyGenerator = new ReplyGeneratorService();
  const startReply = Date.now();
  const generatedReply = await replyGenerator.generateReply({
    userId,
    gmailMessageId: undefined, // Injection harness doesn't have real Gmail messages
    currentLabelIds: undefined,
    incomingEmail: {
      from: injected.from,
      to: injected.to,
      subject: injected.subject,
      body: injected.body,
      date: injectedDate,
      threadId: threadId ?? undefined,
    },
    strict: true,
  });
  const replyMs = Date.now() - startReply;

  const total = Date.now() - startTotal;
  return {
    success: true,
    filtered: false,
    message: 'Email injected and reply generated (no DB/Gmail persistence)',
    routerDecision: routerDecision ?? null,
    injectedEmail: injectedEmailPayload,
    filterResult,
    generatedReply,
    timingsMs: { total, filter: filterMs, router: routerMs, reply: replyMs },
  };
}
