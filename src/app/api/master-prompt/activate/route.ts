import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { promptId }: { promptId: string } = body;

    if (!promptId) {
      return NextResponse.json({ 
        error: 'Prompt ID is required' 
      }, { status: 400 });
    }

    // Verify the prompt belongs to the user
    const targetPrompt = await prisma.masterPrompt.findFirst({
      where: {
        id: promptId,
        userId: session.userId
      }
    });

    if (!targetPrompt) {
      return NextResponse.json({ 
        error: 'Master prompt not found' 
      }, { status: 404 });
    }

    // Deactivate all existing prompts for this user
    await prisma.masterPrompt.updateMany({
      where: { 
        userId: session.userId 
      },
      data: { 
        isActive: false 
      }
    });

    // Activate the selected prompt
    await prisma.masterPrompt.update({
      where: { 
        id: promptId 
      },
      data: { 
        isActive: true,
        updatedAt: new Date()
      }
    });

    console.log(`Activated master prompt v${targetPrompt.version} for user ${session.userId}`);

    return NextResponse.json({
      success: true,
      id: targetPrompt.id,
      version: targetPrompt.version,
      message: `Master prompt v${targetPrompt.version} activated successfully`
    });

  } catch (error) {
    console.error('Error activating master prompt:', error);
    return NextResponse.json({ 
      error: 'Failed to activate master prompt',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 