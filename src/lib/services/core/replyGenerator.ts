import { prisma } from '../../prisma';
import { getDefaultMasterPrompt } from '../../prompts';
import { ReplyPlannerAgent } from '@/lib/ai/agents/replyPlannerAgent';
import { StyleAgent } from '@/lib/ai/agents/styleAgent';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { GmailService, EmailData } from '@/lib/email/gmail';
import type { EmailContext, ReplyGenerationResult } from '../../ml/llm';
import type { AiTraceContext } from '@/lib/ai/tracing';
import {
  createAiTraceRoot,
  deriveOutputPreview,
  deriveRunStatusFromError,
  finalizeAiTraceRun,
  withAiTraceSpan,
} from '@/lib/ai/tracing';

export interface IncomingEmailData {
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: Date;
  threadId?: string; // Add thread ID for thread context
}

export interface ReplyGenerationParams {
  userId: string;
  emailId?: string;
  /**
   * Optional mailbox context for multi-inbox support.
   * When provided, Gmail reads/writes are scoped to this mailbox.
   */
  mailboxId?: string;
  /**
   * Optional mailbox email address (used for prompt context).
   */
  mailboxEmail?: string;
  incomingEmail: IncomingEmailData;
  /**
   * Gmail message ID (required for label application)
   */
  gmailMessageId?: string;
  /**
   * Current Gmail label IDs on this message (for duplicate detection)
   */
  currentLabelIds?: string[];
  /**
   * When true, do not fall back to the "traditional" pipeline on failures.
   * This is intended for deterministic testing/injection harness runs where
   * failures must be visible (no hidden fallbacks).
   */
  strict?: boolean;
  traceContext?: AiTraceContext;
}

export interface EnhancedReplyResult extends ReplyGenerationResult {
  contextualInfo?: {
    calendarUsed: boolean;
    emailsAnalyzed: number;
    suggestedActions: string[];
    contextConfidence: number;
    emailSummary?: string;
    plannerPlan?: unknown;
    traceRunId?: string;
  };
}

export class ReplyGeneratorService {
  constructor() {
    // Service is stateless - all agents are instantiated per request
  }

  /**
   * Enhanced main entry point - now with two-stage generation
   */
  async generateReply(params: ReplyGenerationParams): Promise<EnhancedReplyResult> {
    const logBlock = (lines: string[]) => {
      console.log(lines.map((l) => `[reply-gen] ${l}`).join('\n'));
    };

    const ownsTraceContext = !params.traceContext;
    const traceContext = params.traceContext ?? await createAiTraceRoot({
      pipeline: 'reply-generation',
      userId: params.userId,
      channel: 'email',
      emailId: params.emailId ?? null,
      mailboxId: params.mailboxId ?? null,
      externalMessageId: params.gmailMessageId ?? null,
      label: 'reply-generator',
      inputPreview: `${params.incomingEmail.subject} <- ${params.incomingEmail.from}`,
      metadata: {
        source: 'ReplyGeneratorService',
        threadId: params.incomingEmail.threadId ?? null,
      },
    });

    logBlock([
      `🚀 Start v4 user=${params.userId}`,
      `📨 Email: from=${params.incomingEmail.from} subject="${params.incomingEmail.subject}" threadId=${params.incomingEmail.threadId ?? '(none)'}`,
    ]);
    
    try {
      // **SAFETY CHECK**: Ensure user has completed onboarding
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: {
          email: true,
          masterPromptGenerated: true
        }
      });

      if (!user) {
        throw new Error(`User ${params.userId} not found`);
      }

      const onboardingComplete = user.masterPromptGenerated;

