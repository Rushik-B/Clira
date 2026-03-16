import { readPromptFile } from '@/lib/prompts';
import { pruneEmailContentForRouting } from '@/lib/services/onboarding-services/utils/emailPruner';
import type { EmailMessage, FilterResult } from '@/lib/email/emailFilterService';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import {
  ReplyRouterAlertMatchSchema,
  ReplyRouterDecisionSchema,
  type ReplyRouterAlertMatchDTO,
  type ReplyRouterDecisionDTO,
} from '@/lib/ai/schemas/schemas';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import {
  EmailRouterService,
  type EmailToRoute,
  type RouterDecision,
} from '@/lib/email/emailRouterService';
import { GmailLabelClassifier } from '@/lib/services/utils/gmailLabelClassifier';
import { updateFolderEmailCount } from '@/lib/services/onboarding-services/utils/folderLabelUtils';

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

export type ReplyRouterRealtimeLabelStatus =
  | 'applied'
  | 'already-applied'
  | 'preserved-existing-custom-label'
  | 'skipped-auto-sorting-disabled'
  | 'skipped-missing-mailbox'
  | 'degraded-unsorted'
  | 'degraded-missing-label'
  | 'error';

export type ReplyRouterRealtimeLabelingResult = {
  status: ReplyRouterRealtimeLabelStatus;
  reason: string;
  decision?: RouterDecision;
  label?: {
    id: string;
    name: string;
    color?: string;
    gmailLabelId?: string;
  };
  preservedCustomLabels?: string[];
  emailSortId?: string;
};

export type ReplyRouterRealtimeInput = ReplyRouterAgentInput & {
  mailboxId?: string;
  mailboxEmail?: string;
  emailId?: string;
};

