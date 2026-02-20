import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { replyGenerationQueue } from '@/lib/services/utils/queues';
import { decryptEmailContent } from '@/lib/security/emailCrypto';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { emailId } = await request.json();

    if (!emailId) {
      return NextResponse.json({ error: 'Email ID is required' }, { status: 400 });
    }

    console.log(`📧 Queuing draft reply generation for email: ${emailId}`);

    // Get the email
    const emailRecord = await prisma.email.findUnique({
      where: { id: emailId },
      include: { thread: true, generatedDraft: true }
    });

    if (!emailRecord) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    const email = await decryptEmailContent({ email: emailRecord, userId: session.userId });

    // Verify the email belongs to the current user
    if (email.thread.userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized access to email' }, { status: 403 });
    }

    // Check if reply already exists
    if (email.generatedDraft?.gmailDraftId) {
      console.log(`✅ Draft metadata already exists for email: ${emailId}`);

      const gmailResult = await createGmailServiceForUser({
        userId: session.userId,
        mailboxId: emailRecord.mailboxId ?? undefined, // Multi-inbox: use email's mailbox
        purpose: 'queue:generate-draft-hydrate',
        requester: 'api.queue.generate-draft.POST',
      });

      if (!gmailResult) {
        return NextResponse.json({
          success: true,
          draft: {
            gmailDraftId: email.generatedDraft.gmailDraftId,
            confidence: email.generatedDraft.confidenceScore,
            reasoning: 'Draft pointer available but Gmail access missing',
          },
        });
      }

      const hydrated = await gmailResult.gmail.getDraft(email.generatedDraft.gmailDraftId);

      if (!hydrated || !hydrated.body.trim()) {
        return NextResponse.json({
          success: true,
          draft: {
            gmailDraftId: email.generatedDraft.gmailDraftId,
            confidence: email.generatedDraft.confidenceScore,
            reasoning: 'Draft pointer available but hydration failed',
          },
        });
      }

      const trimmed = hydrated.body.trim();
      return NextResponse.json({
        success: true,
        draft: {
          fullDraft: trimmed,
          draftPreview: trimmed.substring(0, 150) + (trimmed.length > 150 ? '...' : ''),
          confidence: email.generatedDraft.confidenceScore,
          gmailDraftId: hydrated.draftId,
          reasoning: 'Hydrated from Gmail',
        },
      });
    }

    // Queue the reply generation job
    const job = await replyGenerationQueue.add('generate-reply', {
      emailId,
      userId: session.userId
    }, {
      delay: 0,
      removeOnComplete: 10,
      removeOnFail: 5,
    });

    console.log(`✅ Queued reply generation job ${job.id} for email: ${emailId}`);

    return NextResponse.json({
      success: true,
      message: 'Reply generation started in background',
      jobId: job.id
    }, { status: 202 });

  } catch (error) {
    console.error('❌ Error generating draft reply:', error);
    return NextResponse.json({ 
      error: 'Failed to generate draft reply',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
