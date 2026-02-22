import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { parseReminderTime } from '@/lib/utils/timeParser';
import { formatDateTimeInTimeZone } from '@/lib/utils/timezone';
import { getSupermemoryClient, isSupermemoryConfigured } from '@/lib/services/supermemory/client';
import {
  generateMemoryCustomId,
  truncate,
} from '../helpers';
import type {
  ExecutiveRuntimeContext,
} from '../types';

export function buildMessagingTools({
  context,
}: {
  context: ExecutiveRuntimeContext;
}): Record<string, unknown> {
  const {
    input,
    channel: resolvedChannel,
    userTimezone,
    onMemoryStored,
  } = context;

  const reminderRecurrenceSchema = z.object({
    type: z.enum(['daily', 'weekly', 'monthly']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    until: z.string().optional(),
  });
  const reminderClosedStatuses = new Set(['DISMISSED', 'COMPLETED', 'MISSED', 'CANCELLED']);
  const reminderNonCancelableStatuses = new Set(['DELIVERED', 'DISMISSED', 'COMPLETED', 'MISSED', 'CANCELLED']);

  return {
      // Tool 7: Append to Memory
      // ─────────────────────────────────────────────────────────────────────────
      append_to_supermemory: {
        description:
          'Store a fact to memory so you remember it in future conversations. Call in two cases: ' +
          '(1) When the user reveals names, roles, preferences, or facts—store them. ' +
          '(2) When you DISCOVER accurate, high-confidence facts from your tools (search_inbox_context, search_calendar)—e.g. you find "Dr. Smith" is the user\'s statistics professor from emails, or "Sarah" is their manager from calendar—store that too. ' +
          'High confidence only; don\'t guess. One atomic sentence per memory. Memory is deduped—storing the same fact twice is safe. You can\'t rely on the user to say everything.',
        inputSchema: z.object({
          content: z.string().min(1).max(300).describe('Atomic memory line (1 sentence describing a user fact)'),
          type: z
            .enum(['user_preference', 'user_fact', 'relationship_info', 'scheduling_preference', 'communication_style'])
            .default('user_preference')
            .describe('Category of the memory'),
        }),
        execute: async (args: { content: string; type: string }) => {
          logger.info(`[executiveAgent] append_to_supermemory: "${truncate(args.content, 50)}"`);

          if (!isSupermemoryConfigured()) {
            return { stored: false, reason: 'Memory system not configured' };
          }

          try {
            const customId = generateMemoryCustomId(input.userId, resolvedChannel, args.content);
            const client = getSupermemoryClient();

            await client.addDocument({
              content: args.content,
              customId,
              metadata: {
                type: args.type,
                source: resolvedChannel,
                timestamp: new Date().toISOString(),
              },
              containerTags: [input.userId],
              userId: input.userId,
            });

            onMemoryStored();
            logger.info(`[executiveAgent] Memory stored: customId=${customId}`);

            return { stored: true, customId };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.warn(`[executiveAgent] Memory storage failed: ${message}`);
            return { stored: false, reason: message };
          }
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 8: Add Email Alert
      // ─────────────────────────────────────────────────────────────────────────
      add_email_alert: {
        description:
          'Create an email notification alert. You will be notified via your linked messaging channel when matching emails arrive. ' +
          'Examples: "emails from my teacher", "emails about invoices", "emails from john@company.com", etc...',
        inputSchema: z.object({
          description: z
            .string()
            .min(5)
            .max(300)
            .describe('What emails to alert on (natural language)'),
        }),
        execute: async (args: { description: string }) => {
          const description = args.description.trim();
          if (description.length < 5) {
            return { success: false, message: 'Please provide a longer alert description.' };
          }

          const alert = await prisma.emailAlert.create({
            data: {
              userId: input.userId,
              description,
              isActive: true,
            },
          });

          logger.info(`[executiveAgent] Created email alert: ${alert.id}`);

          return {
            success: true,
            alertId: alert.id,
            description,
            message: `Got it! I'll notify you when emails matching "${description}" arrive.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 9: Remove Email Alert
      // ─────────────────────────────────────────────────────────────────────────
      remove_email_alert: {
        description:
          'Remove an email alert by ID or find by description. ' +
          'Use list_email_alerts first to see active alerts.',
        inputSchema: z.object({
          alertId: z.string().optional().describe('Alert ID to remove'),
          descriptionMatch: z.string().optional().describe('Find alert by partial description match'),
        }),
        execute: async (args: { alertId?: string; descriptionMatch?: string }) => {
          if (!args.alertId && !args.descriptionMatch) {
            return { success: false, message: 'Provide an alertId or descriptionMatch.' };
          }

          let alert: { id: string; description: string } | null = null;

          if (args.alertId) {
            alert = await prisma.emailAlert.findFirst({
              where: { id: args.alertId, userId: input.userId },
              select: { id: true, description: true },
            });
          } else if (args.descriptionMatch) {
            alert = await prisma.emailAlert.findFirst({
              where: {
                userId: input.userId,
                isActive: true,
                description: { contains: args.descriptionMatch, mode: 'insensitive' },
              },
              select: { id: true, description: true },
            });
          }

          if (!alert) {
            return { success: false, message: 'Alert not found.' };
          }

          await prisma.emailAlert.delete({ where: { id: alert.id } });
          logger.info(`[executiveAgent] Removed email alert: ${alert.id}`);

          return {
            success: true,
            alertId: alert.id,
            message: `Removed alert: "${alert.description}"`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 10: List Email Alerts
      // ─────────────────────────────────────────────────────────────────────────
      list_email_alerts: {
        description: 'List all active email alerts.',
        inputSchema: z.object({}),
        execute: async () => {
          const alerts = await prisma.emailAlert.findMany({
            where: { userId: input.userId, isActive: true },
            orderBy: { createdAt: 'desc' },
            select: { id: true, description: true, createdAt: true },
          });

          return {
            count: alerts.length,
            alerts: alerts.map((alert) => ({
              id: alert.id,
              description: alert.description,
              createdAt: alert.createdAt.toISOString(),
            })),
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 11: Add Reminder
      // ─────────────────────────────────────────────────────────────────────────
      add_reminder: {
        description:
          'Create a time-based reminder. Prefer natural language like "today 4pm", "tomorrow 9am", or "4:00 PM" (assumed in the user\'s timezone). ' +
          'Only use ISO timestamps if you are certain about timezone conversion: a trailing "Z" means UTC. ' +
          'Always ensure the time is in the future.',
        inputSchema: z.object({
          title: z.string().min(1).max(200).describe('Short reminder title'),
          scheduledAt: z.string().min(1).max(200).describe('Reminder time (natural language preferred; ISO UTC allowed)'),
          context: z.string().max(1000).optional().describe('Additional context or urgency notes'),
          recurrence: reminderRecurrenceSchema.optional(),
          linkedEmailId: z.string().optional(),
          linkedEventId: z.string().optional(),
        }),
        execute: async (args: {
          title: string;
          scheduledAt: string;
          context?: string;
          recurrence?: z.infer<typeof reminderRecurrenceSchema>;
          linkedEmailId?: string;
          linkedEventId?: string;
        }) => {
          const title = args.title.trim();
          if (!title) {
            return { success: false, message: 'Reminder title is required.' };
          }

          const now = new Date();
          const parsed = parseReminderTime(args.scheduledAt, { now, timeZone: userTimezone });
          if (!parsed || Number.isNaN(parsed.date.getTime())) {
            return { success: false, message: 'Could not parse the reminder time. Try a specific time.' };
          }
          if (parsed.date.getTime() <= now.getTime()) {
            return { success: false, message: 'That time is in the past. Provide a future time.' };
          }

          if (args.recurrence?.until) {
            const untilDate = new Date(args.recurrence.until);
            if (Number.isNaN(untilDate.getTime())) {
              return { success: false, message: 'Recurrence "until" must be a valid ISO date.' };
            }
            if (untilDate.getTime() <= parsed.date.getTime()) {
              return { success: false, message: 'Recurrence "until" must be after the scheduled time.' };
            }
          }

          const reminder = await prisma.reminder.create({
            data: {
              userId: input.userId,
              title,
              context: args.context?.trim() || undefined,
              scheduledAt: parsed.date,
              recurrence: args.recurrence ?? undefined,
              linkedEmailId: args.linkedEmailId,
              linkedEventId: args.linkedEventId,
            },
          });

          const scheduledAtLocal = formatDateTimeInTimeZone(reminder.scheduledAt, userTimezone);

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_CREATED',
              actionSummary: `Reminder created: ${title}`,
              actionDetails: {
                reminderId: reminder.id,
                scheduledAt: reminder.scheduledAt.toISOString(),
                scheduledAtLocal,
                recurrence: args.recurrence ?? undefined,
                confidence: parsed.confidence,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: reminder.id,
            scheduledAt: reminder.scheduledAt.toISOString(),
            scheduledAtLocal,
            confidence: parsed.confidence,
            message: `Got it. I'll remind you on ${scheduledAtLocal}.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 12: List Reminders
      // ─────────────────────────────────────────────────────────────────────────
      list_reminders: {
        description: 'List upcoming reminders (pending and snoozed by default).',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(20).optional().describe('Max reminders to return (default: 5)'),
          includeCompleted: z.boolean().optional().describe('Include completed/dismissed/cancelled reminders'),
        }),
        execute: async (args: { limit?: number; includeCompleted?: boolean }) => {
          const limit = Math.min(args.limit ?? 5, 20);
          const includeCompleted = args.includeCompleted ?? false;

          const reminders = await prisma.reminder.findMany({
            where: {
              userId: input.userId,
              ...(includeCompleted ? {} : { status: { in: ['PENDING', 'SNOOZED'] } }),
            },
            orderBy: { scheduledAt: 'asc' },
            take: limit,
          });

          return {
            count: reminders.length,
            reminders: reminders.map((reminder) => {
              const dueAt = reminder.status === 'SNOOZED' && reminder.snoozedUntil
                ? reminder.snoozedUntil
                : reminder.scheduledAt;
              return {
                id: reminder.id,
                title: reminder.title,
                status: reminder.status,
                scheduledAt: dueAt.toISOString(),
                scheduledAtLocal: formatDateTimeInTimeZone(dueAt, userTimezone),
              };
            }),
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 13: Snooze Reminder
      // ─────────────────────────────────────────────────────────────────────────
      snooze_reminder: {
        description: 'Snooze a reminder until a new time.',
        inputSchema: z.object({
          reminderId: z.string().min(1),
          snoozeUntil: z.string().min(1).max(200).describe('Snooze until (ISO UTC or natural language)'),
        }),
        execute: async (args: { reminderId: string; snoozeUntil: string }) => {
          const now = new Date();
          const parsed = parseReminderTime(args.snoozeUntil, { now, timeZone: userTimezone });
          if (!parsed || Number.isNaN(parsed.date.getTime())) {
            return { success: false, message: 'Could not parse the snooze time. Try a specific time.' };
          }
          if (parsed.date.getTime() <= now.getTime()) {
            return { success: false, message: 'Snooze time must be in the future.' };
          }

          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminderClosedStatuses.has(reminder.status)) {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: 'SNOOZED',
              snoozedUntil: parsed.date,
              snoozeCount: { increment: 1 },
            },
          });

          const snoozedLocal = formatDateTimeInTimeZone(parsed.date, userTimezone);

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_SNOOZED',
              actionSummary: `Reminder snoozed: ${reminder.title}`,
              actionDetails: {
                reminderId: reminder.id,
                snoozedUntil: parsed.date.toISOString(),
                snoozedUntilLocal: snoozedLocal,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            snoozedUntil: parsed.date.toISOString(),
            snoozedUntilLocal: snoozedLocal,
            message: `Snoozed until ${snoozedLocal}.`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 14: Dismiss Reminder
      // ─────────────────────────────────────────────────────────────────────────
      dismiss_reminder: {
        description: 'Dismiss a reminder (optionally mark as completed).',
        inputSchema: z.object({
          reminderId: z.string().min(1),
          markCompleted: z.boolean().optional(),
        }),
        execute: async (args: { reminderId: string; markCompleted?: boolean }) => {
          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminder.status === 'CANCELLED' || reminder.status === 'MISSED') {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const markCompleted = args.markCompleted ?? false;
          const status = markCompleted ? 'COMPLETED' : 'DISMISSED';

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status,
              dismissedAt: new Date(),
              snoozedUntil: null,
            },
          });

          await prisma.actionHistory.create({
            data: {
              userId: input.userId,
              actionType: 'REMINDER_DISMISSED',
              actionSummary: `${markCompleted ? 'Reminder completed' : 'Reminder dismissed'}: ${reminder.title}`,
              actionDetails: {
                reminderId: reminder.id,
                status,
              },
              undoable: false,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            status: updated.status,
            message: markCompleted ? 'Marked complete.' : 'Dismissed.',
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 15: Cancel Reminder
      // ─────────────────────────────────────────────────────────────────────────
      cancel_reminder: {
        description: 'Cancel a pending reminder the user no longer wants.',
        inputSchema: z.object({
          reminderId: z.string().min(1),
        }),
        execute: async (args: { reminderId: string }) => {
          const reminder = await prisma.reminder.findFirst({
            where: { id: args.reminderId, userId: input.userId },
            select: { id: true, title: true, status: true },
          });

          if (!reminder) {
            return { success: false, message: 'Reminder not found.' };
          }
          if (reminderNonCancelableStatuses.has(reminder.status)) {
            return { success: false, message: 'That reminder is already closed.' };
          }

          const updated = await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: 'CANCELLED',
              dismissedAt: new Date(),
              snoozedUntil: null,
            },
          });

          return {
            success: true,
            reminderId: updated.id,
            status: updated.status,
            message: `Cancelled reminder: ${reminder.title}`,
          };
        },
      },

      // ─────────────────────────────────────────────────────────────────────────
      // Tool 16: Send Email (TERMINAL - Requires Explicit Permission)
      // ─────────────────────────────────────────────────────────────────────────
      send_email: {
        description:
          'Send an email immediately via Gmail. TERMINAL action - ONLY call after user explicitly says "yes", "send it", "go ahead", or similar clear permission. ' +
          'This IMMEDIATELY SENDS the email - it is NOT a draft or preview. The email will be sent from the user\'s Gmail account. ' +
          'Always show the email details to the user first, wait for their explicit "send" approval, then call this tool. ' +
          'After calling this, provide a brief channel-appropriate confirmation message.',
        inputSchema: z.object({
          to: z.string().email().describe('Email recipient (primary)'),
          cc: z.array(z.string().email()).optional().describe('CC recipient(s)'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body'),
          inReplyTo: z.string().optional().describe('RFC 2822 In-Reply-To header for threading'),
          references: z.string().optional().describe('RFC 2822 References header for threading'),
          threadId: z.string().optional().describe('Gmail thread ID to attach email to'),
        }),
        execute: async (args: {
          to: string;
          cc?: string[];
          subject: string;
          body: string;
          inReplyTo?: string;
          references?: string;
          threadId?: string;
        }) => {
          logger.info(`[executiveAgent] send_email: to=${args.to} subject="${truncate(args.subject, 30)}"`);

          try {
            const gmailContext = await createGmailServiceForUser({
              userId: input.userId,
              purpose: `${resolvedChannel}:send-email`,
              requester: 'executiveAgent.send_email',
            });

            if (!gmailContext) {
              return {
                success: false,
                message: 'Gmail credentials not available. Please reconnect your Gmail account.',
              };
            }

            const result = await gmailContext.gmail.sendEmail({
              to: args.to,
              cc: args.cc,
              subject: args.subject,
              body: args.body,
              inReplyTo: args.inReplyTo,
              references: args.references,
              threadId: args.threadId,
            });

            logger.info(`[executiveAgent] Email sent: messageId=${result.id}`);

            return {
              success: true,
              messageId: result.id,
              threadId: result.threadId,
              message: `Email sent successfully to ${args.to}${args.cc && args.cc.length > 0 ? ` (CC: ${args.cc.join(', ')})` : ''}!`,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`[executiveAgent] Failed to send email: ${message}`);
            return {
              success: false,
              message: `Failed to send email: ${message}`,
            };
          }
        },
      },
  };
}
