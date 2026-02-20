import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { QueueItem } from '@/types';
import { GmailDraftData } from '@/lib/email/gmail';
import { getBaseQueueEmails, mapEmailsToQueueItems, getProcessingEmails, mapEmailsToProcessingPlaceholders } from '@/lib/services/queue/queueHelpers';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { encryptEmailContent, decryptEmailContent } from '@/lib/security/emailCrypto';
import { getPrimaryMailboxId } from '@/lib/services/mailbox';

// Heuristic to detect generic error-style drafts that should never be shown or sent
const ERROR_DRAFT_PATTERN = /unable to generate a reply|please try again later|system is still setting up/i;

// Performance safeguards: keep /api/queue under Heroku 30s router timeout
const HYDRATION_LIMIT = Number.parseInt(process.env.QUEUE_HYDRATION_LIMIT || '12', 10);
const API_BUDGET_MS = Number.parseInt(process.env.QUEUE_API_BUDGET_MS || '25000', 10);

// Helper function to extract keywords from feedback for analysis
function extractFeedbackKeywords(feedback: string): string[] {
  const commonWords = ['the', 'and', 'is', 'it', 'to', 'a', 'an', 'was', 'were', 'for', 'in', 'on', 'at', 'by', 'with'];
  const words = feedback
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.includes(word))
    .slice(0, 10); // Top 10 keywords
  
  return [...new Set(words)]; // Remove duplicates
}

// Helper function to categorize feedback type
function categorizeFeedback(feedback: string): string {
  const lowerFeedback = feedback.toLowerCase();
  
  if (lowerFeedback.includes('formal') || lowerFeedback.includes('tone')) return 'tone';
  if (lowerFeedback.includes('context') || lowerFeedback.includes('missing')) return 'context';
  if (lowerFeedback.includes('style') || lowerFeedback.includes('voice')) return 'style';
  if (lowerFeedback.includes('length') || lowerFeedback.includes('short') || lowerFeedback.includes('long')) return 'length';
  if (lowerFeedback.includes('accurate') || lowerFeedback.includes('wrong') || lowerFeedback.includes('incorrect')) return 'accuracy';
  if (lowerFeedback.includes('professional') || lowerFeedback.includes('casual')) return 'professionalism';
  
  return 'general';
}

