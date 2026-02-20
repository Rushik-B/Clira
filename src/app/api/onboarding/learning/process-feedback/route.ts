import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailLearningService } from '@/lib/services/onboarding-services/emailLearningService';

/**
 * POST /api/onboarding/learning/process-feedback
 * Persists user-authored corrections so the learning worker can fold them into
 * future routing decisions during onboarding.
 */
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

    // Filter corrections that have user feedback/reasoning
    const correctionsWithFeedback = corrections.filter(c => c.reason && c.reason.trim().length > 0);

    if (correctionsWithFeedback.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No corrections with feedback to process',
        processedCount: 0,
        learningsCreated: 0
      });
    }

    console.log(`[LEARNING API] Processing ${correctionsWithFeedback.length} corrections with feedback for user ${user.id}`);

    // Initialize learning service
    const learningService = new EmailLearningService();

    // Process corrections and create learnings
    const result = await learningService.processCorrectionsWithFeedback(user.id, correctionsWithFeedback);

    console.log(`[LEARNING API] Created ${result.processedLearnings} learnings from ${correctionsWithFeedback.length} corrections`);

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${correctionsWithFeedback.length} corrections with feedback`,
      processedCount: correctionsWithFeedback.length,
      learningsCreated: result.processedLearnings,
      errors: result.errors
    });

  } catch (error) {
    console.error('[LEARNING API] Error processing feedback:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to process learning feedback',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