export type ReplyRouterRealtimeResult = {
  replyDecision: ReplyRouterDecisionDTO;
  labeling: ReplyRouterRealtimeLabelingResult;
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

type ActiveEmailAlert = {
  id: string;
  description: string | null;
};

function formatAlertsSection(alerts: ActiveEmailAlert[]): string {
  return alerts.length > 0
    ? alerts.map((alert) => `- [${alert.id}] ${safeString(alert.description)}`).join('\n')
    : '(No active alerts)';
}

async function listActiveAlerts(userId: string): Promise<ActiveEmailAlert[]> {
  return prisma.emailAlert.findMany({
    where: { userId, isActive: true },
    select: { id: true, description: true },
  });
}

async function buildReplyRouterPrompt(
  input: ReplyRouterAgentInput,
  alerts: ActiveEmailAlert[],
): Promise<string> {
  const template = readPromptFile('core-processing/replyRouterPrompt.md');

  const prunedBody = pruneEmailContentForRouting({
    subject: input.message.subject,
    body: input.message.body,
  }).prunedBody;

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
    .replace('{emailAlerts}', formatAlertsSection(alerts))
    .replace('{body}', prunedBody);
}

async function buildReplyRouterAlertPrompt(
  input: ReplyRouterAgentInput,
  alerts: ActiveEmailAlert[],
): Promise<string> {
  const template = readPromptFile('core-processing/replyRouterAlertPrompt.md');

  const prunedBody = pruneEmailContentForRouting({
    subject: input.message.subject,
    body: input.message.body,
  }).prunedBody;

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
    .replace('{emailAlerts}', formatAlertsSection(alerts))
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
      const alerts = await listActiveAlerts(input.userId);
      const prompt = await buildReplyRouterPrompt(input, alerts);
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

  async evaluateRealtimeRouting(input: ReplyRouterRealtimeInput): Promise<ReplyRouterRealtimeResult> {
    const replyDecision = input.filterResult.shouldReply
      ? await this.evaluate(input)
      : await this.evaluateAlertsOnly(input);

    const labeling = await this.applyRealtimeLabeling(input);
    return {
      replyDecision,
      labeling,
    };
  }

  private async evaluateAlertsOnly(input: ReplyRouterRealtimeInput): Promise<ReplyRouterDecisionDTO> {
    const blockedReason = `Reply policy blocked draft generation: ${input.filterResult.reason}`;

    try {
      const alerts = await listActiveAlerts(input.userId);
      if (alerts.length === 0) {
        return {
          shouldReply: false,
          reason: blockedReason,
          shouldNotify: false,
        };
      }

      const prompt = await buildReplyRouterAlertPrompt(input, alerts);
      const { object } = await callObject<ReplyRouterAlertMatchDTO>({
        model: models.flashLite(),
        system:
          'You classify whether an incoming email matches any user-defined alert. Return only a JSON object that matches the provided schema; do not include markdown, code fences, or extra commentary.',
        prompt,
        schema: ReplyRouterAlertMatchSchema,
        temperature: 0,
        op: 'reply.router.alerts',
        concurrency: { key: 'reply.router.alerts', maxConcurrency: 8 },
        retry: { maxAttempts: 3, baseDelayMs: 250 },
        abortSignal: input.abortSignal,
      });

      return {
        shouldReply: false,
        reason: blockedReason,
        shouldNotify: object.shouldNotify,
        matchedAlertId: object.shouldNotify ? object.matchedAlertId : undefined,
        matchedAlertDescription: object.shouldNotify ? object.matchedAlertDescription : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[replyRouterAgent] Alert-only evaluation failed: ${message}`);
      if (input.strict) {
        throw new Error(`ReplyRouterAlertMatchFailed: ${message}`);
      }

      return {
        shouldReply: false,
        reason: `${blockedReason} Alert matching unavailable.`,
        shouldNotify: false,
      };
    }
  }

  private async applyRealtimeLabeling(
    input: ReplyRouterRealtimeInput,
  ): Promise<ReplyRouterRealtimeLabelingResult> {
    if (!input.mailboxId) {
      return {
        status: 'skipped-missing-mailbox',
        reason: 'Mailbox context missing; skipping realtime label routing.',
      };
    }

    try {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId: input.userId },
        select: { autoSortingEnabled: true },
      });

      if (!userSettings?.autoSortingEnabled) {
        return {
          status: 'skipped-auto-sorting-disabled',
          reason: 'Automatic sorting is disabled for this user.',
        };
      }

      const currentLabelIds = Array.isArray(input.message.labelIds)
        ? input.message.labelIds.filter(Boolean)
        : [];
      const labelAnalysis = GmailLabelClassifier.hasCustomLabels(currentLabelIds);
      if (labelAnalysis.hasCustom) {
        return {
          status: 'preserved-existing-custom-label',
          reason: 'Email already has custom Gmail labels; preserving existing organization.',
          preservedCustomLabels: labelAnalysis.customLabels,
        };
      }

      const emailRouter = new EmailRouterService();
      const routeDecision = await emailRouter.routeSingleEmail(
        input.userId,
        this.toEmailToRoute(input),
        input.mailboxId,
      );

      if (!routeDecision.labelId || routeDecision.labelName === 'Unsorted') {
        return {
          status: 'degraded-unsorted',
          reason: routeDecision.reasoning || 'Realtime label routing returned no actionable label.',
          decision: routeDecision,
        };
      }

      const label = await prisma.label.findFirst({
        where: {
          id: routeDecision.labelId,
          userId: input.userId,
          mailboxId: input.mailboxId,
        },
        select: {
          id: true,
          name: true,
          color: true,
          gmailLabelId: true,
        },
      });
      const normalizedLabel = label
        ? {
            id: label.id,
            name: label.name,
            color: label.color || undefined,
            gmailLabelId: label.gmailLabelId || undefined,
          }
        : undefined;

      if (!label || !label.gmailLabelId) {
        return {
          status: 'degraded-missing-label',
          reason: `Resolved label "${routeDecision.labelName}" is missing a Gmail label id.`,
          decision: routeDecision,
        };
      }

      let status: ReplyRouterRealtimeLabelStatus = 'already-applied';
      let reason = `Label "${label.name}" was already present on the Gmail message.`;

      if (!currentLabelIds.includes(label.gmailLabelId)) {
        const gmailResult = await createGmailServiceForUser({
          userId: input.userId,
          mailboxId: input.mailboxId,
          purpose: 'reply-router:realtime-labeling',
          requester: 'ReplyRouterAgent.evaluateRealtimeRouting',
        });

        if (!gmailResult) {
          return {
            status: 'error',
            reason: 'Gmail service unavailable; unable to apply realtime label.',
            decision: routeDecision,
            label: normalizedLabel,
          };
        }

        await gmailResult.gmail.modifyLabelsOnEmail(input.message.messageId, [label.gmailLabelId], []);
        status = 'applied';
        reason = `Applied label "${label.name}" in realtime router path.`;
      }

      const persisted = await this.upsertRealtimeEmailSort({
        input,
        decision: routeDecision,
        label,
      });

      await this.recalculateFolderCounts(
        input.userId,
        persisted.previousLabelId,
        label.id,
      );

      if (status === 'applied') {
        await prisma.actionHistory.create({
          data: {
            userId: input.userId,
            actionType: 'EMAIL_EDITED',
            actionSummary: `Auto-labeled with "${label.name}"`,
            actionDetails: {
              emailId: input.emailId,
              gmailMessageId: input.message.messageId,
              labelName: label.name,
              gmailLabelId: label.gmailLabelId,
              reasoning: routeDecision.reasoning,
              source: 'reply-router-realtime',
            },
            emailReference: input.emailId,
            confidence: routeDecision.confidence,
            undoable: false,
            metadata: {
              source: 'reply-router-realtime',
              labelId: label.id,
            },
          },
        });
      }

      return {
        status,
        reason,
        decision: routeDecision,
        label: normalizedLabel,
        emailSortId: persisted.emailSortId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[replyRouterAgent] Realtime labeling failed: ${message}`);
      return {
        status: 'error',
        reason: `Realtime labeling failed: ${message}`,
      };
    }
  }

  private toEmailToRoute(input: ReplyRouterRealtimeInput): EmailToRoute {
    return {
      gmailMessageId: input.message.messageId,
      from: input.message.from,
      subject: input.message.subject,
      snippet: pruneEmailContentForRouting({
        subject: input.message.subject,
        body: input.message.body,
      }).prunedBody.slice(0, 500),
      body: input.message.body,
      to: input.message.to,
      cc: input.message.cc || [],
      labels: input.message.labelIds || [],
      mailboxId: input.mailboxId,
    };
  }

  private buildRealtimeSortDedupeKey(input: ReplyRouterRealtimeInput): string {
    return `router_realtime:${input.mailboxId}:${input.message.messageId}`;
  }

  private async upsertRealtimeEmailSort(params: {
    input: ReplyRouterRealtimeInput;
    decision: RouterDecision;
    label: { id: string };
  }): Promise<{ emailSortId: string; previousLabelId?: string }> {
    const { input, decision, label } = params;
    const dedupeKey = this.buildRealtimeSortDedupeKey(input);

    const existing = await prisma.emailSort.findUnique({
      where: { dedupeKey },
      select: { id: true, labelId: true },
    });

    const emailSort = await prisma.emailSort.upsert({
      where: { dedupeKey },
      update: {
        userId: input.userId,
        mailboxId: input.mailboxId,
        labelId: label.id,
        gmailMessageId: input.message.messageId,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        source: 'router_realtime',
        sortedAt: new Date(),
      },
      create: {
        userId: input.userId,
        mailboxId: input.mailboxId,
        labelId: label.id,
        gmailMessageId: input.message.messageId,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        source: 'router_realtime',
        dedupeKey,
      },
      select: { id: true },
    });

    return {
      emailSortId: emailSort.id,
      previousLabelId: existing?.labelId,
    };
  }

  private async recalculateFolderCounts(
    userId: string,
    previousLabelId: string | undefined,
    currentLabelId: string,
  ): Promise<void> {
    const touchedLabelIds = Array.from(
      new Set([previousLabelId, currentLabelId].filter((value): value is string => !!value)),
    );

    await Promise.all(
      touchedLabelIds.map(async (labelId) => {
        const count = await prisma.emailSort.count({
          where: {
            userId,
            labelId,
          },
        });
        await updateFolderEmailCount(labelId, count);
      }),
    );
  }
}