      if (!onboardingComplete) {
        console.warn(`⚠️ Onboarding incomplete for user ${params.userId}. Cannot generate reply.`, {
          masterPrompt: user.masterPromptGenerated
        });

        const fallbackResult: EnhancedReplyResult = {
          reply: "System is still setting up your personalized email style. Please wait a moment and try again.",
          confidence: 0,
          reasoning: "User onboarding not complete",
          contextualInfo: {
            calendarUsed: false,
            emailsAnalyzed: 0,
            suggestedActions: [],
            contextConfidence: 0,
            traceRunId: traceContext.runId,
          }
        };
        if (ownsTraceContext) {
          await finalizeAiTraceRun(traceContext, {
            status: 'FALLBACK',
            outputPreview: deriveOutputPreview(fallbackResult.reply),
            errorMessage: 'user_onboarding_incomplete',
            metadata: {
              masterPromptGenerated: user.masterPromptGenerated,
            },
          });
        }
        return fallbackResult;
      }

      const mailboxContext = await withAiTraceSpan(
        traceContext,
        {
          kind: 'STAGE',
          name: 'resolve-mailbox-context',
          input: {
            mailboxId: params.mailboxId ?? null,
            mailboxEmail: params.mailboxEmail ?? null,
            gmailMessageId: params.gmailMessageId ?? null,
          },
        },
        async () => {
          const result = await this.resolveMailboxContext({
            userId: params.userId,
            mailboxId: params.mailboxId,
            mailboxEmail: params.mailboxEmail,
            gmailMessageId: params.gmailMessageId,
          });
          return { result, output: result };
        },
      );

      const mailboxId = mailboxContext?.mailboxId ?? params.mailboxId ?? undefined;
      const mailboxEmail = mailboxContext?.mailboxEmail ?? params.mailboxEmail ?? undefined;

      if (!mailboxId) {
        logBlock(['⚠️ Mailbox context missing; Gmail operations may be limited.']);
      } else {
        logBlock([`📬 Mailbox context: mailboxId=${mailboxId}${mailboxEmail ? ` email=${mailboxEmail}` : ''}`]);
      }

      const effectiveUserEmail = mailboxEmail || user.email;

      // Stage 1: Planner Agent - tool-using agent that produces a structured plan
      logBlock(['🧠 Stage 1: Planner (tool-using)']);

      const planner = new ReplyPlannerAgent();
      const plan = await withAiTraceSpan(
        traceContext,
        {
          kind: 'STAGE',
          name: 'planner',
          input: {
            subject: params.incomingEmail.subject,
            from: params.incomingEmail.from,
            threadId: params.incomingEmail.threadId ?? null,
          },
        },
        async (plannerTraceContext) => {
          const result = await planner.plan({
            userId: params.userId,
            userEmail: effectiveUserEmail,
            mailboxId,
            message: {
              messageId: params.gmailMessageId || 'unknown',
              labelIds: params.currentLabelIds || [],
              from: params.incomingEmail.from,
              to: params.incomingEmail.to || [],
              cc: [],
              subject: params.incomingEmail.subject,
              body: params.incomingEmail.body,
            },
            receivedAt: params.incomingEmail.date,
            threadId: params.incomingEmail.threadId ?? null,
            strict: params.strict,
            traceContext: plannerTraceContext,
          });
          return { result, output: result };
        },
      );

      const contextualDraft = plan.draft?.trim() || undefined;
      const plannerCcRecipients = plan.ccSuggestions.map((x) => x.email.trim()).filter((email) => email.length > 0);
      const toolUsage = plan.toolUsage;

      logBlock([
        `✅ Planner: draftChars=${(contextualDraft ?? '').length} cc=${plannerCcRecipients?.length ?? 0}`,
        `🧰 Tools: calendar=${!!toolUsage?.calendarUsed} thread=${!!toolUsage?.threadUsed} directHistory=${!!toolUsage?.directEmailHistoryUsed} keywordSearch=${!!toolUsage?.keywordEmailSearchUsed} memory=${!!toolUsage?.memorySearchUsed}`,
      ]);

      // Stage 2: Style Agent - applies user's voice to the Planner's draft
      logBlock(['🎨 Stage 2: Style Agent']);

