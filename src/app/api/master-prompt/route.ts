import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { getDefaultMasterPrompt } from '@/lib/prompts';
import { MasterPromptGeneratorService } from '@/lib/ml/masterPromptGenerator';

export async function GET() {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's active master prompt
    const masterPrompt = await prisma.masterPrompt.findFirst({
      where: {
        userId: session.userId,
        isActive: true
      },
      orderBy: {
        version: 'desc'
      }
    });

    if (!masterPrompt) {
      // Return default prompt if user doesn't have one
      return NextResponse.json({
        prompt: getDefaultMasterPrompt(),
        version: 0,
        isDefault: true,
        message: 'Using default master prompt. Create a custom one to personalize your replies.'
      });
    }

    return NextResponse.json({
      id: masterPrompt.id,
      prompt: masterPrompt.prompt,
      version: masterPrompt.version,
      isDefault: false,
      isGenerated: masterPrompt.isGenerated,
      metadata: masterPrompt.metadata,
      createdAt: masterPrompt.createdAt,
      updatedAt: masterPrompt.updatedAt
    });

  } catch (error) {
    console.error('Error fetching master prompt:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch master prompt',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { prompt }: { prompt: string } = body;

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ 
        error: 'Prompt content is required' 
      }, { status: 400 });
    }

    // Get current highest version for this user
    const currentPrompt = await prisma.masterPrompt.findFirst({
      where: { userId: session.userId },
      orderBy: { version: 'desc' }
    });

    const nextVersion = currentPrompt ? currentPrompt.version + 1 : 1;

    // Deactivate all existing prompts for this user
    await prisma.masterPrompt.updateMany({
      where: { userId: session.userId },
      data: { isActive: false }
    });

    // Create new master prompt
    const newPrompt = await prisma.masterPrompt.create({
      data: {
        userId: session.userId,
        prompt: prompt.trim(),
        version: nextVersion,
        isActive: true
      }
    });

    console.log(`Created new master prompt v${nextVersion} for user ${session.userId}`);

    return NextResponse.json({
      success: true,
      id: newPrompt.id,
      version: newPrompt.version,
      message: `Master prompt v${nextVersion} created successfully`
    });

  } catch (error) {
    console.error('Error creating master prompt:', error);
    return NextResponse.json({ 
      error: 'Failed to create master prompt',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { prompt, promptId, isDistilledEdit }: { prompt: string; promptId?: string; isDistilledEdit?: boolean } = body;

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ 
        error: 'Prompt content is required' 
      }, { status: 400 });
    }

    // Handle distilled prompt edits differently
    if (isDistilledEdit && promptId) {
      console.log(`🌀 Processing distilled edit for promptId: ${promptId}, userId: ${session.userId}`);
      const generator = new MasterPromptGeneratorService();
      
      try {
        const result = await generator.updateMasterPromptFromDistilled(
          session.userId,
          promptId,
          prompt.trim()
        );

        console.log(`✅ Master Prompt updated from distilled edits to v${result.version}`);
        return NextResponse.json({
          success: true,
          id: result.id,
          version: result.version,
          message: `Master Prompt updated from distilled edits to v${result.version}`,
          isDistilledUpdate: true
        });
      } catch (error) {
        console.error('❌ Error updating from distilled edits:', error);
        return NextResponse.json({ 
          error: 'Failed to update Master Prompt from distilled edits',
          details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
      }
    }

    let targetPrompt;

    if (promptId) {
      // Update specific prompt
      targetPrompt = await prisma.masterPrompt.findFirst({
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
    } else {
      // Update active prompt
      targetPrompt = await prisma.masterPrompt.findFirst({
        where: {
          userId: session.userId,
          isActive: true
        }
      });

      if (!targetPrompt) {
        return NextResponse.json({ 
          error: 'No active master prompt found' 
        }, { status: 404 });
      }
    }

    // Update the prompt
    const updatedPrompt = await prisma.masterPrompt.update({
      where: { id: targetPrompt.id },
      data: { 
        prompt: prompt.trim(),
        updatedAt: new Date()
      }
    });

    console.log(`Updated master prompt ${updatedPrompt.id} for user ${session.userId}`);

    return NextResponse.json({
      success: true,
      id: updatedPrompt.id,
      version: updatedPrompt.version,
      message: 'Master prompt updated successfully'
    });

  } catch (error) {
    console.error('Error updating master prompt:', error);
    return NextResponse.json({ 
      error: 'Failed to update master prompt',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 