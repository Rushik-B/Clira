import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailCategorizationService } from '@/lib/services/onboarding-services/emailCategorizationService';

/**
 * POST /api/onboarding/email-categorization/update
 * Saves quick edits from the onboarding UI into the cached categorization result
 * so the worker output stays aligned with what the user accepted.
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
    const { updates } = body;

    if (!updates) {
      return NextResponse.json({ 
        error: 'Missing updates in request body' 
      }, { status: 400 });
    }

    console.log(`[EMAIL CATEGORIZATION UPDATE] Updating cached result for user ${user.id}`);

    // Update the cached categorization result
    const categorizationService = new EmailCategorizationService();
    await categorizationService.updateCachedResult(user.id, updates);

    return NextResponse.json({
      success: true,
      message: 'Categorization result updated successfully'
    });

  } catch (error) {
    console.error('[EMAIL CATEGORIZATION UPDATE] Error updating cached result:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update categorization result',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * DELETE /api/onboarding/email-categorization/update
 * Clears the cached categorization output and forces the next request to rebuild
 * from scratch—used when the user wants a fresh analysis.
 */
export async function DELETE(request: NextRequest) {
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

    console.log(`[EMAIL CATEGORIZATION UPDATE] Clearing cached result for user ${user.id}`);

    // Clear the cached categorization result (force fresh analysis)
    const categorizationService = new EmailCategorizationService();
    await categorizationService.clearCachedResult(user.id);

    return NextResponse.json({
      success: true,
      message: 'Categorization cache cleared - next request will regenerate'
    });

  } catch (error) {
    console.error('[EMAIL CATEGORIZATION UPDATE] Error clearing cache:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to clear categorization cache',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
