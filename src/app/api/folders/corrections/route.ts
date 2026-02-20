import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailLearningService } from '@/lib/services/onboarding-services/emailLearningService';

interface CorrectionRequest {
  corrections: Array<{
    emailId: string;
    emailFrom: string;
    fromFolder: string;
    toFolder: string;
    shouldLearn: boolean;
    reason?: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CorrectionRequest = await request.json();
    const { corrections } = body;

    if (!corrections || !Array.isArray(corrections) || corrections.length === 0) {
      return NextResponse.json({ error: 'Corrections array is required' }, { status: 400 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Queue corrections for worker processing
    const learningService = new EmailLearningService();
    const result = await learningService.queueCorrectionsForProcessing(user.id, corrections);

    console.log(`[CORRECTIONS] Queued ${corrections.length} corrections for user ${user.email}`);

    if (result.cached) {
      return NextResponse.json({
        success: true,
        cached: true,
        message: 'No learning corrections to process',
        jobId: result.jobId
      });
    }

    return NextResponse.json({
      success: true,
      cached: false,
      jobId: result.jobId,
      message: 'Corrections queued for processing, check status for progress'
    });

  } catch (error) {
    console.error('[CORRECTIONS] Error processing corrections:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process corrections',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}