import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma as prismaClient } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ labelId: string }> }
) {
  try {
    const prisma: any = prismaClient;

    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { labelId } = await params;

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify folder ownership
    const folder = await prisma.label.findFirst({
      where: {
        id: labelId,
        userId: user.id
      }
    });

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    // Get conversation
    const conversation = prisma.folderConversation?.findUnique ? await prisma.folderConversation.findUnique({
      where: {
        userId_labelId: {
          userId: user.id,
          labelId: labelId
        }
      }
    }) : null;

    if (!conversation) {
      return NextResponse.json({
        success: true,
        conversation: null
      });
    }

    return NextResponse.json({
      success: true,
      conversation: {
        id: conversation.id,
        messages: conversation.messages,
        lastMessageAt: conversation.lastMessageAt,
        isActive: conversation.isActive
      }
    });

  } catch (error) {
    console.error('[FOLDER CONVERSATION] Error fetching conversation:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch conversation',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ labelId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { labelId } = await params;

    // Get user
    const user = await prismaClient.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Delete conversation and related edit sessions
    await prismaClient.$transaction?.(async (tx: any) => {
      // Delete edit sessions first (due to foreign key constraint)
      if (tx.folderEditSession?.deleteMany) await tx.folderEditSession.deleteMany({
        where: {
          userId: user.id,
          labelId: labelId
        }
      });

      // Delete conversation
      if (tx.folderConversation?.deleteMany) await tx.folderConversation.deleteMany({
        where: {
          userId: user.id,
          labelId: labelId
        }
      });
    });

    console.log(`[FOLDER CONVERSATION] Deleted conversation for folder ${labelId}`);

    return NextResponse.json({
      success: true,
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    console.error('[FOLDER CONVERSATION] Error deleting conversation:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to delete conversation',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}