import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma as prismaClient } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { folderId, message, currentPrompt } = body;

    if (!folderId || !message) {
      return NextResponse.json({ error: 'Folder ID and message are required' }, { status: 400 });
    }

    const prisma: any = prismaClient; // Cast to any to access dynamic models not yet in Prisma schema

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
        id: folderId,
        userId: user.id
      }
    });

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    // Get or create conversation
    let conversation = await prisma.folderConversation?.findUnique ? await prisma.folderConversation.findUnique({
      where: {
        userId_labelId: {
          userId: user.id,
          labelId: folderId
        }
      }
    }) : null;

    if (!conversation && prisma.folderConversation?.create) {
      conversation = await prisma.folderConversation.create({
        data: {
          userId: user.id,
          labelId: folderId,
          messages: [],
          isActive: true
        }
      });
    }

    // Build conversation context for LLM
    const existingMessages = Array.isArray(conversation.messages) ? conversation.messages as any[] : [];
    const conversationHistory = existingMessages.map(msg => 
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
    ).join('\n');

    // For now, provide a simple response without heavy LLM processing
    // In the future, this could queue a worker job for complex rule updates
    const assistantResponse = `I understand you want to customize the "${folder.name}" folder. For complex rule modifications, please use the main folder management interface where changes can be processed properly in the background.

Current message saved to conversation history. You can continue the conversation, and when ready, apply changes through the folder settings.`;

    const updatedPrompt = currentPrompt;
    const shouldUpdateFolder = false;

    // For simple rule updates, handle them directly
    // Complex updates should be moved to worker processing in the future

    // Add messages to conversation
    const newMessages = [
      ...existingMessages,
      {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      },
      {
        role: 'assistant',
        content: assistantResponse,
        timestamp: new Date().toISOString()
      }
    ];

    // Update conversation
    if (prisma.folderConversation?.update) await prisma.folderConversation.update({
      where: { id: conversation.id },
      data: {
        messages: newMessages,
        lastMessageAt: new Date(),
        isActive: true
      }
    });

    // Create edit session if rule was updated
    if (shouldUpdateFolder) {
      if (prisma.folderEditSession?.create) await prisma.folderEditSession.create({
        data: {
          userId: user.id,
          labelId: folderId,
          conversationId: conversation.id,
          originalPrompt: currentPrompt || '',
          currentPrompt: updatedPrompt,
          status: 'COMPLETED',
          changes: [{
            type: 'rule_update',
            oldValue: currentPrompt,
            newValue: updatedPrompt,
            timestamp: new Date().toISOString()
          }],
          llmTokensUsed: 0, // No LLM tokens used in lightweight mode
          completedAt: new Date()
        }
      });
    }

    console.log(`[FOLDER CHAT] Processed message for folder ${folder.name}: ${shouldUpdateFolder ? 'Rule updated' : 'Conversation only'}`);

    return NextResponse.json({
      success: true,
      response: assistantResponse,
      updatedPrompt: shouldUpdateFolder ? updatedPrompt : null,
      tokensUsed: 0
    });

  } catch (error) {
    console.error('[FOLDER CHAT] Error processing chat message:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process chat message',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}