      // Get user's Master Prompt
      const masterPrompt = await withAiTraceSpan(
        traceContext,
        {
          kind: 'STAGE',
          name: 'get-master-prompt',
          input: { userId: params.userId },
        },
        async () => {
          const result = await this.getMasterPrompt(params.userId);
          return { result, output: { length: result.length } };
        },
      );
      logBlock([`📝 Master Prompt: chars=${masterPrompt.length}`]);

      // Get historical emails with sender for style examples (limit to 6 most recent)
      const emailHistory = await withAiTraceSpan(
        traceContext,
        {
          kind: 'STAGE',
          name: 'fetch-style-history',
          input: {
            sender: params.incomingEmail.from,
            mailboxId,
          },
        },
        async () => {
          const result = await this.fetchEmailHistory(params.userId, params.incomingEmail.from, mailboxId);
          return { result, output: { count: result.length } };
        },
      );
      logBlock([`📧 Style examples: emails=${emailHistory.length}`]);

      // Call Style Agent to generate final styled reply
      const styleAgent = new StyleAgent();
      const result = await withAiTraceSpan(
        traceContext,
        {
          kind: 'STAGE',
          name: 'style-agent',
          input: {
            subject: params.incomingEmail.subject,
            from: params.incomingEmail.from,
            styleExampleCount: Math.min(emailHistory.length, 6),
          },
        },
        async (styleTraceContext) => {
          const generated = await styleAgent.generate({
            userId: params.userId,
            userEmail: effectiveUserEmail,
            incomingEmail: params.incomingEmail,
            plan,
            masterPrompt,
            styleExamples: emailHistory.slice(0, 6), // Limit to 6 most recent for token efficiency
            strict: params.strict,
            traceContext: styleTraceContext,
          });
          return { result: generated, output: generated };
        },
      );

      // Planner CC suggestions are authoritative
      const unique = Array.from(new Set(plannerCcRecipients)).filter(Boolean);
      if (unique.length > 0) {
        result.ccRecipients = unique;
      }

      // Enhance result with contextual information
      const calendarUsed = !!toolUsage?.calendarUsed;
      const emailsAnalyzed = 0; // Planner doesn't track this legacy metric
      const suggestedActions: string[] = [];
      const contextConfidence = 0; // Planner uses tool-based context, not confidence scores

      const enhancedResult: EnhancedReplyResult = {
        ...result,
        contextualInfo: {
          calendarUsed,
          emailsAnalyzed,
          suggestedActions,
          contextConfidence,
          emailSummary: undefined,
          plannerPlan: plan, // Debug-only: surfaced in Injection Harness + dev UI
          traceRunId: traceContext.runId,
        }
      };

      logBlock([
        `✨ Done: styleConfidence=${result.confidence}%`,
        `📊 Context: calendar=${calendarUsed} thread=${!!toolUsage?.threadUsed} directHistory=${!!toolUsage?.directEmailHistoryUsed}`,
      ]);

      // Per-call token usage is logged via src/lib/ai/callLlm.ts

      if (ownsTraceContext) {
        await finalizeAiTraceRun(traceContext, {
          status: 'OK',
          outputPreview: deriveOutputPreview(enhancedResult.reply),
          metadata: {
            confidence: enhancedResult.confidence,
            ccRecipients: enhancedResult.ccRecipients ?? [],
            plannerToolUsage: toolUsage,
          },
        });
      }

