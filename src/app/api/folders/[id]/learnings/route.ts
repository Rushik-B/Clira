import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailLearningService } from '@/lib/services/onboarding-services/emailLearningService';

interface FolderLearningsResponse {
  success: boolean;
  learnings: Array<{
    id: string;
    emailFrom: string;
    originalFolder: string;
    correctedFolder: string;
    userReason: string | null;
    aiSummary: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
  stats: {
    totalLearnings: number;
    activeLearnings: number;
    recentLearnings: number;
    topSenders: Array<{ sender: string; count: number }>;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: folderId } = await params;

    // Validate folder exists and user owns it
    const folder = await prisma.label.findFirst({
      where: {
        id: folderId,
        userId: session.userId
      }
    });

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found or access denied' }, { status: 404 });
    }

    console.log(`📚 Fetching learnings for folder ${folder.name} (${folderId})`);

    // Get learnings related to this folder
    const learnings = await prisma.emailLearning.findMany({
      where: {
        userId: session.userId,
        OR: [
          { originalFolder: folder.name },
          { correctedFolder: folder.name }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 100 // Limit to recent 100 learnings
    });

    // Calculate statistics
    const totalLearnings = learnings.length;
    const activeLearnings = learnings.filter(l => l.isActive).length;
    
    // Recent learnings (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentLearnings = learnings.filter(l => l.createdAt >= sevenDaysAgo).length;

    // Top senders with corrections
    const senderCounts = new Map<string, number>();
    learnings.forEach(learning => {
      const count = senderCounts.get(learning.emailFrom) || 0;
      senderCounts.set(learning.emailFrom, count + 1);
    });

    const topSenders = Array.from(senderCounts.entries())
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const response: FolderLearningsResponse = {
      success: true,
      learnings: learnings.map(learning => ({
        id: learning.id,
        emailFrom: learning.emailFrom,
        originalFolder: learning.originalFolder,
        correctedFolder: learning.correctedFolder,
        userReason: learning.userReason,
        aiSummary: learning.aiSummary,
        isActive: learning.isActive,
        createdAt: learning.createdAt,
        updatedAt: learning.updatedAt
      })),
      stats: {
        totalLearnings,
        activeLearnings,
        recentLearnings,
        topSenders
      }
    };

    console.log(`📚 Retrieved ${learnings.length} learnings for folder ${folder.name}`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching folder learnings:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch folder learnings' 
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: folderId } = await params;
    const url = new URL(request.url);
    const learningId = url.searchParams.get('learningId');

    if (!learningId) {
      return NextResponse.json({ error: 'Learning ID is required' }, { status: 400 });
    }

    // Validate folder exists and user owns it
    const folder = await prisma.label.findFirst({
      where: {
        id: folderId,
        userId: session.userId
      }
    });

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found or access denied' }, { status: 404 });
    }

    console.log(`🗑️ Deactivating learning ${learningId} for folder ${folder.name}`);

    // Deactivate the learning (soft delete)
    const emailLearningService = new EmailLearningService();
    await emailLearningService.deactivateLearning(session.userId, learningId);

    console.log(`✅ Successfully deactivated learning ${learningId}`);

    return NextResponse.json({
      success: true,
      message: 'Learning deactivated successfully'
    });

  } catch (error) {
    console.error('Error deactivating learning:', error);
    return NextResponse.json({ 
      error: 'Failed to deactivate learning' 
    }, { status: 500 });
  }
}