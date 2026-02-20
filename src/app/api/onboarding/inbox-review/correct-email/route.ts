import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { InboxReviewService } from '@/lib/services/onboarding-services/inboxReviewService';

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { corrections } = body;

    if (!Array.isArray(corrections)) {
      return NextResponse.json({ 
        error: 'Invalid request body - corrections must be an array' 
      }, { status: 400 });
    }

    console.log(`[INBOX REVIEW API] Processing ${corrections.length} email corrections for user ${user.id}`);
    
    // Check if corrections have reasoning (indicating learning was processed)
    const correctionsWithReasoning = corrections.filter(c => c.reason);
    if (correctionsWithReasoning.length > 0) {
      console.log(`[INBOX REVIEW API] ${correctionsWithReasoning.length} corrections have user reasoning - learning should have been processed separately`);
    }

    // Initialize inbox review service
    const inboxReviewService = new InboxReviewService();

    // Apply corrections batch
    const result = await inboxReviewService.applyCorrectionsBatch(user.id, corrections);

    // Optionally refine folder prompts based on corrections
    if (corrections.some(c => c.shouldLearn)) {
      try {
        const refinedPrompts = await inboxReviewService.refineFolderPrompts(user.id, corrections.filter(c => c.shouldLearn));
        result.promptsRefined = refinedPrompts;
      } catch (error) {
        console.error('[INBOX REVIEW API] Error refining prompts:', error);
        // Continue even if prompt refinement fails
      }
    }

    console.log(`[INBOX REVIEW API] Applied corrections: ${result.appliedCorrections} corrections, ${result.rulesCreated} rules, ${result.promptsRefined} prompts refined`);

    return NextResponse.json({
      success: true,
      result: {
        appliedCorrections: result.appliedCorrections,
        rulesCreated: result.rulesCreated,
        promptsRefined: result.promptsRefined,
        errors: result.errors
      },
      message: `Successfully applied ${result.appliedCorrections} corrections`
    });

  } catch (error) {
    console.error('[INBOX REVIEW API] Error processing email corrections:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to process email corrections',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}