export async function GET(request: NextRequest) {
  try {
    const startedAt = Date.now();
    const withinBudget = () => Date.now() - startedAt < API_BUDGET_MS;

    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse pagination params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '10', 10), 1), 50);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10), 0);
    const hydrateParam = searchParams.get('hydrate');
    const hydrate = !(hydrateParam === '0' || hydrateParam === 'false');

    let unprocessedEmails = await getBaseQueueEmails(session.userId, { limit, offset });

    const primaryMailboxId = await getPrimaryMailboxId(session.userId);
    const resolvedMailboxIdByEmail = new Map<string, string>();
    const mailboxIds = new Set<string>();

    for (const email of unprocessedEmails) {
      const resolvedMailboxId = email.mailboxId || primaryMailboxId || null;
      if (!resolvedMailboxId) {
        console.warn(`⚠️ Queue email ${email.id} missing mailboxId and no primary mailbox found`);
        continue;
      }
      if (!email.mailboxId && primaryMailboxId) {
        console.warn(`⚠️ Queue email ${email.id} missing mailboxId; falling back to primary mailbox ${primaryMailboxId}`);
      }
      resolvedMailboxIdByEmail.set(email.id, resolvedMailboxId);
      mailboxIds.add(resolvedMailboxId);
    }

    const gmailByMailboxId = new Map<string, { getDraft: any; getLatestSentInThread: any; getThreadIdByRfc822MessageId: any }>();
    if (hydrate && unprocessedEmails.length > 0) {
      for (const mailboxId of mailboxIds) {
        const gmailResult = await createGmailServiceForUser({
          userId: session.userId,
          mailboxId,
          purpose: 'queue:get-hydrate',
          requester: 'api.queue.GET',
          includeRefreshToken: true,
        });
        if (gmailResult?.gmail) {
          gmailByMailboxId.set(mailboxId, gmailResult.gmail);
        } else {
          console.warn(`⚠️ Gmail client unavailable for mailbox ${mailboxId}`);
        }
      }
    }

    // Fallback reconciliation: only do this on the first page to avoid delaying paginated requests.
    // This covers cases where push notifications lag or were missed.
    if (hydrate && offset === 0 && unprocessedEmails.length > 0 && withinBudget()) {
      try {
        const emailsByMailbox = new Map<string, typeof unprocessedEmails>();
        for (const email of unprocessedEmails) {
          const mailboxId = resolvedMailboxIdByEmail.get(email.id);
          if (!mailboxId) continue;
          const bucket = emailsByMailbox.get(mailboxId) ?? [];
          bucket.push(email);
          emailsByMailbox.set(mailboxId, bucket);
        }

        const removed: typeof unprocessedEmails = [];

        for (const [mailboxId, mailboxEmails] of emailsByMailbox) {
          if (!withinBudget()) break;
          const gmail = gmailByMailboxId.get(mailboxId);
          if (!gmail) {
            console.warn(`⚠️ Gmail client unavailable for mailbox ${mailboxId}; skipping reconciliation`);
            continue;
          }

          // Ensure we have thread IDs where possible (attempt RFC822 Message-ID resolution for missing ones)
          const itemsNeedingThread = mailboxEmails.filter(e => !e.gmailThreadId && e.rfc2822MessageId);
          for (const e of itemsNeedingThread.slice(0, 5)) { // cap resolutions per request
            if (!withinBudget()) break;
            const tId = await gmail.getThreadIdByRfc822MessageId(e.rfc2822MessageId!);
            if (tId) {
              // Best-effort update to thread/email to persist gmailThreadId
              try {
                await prisma.email.update({ where: { id: e.id }, data: { gmailThreadId: tId } });
              } catch {}
              e.gmailThreadId = tId as any;
            }
          }

          // Collect up to 10 unique gmailThreadIds to check
          const threadIds = Array.from(new Set(
            mailboxEmails
              .map(e => e.gmailThreadId)
              .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
          )).slice(0, 10);

          // Fetch latest SENT per thread with small concurrency (to reduce latency)
          const latestSentByThread = new Map<string, number>();
          const concurrency = 4;
          for (let i = 0; i < threadIds.length; i += concurrency) {
            if (!withinBudget()) break;
            const batch = threadIds.slice(i, i + concurrency);
            const results = await Promise.all(
              batch.map(async (tId) => ({ tId, latest: await gmail.getLatestSentInThread(tId) }))
            );
            for (const { tId, latest } of results) {
              if (latest) latestSentByThread.set(tId, latest.internalDate);
            }
          }

          if (latestSentByThread.size > 0) {
            const kept: typeof mailboxEmails = [];
            for (const e of mailboxEmails) {
              const sentMs = latestSentByThread.get(e.gmailThreadId || '');
              if (!sentMs) {
                kept.push(e);
                continue;
              }
              const emailMs = e.createdAt instanceof Date ? e.createdAt.getTime() : new Date(e.createdAt).getTime();
              const keep = emailMs >= sentMs; // keep only if received after last SENT
              if (!keep) {
                removed.push(e);
                console.log(`📧 Reconciler filtered via Gmail: ${e.id} (email @ ${new Date(emailMs).toISOString()} < SENT @ ${new Date(sentMs).toISOString()})`);
              } else {
                kept.push(e);
              }
            }
            emailsByMailbox.set(mailboxId, kept);
          }
        }

        if (removed.length > 0) {
          const beforeCount = unprocessedEmails.length;
          const afterCount = beforeCount - removed.length;
          console.log(`📧 Queue reconciler removed ${beforeCount - afterCount} item(s) using live Gmail thread state`);
          // Persist result so subsequent /api/queue calls are fast and DB-only.
          // Create feedback records marking these emails as handled externally.
          const upserts = removed.map((e) =>
            prisma.feedback.upsert({
              where: { emailId: e.id },
              update: {
                action: 'ACCEPTED',
                editDelta: {
                  external: true,
                  sentVia: 'gmail_client',
                  reconciled: true,
                  repliedAt: new Date().toISOString(),
                },
              },
              create: {
                userId: session.userId!,
                emailId: e.id,
                action: 'ACCEPTED',
                editDelta: {
                  external: true,
                  sentVia: 'gmail_client',
                  reconciled: true,
                  repliedAt: new Date().toISOString(),
                },
              },
            })
          );
          // Limit concurrent DB writes to avoid spikes
          const dbConcurrency = 5;
          for (let i = 0; i < upserts.length; i += dbConcurrency) {
            await Promise.all(upserts.slice(i, i + dbConcurrency));
          }
        }

        unprocessedEmails = Array.from(emailsByMailbox.values()).flat();
      } catch (reconErr) {
        console.warn('⚠️ Gmail reconciliation skipped due to error:', reconErr);
      }
    }

    // We no longer fetch all items; approximate pagination metadata
    const paginatedEmails = unprocessedEmails;
    const hasMore = paginatedEmails.length === limit; // best-effort without full count

    const draftsByEmail = new Map<string, { body: string; cc: string[]; subject: string; draftId: string }>();

    const emailsWithDraftPointers = paginatedEmails.filter(email => email.generatedDraft?.gmailDraftId);
    if (hydrate && emailsWithDraftPointers.length > 0 && withinBudget()) {
      const emailsByMailbox = new Map<string, typeof emailsWithDraftPointers>();
      for (const email of emailsWithDraftPointers) {
        const mailboxId = resolvedMailboxIdByEmail.get(email.id);
        if (!mailboxId) {
          console.warn(`⚠️ Skipping draft hydration for email ${email.id} (missing mailboxId)`);
          continue;
        }
        const bucket = emailsByMailbox.get(mailboxId) ?? [];
        bucket.push(email);
        emailsByMailbox.set(mailboxId, bucket);
      }

      for (const [mailboxId, toHydrate] of emailsByMailbox) {
        if (!withinBudget()) break;
        const gmail = gmailByMailboxId.get(mailboxId);
        if (!gmail) {
          console.warn(`⚠️ Unable to hydrate drafts: Gmail client unavailable for mailbox ${mailboxId}`);
          continue;
        }

        const concurrency = 4;
        for (let i = 0; i < toHydrate.length; i += concurrency) {
          if (!withinBudget()) {
            console.warn(`⏱️ Queue GET budget nearing limit — returning partial hydration (${draftsByEmail.size}/${toHydrate.length})`);
            break;
          }
          const batch = toHydrate.slice(i, i + concurrency);
          const results = await Promise.all(
            batch.map(async email => {
              const gmailDraftId = email.generatedDraft?.gmailDraftId;
              if (!gmailDraftId) {
                return null;
              }
              const draft = await gmail.getDraft(gmailDraftId);
              if (!draft || !draft.body.trim()) {
                console.warn(`⚠️ Unable to hydrate Gmail draft ${gmailDraftId} for email ${email.id}`);
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
    } else if (hydrate && emailsWithDraftPointers.length > 0 && gmailByMailboxId.size === 0) {
      console.warn('⚠️ Unable to hydrate queue drafts: Gmail clients unavailable for user', session.userId);
    }

    // Map to QueueItem format using the shared helper with additional safety filtering
    const readyItems: QueueItem[] = hydrate
      ? mapEmailsToQueueItems(paginatedEmails, draftsByEmail)
      .filter(item => {
        // Additional safety checks: positive confidence and no error-style draft
        const draft = (item.fullDraft || item.draftPreview || '').trim();
        const confidence = item.confidence ?? 0;
        const valid = draft.length > 0 && confidence > 0 && !ERROR_DRAFT_PATTERN.test(draft);
        if (!valid) {
          console.warn(
            `⚠️ Filtering out queue item ${item.id} — ` +
            (draft.length === 0
              ? 'empty draft'
              : confidence <= 0
                ? `non-positive confidence (${confidence})`
                : 'error-style draft text')
          );
        }
        return valid;
      })
      : mapEmailsToProcessingPlaceholders(paginatedEmails);

    // Also include currently processing emails as placeholders to persist greyed-out cards across reloads
    // Only for first page (offset === 0) to avoid duplicates
    const processingPlaceholders: QueueItem[] = offset === 0 
      ? await getProcessingEmails(session.userId).then(emails => 
          mapEmailsToProcessingPlaceholders(emails)
            .filter(ph => !readyItems.some(r => r.id === ph.id))
        )
      : [];

    // Placeholders first, then ready items
    const queueItems: QueueItem[] = [...processingPlaceholders, ...readyItems];

    return NextResponse.json({ 
      success: true, 
      queueItems,
      pagination: {
        limit,
        offset,
        total: null,
        hasMore,
        nextOffset: hasMore ? offset + limit : null
      }
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error fetching queue:', err.message, err.stack);
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, emailId, feedback, draftContent, ccRecipients, metadata } = await req.json();

    const emailRecord = await prisma.email.findUnique({
      where: { id: emailId },
      include: { thread: true, generatedDraft: true },
    });

    if (!emailRecord || emailRecord.thread.userId !== session.userId) {
      return NextResponse.json({ error: 'Email not found or not owned by user' }, { status: 404 });
    }

    const email = await decryptEmailContent({ email: emailRecord, userId: session.userId });

    if (!email.thread) {
      return NextResponse.json({ error: 'Thread not found for email' }, { status: 404 });
    }

    switch (action) {
      case 'approve':
      case 'edit': {
        const pointer = email.generatedDraft;
        const isEdit = action === 'edit';
        const requestedCc = typeof ccRecipients === 'string'
          ? ccRecipients.split(',').map((value: string) => value.trim()).filter(Boolean)
          : [];

        const resolvedMailboxId = emailRecord.mailboxId ?? await getPrimaryMailboxId(session.userId);
        if (!resolvedMailboxId) {
          return NextResponse.json({ error: 'Mailbox context missing for this email' }, { status: 400 });
        }
        if (!emailRecord.mailboxId && resolvedMailboxId) {
          console.warn(`⚠️ Queue POST email ${emailId} missing mailboxId; falling back to primary mailbox ${resolvedMailboxId}`);
        }

        const gmailResult = await createGmailServiceForUser({
          userId: session.userId,
          mailboxId: resolvedMailboxId,
          purpose: 'queue:post-send',
          requester: 'api.queue.POST',
        });

        if (!gmailResult) {
          return NextResponse.json({ error: 'User google account not found' }, { status: 404 });
        }

        const gmailService = gmailResult.gmail;

        let hydratedDraft: GmailDraftData | null = null;
        if (pointer?.gmailDraftId) {
          hydratedDraft = await gmailService.getDraft(pointer.gmailDraftId);
        }

        if (!isEdit && !hydratedDraft) {
          console.error(`❌ Unable to hydrate Gmail draft for email ${emailId}.`);
          return NextResponse.json({
            error: 'Draft unavailable. Please regenerate the reply.',
            details: 'The stored draft could not be retrieved from Gmail.',
          }, { status: 409 });
        }

        let replyContent = isEdit ? (typeof draftContent === 'string' ? draftContent : '') : (hydratedDraft?.body ?? '');
        replyContent = typeof replyContent === 'string' ? replyContent : '';

        const trimmed = replyContent.trim();
        if (!trimmed) {
          return NextResponse.json({
            error: 'No draft content to send. The generated reply appears to be empty.',
            details: 'Please try generating a new reply for this email.'
          }, { status: 400 });
        }

        const confidence = pointer?.confidenceScore ?? 0;
        if (confidence <= 0 || ERROR_DRAFT_PATTERN.test(trimmed)) {
          return NextResponse.json({
            error: 'Draft not sendable. Reply generation failed due to provider limits or setup.',
            details: 'Please regenerate the reply and try again.'
          }, { status: 400 });
        }

        const ccDefaults = hydratedDraft?.cc?.length ? hydratedDraft.cc : [];
        const ccList = requestedCc.length > 0 ? requestedCc : ccDefaults;

        console.log(`📧 Sending email to ${email.from}...`);
        console.log(`📧 Threading: Using Message-ID: ${email.rfc2822MessageId} and References: ${email.references}`);
        console.log(`📧 Reply content length: ${trimmed.length} characters`);

        let sentMessage: any;
        try {
          if (!isEdit && pointer?.gmailDraftId) {
            console.log(`📤 Attempting to send existing Gmail draft: ${pointer.gmailDraftId}`);
            try {
              sentMessage = await gmailService.sendDraft(pointer.gmailDraftId);
              console.log(`✅ Gmail draft sent successfully! Message ID: ${sentMessage.id}`);
            } catch (draftError) {
              console.warn(`⚠️ Failed to send Gmail draft ${pointer.gmailDraftId}, falling back to direct send:`, draftError);
              sentMessage = await gmailService.sendEmail({
                to: email.from,
                cc: ccList,
                subject: `Re: ${email.subject}`,
                body: replyContent,
                inReplyTo: email.rfc2822MessageId || undefined,
                references: email.references || undefined,
                threadId: email.gmailThreadId || undefined,
              });
              console.log(`✅ Fallback email sent successfully! Message ID: ${sentMessage.id}`);
            }
          } else {
            if (isEdit) {
              console.log(`✏️ Edited reply - sending directly instead of using draft`);
            } else {
              console.log(`📧 No Gmail draft ID available - sending directly`);
            }

            sentMessage = await gmailService.sendEmail({
              to: email.from,
              cc: ccList,
              subject: `Re: ${email.subject}`,
              body: replyContent,
              inReplyTo: email.rfc2822MessageId || undefined,
              references: email.references || undefined,
              threadId: email.gmailThreadId || undefined,
            });

            console.log(`✅ Email sent successfully! Message ID: ${sentMessage.id}`);
          }

          const sentEmailContent = {
            subject: `Re: ${email.subject}`,
            body: replyContent,
            from: session.user?.email || 'user@example.com',
            to: [email.from],
            cc: ccList,
            snippet: trimmed.substring(0, 150) + (trimmed.length > 150 ? '...' : ''),
          };

          const encryptedSentEmail = await encryptEmailContent({
            userId: session.userId,
            data: sentEmailContent,
          });

          await prisma.email.create({
            data: {
              threadId: email.threadId,
              mailboxId: resolvedMailboxId,
              messageId: sentMessage.id,
              gmailThreadId: email.gmailThreadId,
              isSent: true,
              isDraft: false,
              createdAt: new Date(),
              from: '',
              subject: '',
              body: '',
              snippet: '',
              to: [],
              cc: [],
              ...encryptedSentEmail,
            },
          });
        } catch (sendError) {
          console.error(`❌ Failed to send email:`, sendError);

          if (sendError instanceof Error && sendError.message.includes('auth')) {
            return NextResponse.json({
              error: 'Authentication failed. Please reconnect your Google account.',
              authError: true,
            }, { status: 401 });
          }

          await prisma.feedback.upsert({
            where: { emailId: emailId },
            update: {
              action: 'REJECTED',
              editDelta: {
                error: sendError instanceof Error ? sendError.message : 'Unknown send error',
                attemptedDraftLength: trimmed.length,
              },
            },
            create: {
              userId: session.userId,
              emailId: emailId,
              action: 'REJECTED',
              editDelta: {
                error: sendError instanceof Error ? sendError.message : 'Unknown send error',
                attemptedDraftLength: trimmed.length,
              },
            },
          });

          return NextResponse.json({
            error: 'Failed to send email',
            details: sendError instanceof Error ? sendError.message : 'Unknown error',
          }, { status: 500 });
        }

        const approvalFeedbackData = isEdit
          ? {
              editedAt: new Date().toISOString(),
              finalLength: trimmed.length,
              confidenceScore: pointer?.confidenceScore,
              emailSubject: email.subject,
              emailSender: email.from,
              ccRecipients: ccList,
              ...(metadata || {}),
            }
          : {
              acceptedAt: new Date().toISOString(),
              confidenceScore: pointer?.confidenceScore,
              emailSubject: email.subject,
              emailSender: email.from,
              ccRecipients: ccList,
              ...(metadata || {}),
            };

        await prisma.feedback.upsert({
          where: { emailId: emailId },
          update: {
            action: isEdit ? 'EDITED' : 'ACCEPTED',
            editDelta: approvalFeedbackData,
          },
          create: {
            userId: session.userId,
            emailId: emailId,
            action: isEdit ? 'EDITED' : 'ACCEPTED',
            editDelta: approvalFeedbackData,
          },
        });

        console.log(`✅ ${isEdit ? 'Edit' : 'Approval'} feedback recorded for email ${emailId}:`, {
          action: isEdit ? 'EDITED' : 'ACCEPTED',
          confidenceScore: pointer?.confidenceScore,
          sender: email.from,
          subject: email.subject.substring(0, 50) + '...',
        });

        await prisma.actionHistory.create({
          data: {
            userId: session.userId,
            actionType: isEdit ? 'EMAIL_EDITED' : 'EMAIL_SENT',
            actionSummary: isEdit
              ? `Edited and sent reply to ${email.from.split('@')[0]} - ${email.subject}`
              : `Auto-replied to ${email.from.split('@')[0]} - ${email.subject}`,
            actionDetails: {
              emailFrom: email.from,
              emailSubject: email.subject,
              gmailDraftId: pointer?.gmailDraftId,
              ccRecipients: ccList,
              wasEdited: isEdit,
            },
            emailReference: emailId,
            confidence: pointer?.confidenceScore,
            undoable: true,
            metadata: {
              sender: email.from,
              subject: email.subject,
              action: isEdit ? 'edited' : 'approved',
            },
          },
        });

        break;
      }

      case 'reject':
        console.log(`🗑️ Processing rejection for email ${emailId} with feedback:`, feedback?.substring(0, 100));
        
        // Extract additional metadata from the request
        const rejectionMetadata = metadata || {};
        
        // Enhanced feedback data structure for ML training and analysis
        const pointer = email.generatedDraft;
        const feedbackData = {
          reason: feedback || 'No specific reason provided',
          confidenceScore: pointer?.confidenceScore || rejectionMetadata.confidenceScore,
          emailSubject: email.subject || rejectionMetadata.emailSubject,
          emailSender: email.from || rejectionMetadata.emailSender,
          rejectedAt: new Date().toISOString(),
          feedbackLength: feedback?.length || 0,
          draftLength: rejectionMetadata.draftLength || 0,
          gmailDraftId: pointer?.gmailDraftId,
          ...rejectionMetadata,
        };

        // Use upsert to prevent duplicate feedback errors
        await prisma.feedback.upsert({
          where: { emailId: emailId },
          update: {
            action: 'REJECTED',
            editDelta: feedbackData,
          },
          create: {
            userId: session.userId,
            emailId: emailId,
            action: 'REJECTED',
            editDelta: feedbackData,
          },
        });

        // Create detailed action history record for rejection
        await prisma.actionHistory.create({
          data: {
            userId: session.userId,
            actionType: 'EMAIL_REJECTED',
            actionSummary: `Rejected draft for ${email.from.split('@')[0]} - ${email.subject}`,
            actionDetails: {
              emailFrom: email.from,
              emailSubject: email.subject,
              rejectionReason: feedback,
              feedbackAnalysis: {
                feedbackLength: feedback?.length || 0,
                hasSpecificFeedback: feedback && feedback.length > 10,
                commonKeywords: extractFeedbackKeywords(feedback || ''),
              },
              aiMetrics: {
                originalConfidence: pointer?.confidenceScore,
                generatedAt: pointer?.updatedAt || pointer?.createdAt,
              }
            },
            emailReference: emailId,
            confidence: pointer?.confidenceScore,
            undoable: false, // Rejection cannot be undone
            metadata: {
              sender: email.from,
              subject: email.subject,
              feedback: feedback,
              feedbackCategory: categorizeFeedback(feedback || ''),
              rejectionType: feedback && feedback.length > 50 ? 'detailed' : 'brief'
            }
          }
        });
        
        console.log(`✅ Rejection feedback recorded for email ${emailId}:`, {
          feedbackLength: feedback?.length || 0,
          sender: email.from,
          subject: email.subject.substring(0, 50) + '...'
        });
        
        break;

      case 'dismiss':
        console.log(`🗑️ Processing dismiss for email ${emailId}`);
        
        // Enhanced feedback data for dismiss action
        const dismissMetadata = metadata || {};
        const pointerDismiss = email.generatedDraft;
        const dismissFeedbackData = {
          reason: 'Dismissed from queue',
          dismissed: true,
          source: 'queue-ui',
          confidenceScore: pointerDismiss?.confidenceScore || dismissMetadata.confidenceScore,
          emailSubject: email.subject || dismissMetadata.emailSubject,
          emailSender: email.from || dismissMetadata.emailSender,
          dismissedAt: new Date().toISOString(),
          gmailDraftId: pointerDismiss?.gmailDraftId,
          ...dismissMetadata,
        };

        // Use upsert to prevent duplicate feedback errors
        await prisma.feedback.upsert({
          where: { emailId: emailId },
          update: {
            action: 'REJECTED',
            editDelta: dismissFeedbackData,
          },
          create: {
            userId: session.userId,
            emailId: emailId,
            action: 'REJECTED',
            editDelta: dismissFeedbackData,
          },
        });

        // Create action history for dismiss
        await prisma.actionHistory.create({
          data: {
            userId: session.userId,
            actionType: 'EMAIL_REJECTED',
            actionSummary: `Dismissed queue item for ${email.from.split('@')[0]} - ${email.subject}`,
            actionDetails: {
              emailFrom: email.from,
              emailSubject: email.subject,
              dismissReason: 'User dismissed from queue',
            },
            emailReference: emailId,
            confidence: pointerDismiss?.confidenceScore,
            undoable: false,
            metadata: {
              sender: email.from,
              subject: email.subject,
              action: 'dismissed'
            }
          }
        });
        
        console.log(`✅ Dismissed email ${emailId} from queue`);
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Error processing queue action:`, error);
    return NextResponse.json({ error: 'Failed to process queue action' }, { status: 500 });
  }
} 
