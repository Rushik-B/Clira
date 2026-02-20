import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { MasterPromptGeneratorService } from '@/lib/ml/masterPromptGenerator';

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const masterPromptService = new MasterPromptGeneratorService();
    
    console.log(`🔍 Ensuring user ${session.userId} has master prompt...`);
    
    // This will check and auto-generate if needed
    const hasPrompt = await masterPromptService.ensureUserHasMasterPrompt(session.userId);
    
    return NextResponse.json({ 
      hasPrompt,
      message: hasPrompt 
        ? 'User has master prompt or one was generated' 
        : 'User needs more emails for master prompt generation'
    });

  } catch (error) {
    console.error('Error ensuring master prompt:', error);
    return NextResponse.json(
      { error: 'Failed to ensure master prompt' },
      { status: 500 }
    );
  }
} 