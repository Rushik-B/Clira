import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { InboxReviewService } from '@/lib/services/onboarding-services/inboxReviewService';

/**
 * GET /api/onboarding/inbox-review/preview
 * Builds a folder-by-folder preview used in onboarding so the UI can show what our
 * current sorting rules would do before any emails are moved.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log(`[INBOX REVIEW API] Generating email preview for user ${user.id}`);

    // Initialize inbox review service
    const inboxReviewService = new InboxReviewService();

    // Generate email preview with current sorting decisions
    const previewData = await inboxReviewService.generateEmailPreview(user.id, {
      maxEmails: 50, // Limit to 50 emails for review
      includeConfidence: true,
      groupByFolder: true
    });

    console.log(`[INBOX REVIEW API] Generated preview with ${previewData.folders.length} folders and ${previewData.totalEmails} emails`);

    return NextResponse.json({
      success: true,
      folders: previewData.folders,
      totalEmails: previewData.totalEmails,
      averageConfidence: previewData.averageConfidence,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('[INBOX REVIEW API] Error generating email preview:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to generate email preview',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
