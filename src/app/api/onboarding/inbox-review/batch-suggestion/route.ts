import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailMappingService } from '@/lib/services/onboarding-services/emailMappingService';

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
    const { emailFrom, targetFolderId, suggestionType = 'domain' } = body;

    // Validate required fields
    if (!emailFrom || !targetFolderId) {
      return NextResponse.json({ 
        error: 'Missing required fields: emailFrom, targetFolderId' 
      }, { status: 400 });
    }

    console.log(`[BATCH SUGGESTION API] Generating suggestion for ${emailFrom} → ${targetFolderId} (${suggestionType})`);

    // Initialize email mapping service
    const emailMappingService = new EmailMappingService();

    // Get batch suggestion
    const suggestion = await emailMappingService.suggestSimilarEmails(
      user.id,
      emailFrom,
      suggestionType as 'domain' | 'sender'
    );

    // Only return suggestion if it affects multiple emails
    if (suggestion.affectedCount <= 1) {
      return NextResponse.json({
        success: true,
        suggestion: null,
        message: 'No batch suggestion needed - affects only one email'
      });
    }

    // Create enhanced batch suggestion
    const batchSuggestion = {
      pattern: suggestionType === 'domain' 
        ? `All emails from @${emailFrom.split('@')[1]}` 
        : `All emails from ${emailFrom}`,
      ...suggestion,
      confidence: 85 // Default confidence for batch suggestions
    };

    console.log(`[BATCH SUGGESTION API] Generated suggestion: ${batchSuggestion.suggestedRule} (${batchSuggestion.affectedCount} emails)`);

    return NextResponse.json({
      success: true,
      suggestion: batchSuggestion,
      message: 'Batch suggestion generated successfully'
    });

  } catch (error) {
    console.error('[BATCH SUGGESTION API] Error generating batch suggestion:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to generate batch suggestion',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}