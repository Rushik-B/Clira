import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { MasterPromptGeneratorService } from '@/lib/ml/masterPromptGenerator';

export async function POST() {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`Master Prompt generation request from user: ${session.userId}`);

    // Initialize the generator service
    const generator = new MasterPromptGeneratorService();

    // Check if user has enough emails
    const eligibility = await generator.canGenerateMasterPrompt(session.userId);
    
    if (!eligibility.canGenerate) {
      return NextResponse.json({
        error: 'Insufficient email data',
        message: `You need at least ${eligibility.minimumRequired} sent emails to generate a Master Prompt. You currently have ${eligibility.emailCount}.`,
        emailCount: eligibility.emailCount,
        minimumRequired: eligibility.minimumRequired
      }, { status: 400 });
    }

    // Generate and save the Master Prompt
    const result = await generator.generateAndSaveMasterPrompt(session.userId);

    console.log(`Master Prompt generated successfully for user ${session.userId}`);

    return NextResponse.json({
      success: true,
      id: result.id,
      version: result.version,
      confidence: result.confidence,
      message: `Master Prompt v${result.version} generated successfully with ${result.confidence}% confidence`
    });

  } catch (error) {
    console.error('Error in master-prompt/generate API:', error);
    return NextResponse.json({ 
      error: 'Failed to generate Master Prompt',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// GET endpoint to check generation eligibility
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const generator = new MasterPromptGeneratorService();
    const eligibility = await generator.canGenerateMasterPrompt(session.userId);

    return NextResponse.json({
      ...eligibility,
      message: eligibility.canGenerate 
        ? 'Ready to generate Master Prompt'
        : `Need ${eligibility.minimumRequired - eligibility.emailCount} more sent emails`
    });

  } catch (error) {
    console.error('Error checking Master Prompt generation eligibility:', error);
    return NextResponse.json({ 
      error: 'Failed to check eligibility',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 