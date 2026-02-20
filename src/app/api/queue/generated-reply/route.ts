import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { decryptEmailContent } from '@/lib/security/emailCrypto';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const emailId = searchParams.get('emailId');

    if (!emailId) {
      return NextResponse.json({ error: 'emailId parameter is required' }, { status: 400 });
    }

    // Get the email with generated reply
    const emailRecord = await prisma.email.findUnique({
      where: { id: emailId },
      include: { 
        thread: true, 
        generatedDraft: true 
      }
    });

    if (!emailRecord) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    // Verify the email belongs to the current user
    if (emailRecord.thread.userId !== session.userId) {
      return NextResponse.json({ error: 'Unauthorized access to email' }, { status: 403 });
    }

    const email = await decryptEmailContent({ email: emailRecord, userId: session.userId });

    if (!email.generatedDraft?.gmailDraftId) {
      return NextResponse.json({ 
        success: false,
        message: 'No generated draft found for this email' 
      }, { status: 404 });
    }

    const gmailResult = await createGmailServiceForUser({
      userId: session.userId,
      mailboxId: emailRecord.mailboxId ?? undefined, // Multi-inbox: use email's mailbox
      purpose: 'queue:generated-reply',
      requester: 'api.queue.generated-reply.GET',
    });

    if (!gmailResult) {
      return NextResponse.json({
        success: true,
        draft: {
          gmailDraftId: email.generatedDraft.gmailDraftId,
          confidence: email.generatedDraft.confidenceScore,
          createdAt: email.generatedDraft.createdAt,
        },
        message: 'Gmail access unavailable; returning draft metadata only.',
      });
    }

    const hydrated = await gmailResult.gmail.getDraft(email.generatedDraft.gmailDraftId);

    if (!hydrated || !hydrated.body.trim()) {
      return NextResponse.json({
        success: true,
        draft: {
          gmailDraftId: email.generatedDraft.gmailDraftId,
          confidence: email.generatedDraft.confidenceScore,
          createdAt: email.generatedDraft.createdAt,
        },
        message: 'Draft pointer found but Gmail hydration failed.',
      });
    }

    const trimmed = hydrated.body.trim();
    return NextResponse.json({
      success: true,
      draft: {
        fullDraft: trimmed,
        draftPreview: trimmed.substring(0, 150) + (trimmed.length > 150 ? '...' : ''),
        confidence: email.generatedDraft.confidenceScore,
        createdAt: email.generatedDraft.createdAt,
        gmailDraftId: hydrated.draftId,
      }
    });

  } catch (error) {
    console.error('Error getting generated reply:', error);
    return NextResponse.json({ 
      error: 'Failed to get generated reply',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