      return enhancedResult;

    } catch (error) {
      console.error('❌ Error in reply generation:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (ownsTraceContext) {
        await finalizeAiTraceRun(traceContext, {
          status: deriveRunStatusFromError(error),
          outputPreview: null,
          errorMessage: message,
          metadata: {
            failure: 'reply-generation',
          },
        });
      }
      throw new Error(`ReplyGenerationFailed: ${message}`);
    }
  }

  /**
   * Fetches the user's master prompt or returns default
   */
  private async getMasterPrompt(userId: string): Promise<string> {
    try {
      const masterPrompt = await prisma.masterPrompt.findFirst({
        where: {
          userId,
          isActive: true
        },
        orderBy: {
          version: 'desc'
        }
      });

      if (!masterPrompt) {
        return getDefaultMasterPrompt();
      }

      // If this is an AI-generated prompt with metadata, use the full Master Prompt
      if (masterPrompt.isGenerated && masterPrompt.metadata) {
        const metadata = masterPrompt.metadata as any;
        const fullMasterPrompt = metadata.fullMasterPrompt;
        const hasUserEdits = metadata.hasUserEdits;
        
        if (fullMasterPrompt) {
          console.log(`📝 Using full Master Prompt v${masterPrompt.version}${hasUserEdits ? ' (with user edits)' : ''}`);
          
          // Add priority instruction for USER_DIRECTIVE markers if user has made edits
          if (hasUserEdits) {
            return `${fullMasterPrompt}

**IMPORTANT PRIORITY INSTRUCTION:**
When generating replies, give HIGHEST PRIORITY to any instructions marked with "(USER_DIRECTIVE)" in the above Master Prompt. These represent explicit user preferences that override general patterns derived from email analysis. Always honor USER_DIRECTIVE instructions over other style guidance.`;
          }
          
          return fullMasterPrompt;
        }
      }

      // Fallback to the distilled prompt (what user sees in UI)
      return masterPrompt.prompt || getDefaultMasterPrompt();
    } catch (error) {
      console.error('Error fetching master prompt:', error);
      return getDefaultMasterPrompt();
    }
  }

  /**
   * Gets a GmailService instance for the user
   */
  private async getGmailService(userId: string, mailboxId?: string): Promise<GmailService | null> {
    try {
      const gmailResult = await createGmailServiceForUser({
        userId,
        mailboxId,
        purpose: 'reply-gen:fetch-email-history',
        requester: 'ReplyGeneratorService',
      });
      return gmailResult?.gmail ?? null;
    } catch (error) {
      console.error('Error creating Gmail service:', error);
      return null;
    }
  }

  /**

  * Fetches email history with the specified sender directly from Gmail API
   * This helps understand the user's communication style with this person
   */
  private async fetchEmailHistory(
    userId: string,
    senderEmail: string,
    mailboxId?: string,
  ): Promise<EmailContext['historicalEmails']> {
    try {
      const lines: string[] = [];
      lines.push(
        `[reply-gen] 📧 Fetching sender history from Gmail: target=${senderEmail} user=${userId}${
          mailboxId ? ` mailbox=${mailboxId}` : ''
        }`,
      );

      const gmailService = await this.getGmailService(userId, mailboxId);
      if (!gmailService) {
        lines.push(`[reply-gen]   ⚠️ No Gmail service available, returning empty history`);
        console.log(lines.join('\n'));
        return [];
      }

      // Extract just the email address if it contains name + email format like "John Doe <john@example.com>"
      const emailMatch = senderEmail.match(/<([^>]+)>/);
      const cleanSenderEmail = emailMatch ? emailMatch[1] : senderEmail;

      // Gmail query: find emails TO or FROM this sender (last 90 days for performance)
      // Priority: emails the user has SENT to this person (for style matching)
      const sentQuery = `to:${cleanSenderEmail} in:sent`;
      const receivedQuery = `from:${cleanSenderEmail}`;
      
      lines.push(`[reply-gen]   • Gmail query (sent): "${sentQuery}"`);
      lines.push(`[reply-gen]   • Gmail query (received): "${receivedQuery}"`);

      // Fetch sent emails first (priority for style analysis)
      const sentEmails = await gmailService.searchEmails(sentQuery, 15);
      lines.push(`[reply-gen]   • sentToSender=${sentEmails.length}`);

      // Also fetch received emails from this sender
      const receivedEmails = await gmailService.searchEmails(receivedQuery, 10);
      lines.push(`[reply-gen]   • receivedFromSender=${receivedEmails.length}`);

      // Combine and deduplicate (sent emails first for style priority)
      const allEmails: EmailData[] = [...sentEmails, ...receivedEmails];
      const seenIds = new Set<string>();
      const uniqueEmails: EmailData[] = [];
      
      for (const email of allEmails) {
        if (!seenIds.has(email.messageId)) {
          seenIds.add(email.messageId);
          uniqueEmails.push(email);
        }
      }

      lines.push(`[reply-gen]   • totalUnique=${uniqueEmails.length}`);

      // Sort by date descending (most recent first)
      uniqueEmails.sort((a, b) => b.date.getTime() - a.date.getTime());

      // Take top 25 for context
      const limitedEmails = uniqueEmails.slice(0, 25);

      if (limitedEmails.length > 0) {
        lines.push(
          `[reply-gen]   • dateRange=${limitedEmails[limitedEmails.length - 1].date.toISOString()} → ${limitedEmails[0].date.toISOString()}`,
        );
      }

      console.log(lines.join('\n'));

      return limitedEmails.map(email => ({
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        date: email.date,
        isSent: email.isSent
      }));
    } catch (error) {
      console.error('Error fetching email history from Gmail:', error);
      return [];
    }
  }

  private async resolveMailboxContext(params: {
    userId: string;
    mailboxId?: string;
    mailboxEmail?: string;
    gmailMessageId?: string;
  }): Promise<{ mailboxId?: string; mailboxEmail?: string } | null> {
    const { userId, mailboxId, mailboxEmail, gmailMessageId } = params;

    if (mailboxId) {
      if (mailboxEmail) {
        return { mailboxId, mailboxEmail };
      }

      const mailbox = await prisma.mailbox.findFirst({
        where: {
          id: mailboxId,
          userId,
        },
        select: {
          emailAddress: true,
        },
      });

      return mailbox ? { mailboxId, mailboxEmail: mailbox.emailAddress } : { mailboxId };
    }

    if (mailboxEmail) {
      const mailbox = await prisma.mailbox.findFirst({
        where: {
          userId,
          emailAddress: mailboxEmail.toLowerCase(),
        },
        select: {
          id: true,
          emailAddress: true,
        },
      });

      if (mailbox) {
        return { mailboxId: mailbox.id, mailboxEmail: mailbox.emailAddress };
      }
    }

    if (gmailMessageId) {
      const matches = await prisma.email.findMany({
        where: {
          messageId: gmailMessageId,
          thread: { userId },
        },
        select: {
          mailboxId: true,
          mailbox: {
            select: {
              emailAddress: true,
            },
          },
        },
      });

      const unique = new Map<string, string | undefined>();
      for (const match of matches) {
        if (match.mailboxId) {
          unique.set(match.mailboxId, match.mailbox?.emailAddress);
        }
      }

      if (unique.size === 1) {
        const [id, email] = Array.from(unique.entries())[0];
        return { mailboxId: id, mailboxEmail: email };
      }

      if (unique.size > 1) {
        console.warn(
          `[reply-gen] ⚠️ Multiple mailbox matches for gmailMessageId=${gmailMessageId}; skipping mailbox resolution.`,
        );
      }
    }

    return null;
  }

  /**
   * Helper method to create a default master prompt for a user
   */
  async createDefaultMasterPrompt(userId: string): Promise<void> {
    try {
      // Check if user already has a master prompt
      const existingPrompt = await prisma.masterPrompt.findFirst({
        where: { userId }
      });

      if (!existingPrompt) {
        await prisma.masterPrompt.create({
          data: {
            userId,
            prompt: getDefaultMasterPrompt(),
            version: 1,
            isActive: true
          }
        });
        console.log(`Created default master prompt for user ${userId}`);
      }
    } catch (error) {
      console.error('Error creating default master prompt:', error);
    }
  }
} 
