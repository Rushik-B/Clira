import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailCategorizationService } from '@/lib/services/onboarding-services/emailCategorizationService';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { maxEmails, minFrequency, daysBack } = body;

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Queue email categorization job for folder generation
    const categorizationService = new EmailCategorizationService();
    const result = await categorizationService.queueCategorizationJob(user.id, {
      maxEmails: maxEmails || 500,
      minFrequency: minFrequency || 1,
      daysBack: daysBack
    });

    console.log(`[FOLDER GENERATION] Queued categorization job for user ${user.email}`);

    if (result.cached) {
      // Return cached result immediately
      const cachedResult = await categorizationService.getCategorizationResult(user.id, {
        maxEmails: maxEmails || 500,
        minFrequency: minFrequency || 1,
        daysBack: daysBack
      });

      return NextResponse.json({
        success: true,
        cached: true,
        result: cachedResult
      });
    }

    return NextResponse.json({
      success: true,
      jobId: result.jobId,
      cached: false,
      message: 'Folder generation queued, check status for progress'
    });

  } catch (error) {
    console.error('[FOLDER GENERATION] Error queuing generation job:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to queue folder generation',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get cached categorization result
    const categorizationService = new EmailCategorizationService();
    const result = await categorizationService.getCategorizationResult(user.id);

    if (!result) {
      return NextResponse.json({
        success: true,
        hasResult: false,
        message: 'No folder categorization result available'
      });
    }

    return NextResponse.json({
      success: true,
      hasResult: true,
      result
    });

  } catch (error) {
    console.error('[FOLDER GENERATION] Error getting generation result:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get folder generation result',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}