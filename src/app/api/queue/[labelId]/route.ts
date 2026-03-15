import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { QueueItem } from '@/types';
import { getBaseQueueEmails, mapEmailsToQueueItems, getProcessingEmails, mapEmailsToProcessingPlaceholders } from '@/lib/services/queue/queueHelpers';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { getPrimaryMailboxId } from '@/lib/services/mailbox';
import { getEmailMappingRuleValue } from '@/lib/services/utils/emailMappingRuleValue';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ labelId: string }> }
) {
  try {
    const startedAt = Date.now();
    const API_BUDGET_MS = Number.parseInt(process.env.QUEUE_API_BUDGET_MS || '25000', 10);
    const HYDRATION_LIMIT = Number.parseInt(process.env.QUEUE_HYDRATION_LIMIT || '12', 10);
    const withinBudget = () => Date.now() - startedAt < API_BUDGET_MS;
    
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse pagination params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '10', 10), 1), 50);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10), 0);

    const { labelId } = await params;

    // First, validate that the label exists and belongs to the user
    const label = await prisma.label.findFirst({
      where: {
        id: labelId,
        userId: session.userId
      },
      select: {
        id: true,
        name: true,
        color: true,
        metaPrompt: true,
        gmailLabelId: true,
        mailboxId: true,
        mailbox: {
          select: {
            emailAddress: true,
            provider: true,
            displayName: true,
          },
        },
        isSystemDefault: true,
        emailCount: true
      }
    });

    if (!label) {
      return NextResponse.json({ error: 'Label not found or access denied' }, { status: 404 });
    }

    // Ensure we have a Gmail label ID to query Gmail directly
    if (!label.gmailLabelId) {
      return NextResponse.json({ error: 'Label is missing gmailLabelId' }, { status: 400 });
    }

    // Fetch current Gmail messages that carry this Gmail label (do not rely on EmailSort)
    const resolvedMailboxId = label.mailboxId ?? await getPrimaryMailboxId(session.userId);
    if (!resolvedMailboxId) {
      return NextResponse.json({ error: 'Mailbox context missing for this label' }, { status: 400 });
    }
    if (!label.mailboxId && resolvedMailboxId) {
      console.warn(`⚠️ Label ${labelId} missing mailboxId; falling back to primary mailbox ${resolvedMailboxId}`);
    }

    const gmailResult = await createGmailServiceForUser({
      userId: session.userId,
      mailboxId: resolvedMailboxId,
      purpose: 'queue:label-fetch',
      requester: 'api.queue.labelId.GET',
    });

    if (!gmailResult) {
      return NextResponse.json({ error: 'User Google account not found' }, { status: 404 });
    }

    const gmailService = gmailResult.gmail;

    // List message IDs that currently have this Gmail label
    const gmailMessageIds: string[] = await gmailService.listMessageIdsByLabel(label.gmailLabelId, {
      maxResults: 500,
      excludeSpamTrash: true
    });

    if (gmailMessageIds.length === 0) {
      // No emails have been sorted to this label yet - still fetch rules for consistency
      const rules = await prisma.emailMapping.findMany({
        where: {
          labelId: labelId,
          userId: session.userId,
          isActive: true
        },
        select: {
          id: true,
          mappingType: true,
          emailAddress: true,
          domain: true,
          subjectPattern: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [
          { createdAt: 'asc' }
        ]
      });

      return NextResponse.json({ 
        success: true, 
        queueItems: [],
        labelInfo: {
          id: label.id,
          name: label.name,
          color: label.color || '#6B7280',
          metaPrompt: label.metaPrompt,
          gmailLabelId: label.gmailLabelId,
          mailboxId: resolvedMailboxId,
          mailboxEmail: label.mailbox?.emailAddress ?? null,
          mailboxProvider: label.mailbox?.provider ?? null,
          mailboxDisplayName: label.mailbox?.displayName ?? null,
          isSystemDefault: label.isSystemDefault,
          emailCount: label.emailCount,
          icon: '📁',
          queueCount: 0
        },
        rules: rules.map(rule => ({
          id: rule.id,
          type: rule.mappingType,
          value: getEmailMappingRuleValue(rule),
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt
        })),
        statistics: {
          totalEmailsSorted: 0,
          avgConfidenceScore: 0,
          queueDistribution: {
            high: 0,
            medium: 0,
            low: 0
          },
          lastSortedAt: null,
          rulesCount: rules.length
        }
      });
    }

    // Fetch base queue emails with DB-level pagination, scoped to this label's Gmail message IDs
    const unprocessedEmails = await getBaseQueueEmails(session.userId, {
      extraWhere: {
        messageId: { in: gmailMessageIds },
        ...(label.mailboxId ? { mailboxId: label.mailboxId } : {}),
      },
      limit,
      offset,
    });

    // We operate only on the paginated set returned from DB
    const paginatedEmails = unprocessedEmails;
    const hasMore = paginatedEmails.length === limit; // best-effort without full count

    const draftsByEmail = new Map<string, { body: string; cc: string[]; subject: string; draftId: string }>();
    const typedUnprocessed = paginatedEmails as Array<any>;

    const emailsWithDraftPointers = typedUnprocessed.filter(email => email.generatedDraft?.gmailDraftId);
    if (emailsWithDraftPointers.length > 0 && withinBudget()) {
      // Hydrate only this page's items (already limited by pagination)
      const toHydrate = emailsWithDraftPointers;
      const concurrency = 4;
      for (let i = 0; i < toHydrate.length; i += concurrency) {
        if (!withinBudget()) {
          console.warn(`⏱️ Label queue GET budget nearing limit — returning partial hydration (${draftsByEmail.size}/${toHydrate.length})`);
          break;
        }
        const batch = toHydrate.slice(i, i + concurrency);
        const results = await Promise.all(
          batch.map(async (email: any) => {
            const gmailDraftId = email.generatedDraft?.gmailDraftId;
            if (!gmailDraftId) {
              return null;
            }
            const draft = await gmailService.getDraft(gmailDraftId);
            if (!draft || !draft.body.trim()) {
              console.warn(`⚠️ Unable to hydrate Gmail draft ${gmailDraftId} for label queue email ${email.id}`);
              return null;
            }
            return {
              emailId: email.id,
              body: draft.body,
              cc: draft.cc,
              subject: draft.subject,
              draftId: draft.draftId,
            };
          })
        );

        for (const result of results) {
          if (result) {
            draftsByEmail.set(result.emailId, {
              body: result.body,
              cc: result.cc,
              subject: result.subject,
              draftId: result.draftId,
            });
          }
        }
      }
    }

    // Map with the same logic as general queue
    const readyItems: QueueItem[] = mapEmailsToQueueItems(typedUnprocessed, draftsByEmail).map(item => ({
      ...item,
      metadata: {
        ...(item.metadata || {}),
        labels: [{
          id: label.id,
          name: label.name,
          color: label.color || '#6B7280',
          gmailLabelId: label.gmailLabelId || undefined,
        }],
        labelId: labelId,
      }
    }));

    // Include processing placeholders scoped to this label
    // Only for first page (offset === 0) to avoid duplicates
    const processingPlaceholders: QueueItem[] = offset === 0
      ? await getProcessingEmails(session.userId, {
          messageId: { in: gmailMessageIds },
          ...(label.mailboxId ? { mailboxId: label.mailboxId } : {}),
        }).then(emails => 
          mapEmailsToProcessingPlaceholders(emails).map(item => ({
            ...item,
            metadata: {
              ...(item.metadata || {}),
              labels: [{
                id: label.id,
                name: label.name,
                color: label.color || '#6B7280',
                gmailLabelId: label.gmailLabelId || undefined,
              }],
              labelId: labelId,
            }
          }))
          .filter(ph => !readyItems.some(r => r.id === ph.id))
        )
      : [];

    // Fetch rules for this label in the same request (performance optimization)
    const rules = await prisma.emailMapping.findMany({
      where: {
        labelId: labelId,
        userId: session.userId,
        isActive: true
      },
      select: {
        id: true,
        mappingType: true,
        emailAddress: true,
        domain: true,
        subjectPattern: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [
        { createdAt: 'asc' }
      ]
    });

    // Combine placeholders and ready items for reporting counts
    const combinedItems: QueueItem[] = [...processingPlaceholders, ...readyItems];

    // Calculate basic statistics from current queue items (use only ready items for confidence stats)
    const avgConfidence = readyItems.length > 0
      ? readyItems.reduce((sum: number, item: QueueItem) => sum + (item.confidence || 0), 0) / readyItems.length
      : 0;

    const highConfidenceItems = readyItems.filter((item: QueueItem) => (item.confidence || 0) >= 90).length;
    const mediumConfidenceItems = readyItems.filter((item: QueueItem) => {
      const conf = item.confidence || 0;
      return conf >= 70 && conf < 90;
    }).length;
    const lowConfidenceItems = readyItems.filter((item: QueueItem) => (item.confidence || 0) < 70).length;

    return NextResponse.json({ 
      success: true, 
      queueItems: combinedItems,
      pagination: {
        limit,
        offset,
        total: null,
        hasMore,
        nextOffset: hasMore ? offset + limit : null
      },
      labelInfo: {
        id: label.id,
        name: label.name,
        color: label.color || '#6B7280', // Default gray color if null
        metaPrompt: label.metaPrompt,
        gmailLabelId: label.gmailLabelId,
        mailboxId: resolvedMailboxId,
        mailboxEmail: label.mailbox?.emailAddress ?? null,
        mailboxProvider: label.mailbox?.provider ?? null,
        mailboxDisplayName: label.mailbox?.displayName ?? null,
        isSystemDefault: label.isSystemDefault,
        emailCount: label.emailCount,
        icon: '📁', // Default icon since icon field doesn't exist in schema
        queueCount: null // unknown without full count
      },
      // Include rules in the same response (eliminates separate API call)
      rules: rules.map(rule => ({
        id: rule.id,
        type: rule.mappingType,
        value: getEmailMappingRuleValue(rule),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt
      })),
      // Enhanced statistics for better insights
      statistics: {
        totalEmailsSorted: null, // unknown without full count
        avgConfidenceScore: Math.round(avgConfidence * 100) / 100,
        queueDistribution: {
          high: highConfidenceItems, // >= 90%
          medium: mediumConfidenceItems, // 70-89%
          low: lowConfidenceItems // < 70%
        },
        lastSortedAt: paginatedEmails[0]?.createdAt || null,
        rulesCount: rules.length
      }
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error fetching label-specific queue:', err.message, err.stack);
    return NextResponse.json({ error: 'Failed to fetch label queue' }, { status: 500 });
  }
}
