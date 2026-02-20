import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { LLMService } from '@/lib/ml/llm';
import { prisma } from '@/lib/prisma';

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
    const { emailAddresses, folders, emailPatternContext } = body;

    // Validate input
    if (!Array.isArray(emailAddresses)) {
      return NextResponse.json({ 
        error: 'Invalid request body - emailAddresses must be an array' 
      }, { status: 400 });
    }

    if (!Array.isArray(folders)) {
      return NextResponse.json({ 
        error: 'Invalid request body - folders must be an array' 
      }, { status: 400 });
    }

    if (emailAddresses.length === 0) {
      return NextResponse.json({ 
        error: 'No email addresses provided for mapping' 
      }, { status: 400 });
    }

    if (folders.length === 0) {
      return NextResponse.json({ 
        error: 'No folders provided for mapping' 
      }, { status: 400 });
    }

    console.log(`📧 Generating mapping suggestions for ${emailAddresses.length} email addresses`);

    // Initialize LLM service and generate mappings
    const llmService = new LLMService();
    
    const mappingResult = await llmService.suggestEmailMappings(
      emailAddresses,
      folders,
      emailPatternContext
    );

    console.log(`✅ Generated mappings for ${mappingResult.mappingSuggestions.length} emails`);

    return NextResponse.json({
      success: true,
      mappingResult
    });

  } catch (error) {
    console.error('Error generating email mapping suggestions:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to generate mapping suggestions'
    }, { status: 500 });
  }
}