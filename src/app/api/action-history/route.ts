import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { parseBoundedInt } from '@/lib/utils/params';

// Force dynamic rendering - this route requires runtime data
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');
    const actionType = url.searchParams.get('actionType') || 'all';

    const daysResult = parseBoundedInt('days', daysParam, { defaultValue: 7, min: 1, max: 365 });
    if (!daysResult.ok) {
      return NextResponse.json({ error: daysResult.error }, { status: 400 });
    }

    const daysNumber = daysResult.value;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNumber);

    // Build filter conditions
    const where: Prisma.ActionHistoryWhereInput = {
      userId: session.userId,
      createdAt: {
        gte: startDate
      }
    };

    // Add action type filter if specified
    if (actionType !== 'all') {
      if (actionType === 'sent') {
        where.actionType = { in: ['EMAIL_SENT', 'EMAIL_EDITED'] };
      } else if (actionType === 'rejected') {
        where.actionType = 'EMAIL_REJECTED';
      } else if (actionType === 'snoozed') {
        where.actionType = 'EMAIL_SNOOZED';
      }
    }

    // Fetch action history
    const actions = await prisma.actionHistory.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      take: 100 // Limit to recent 100 actions
    });

    // Transform to match HistoryItem interface
    const historyItems = actions.map(action => ({
      id: action.id,
      actionType: action.actionType,
      actionSummary: action.actionSummary,
      timestamp: action.createdAt.toISOString(),
      fullContext: JSON.stringify(action.actionDetails, null, 2),
      promptState: action.promptState || 'Unknown',
      feedback: action.metadata ? JSON.stringify(action.metadata) : 'No additional details',
      confidence: action.confidence,
      undoable: action.undoable,
      emailReference: action.emailReference
    }));

    return NextResponse.json({ 
      success: true, 
      historyItems,
      totalCount: actions.length
    });

  } catch (error) {
    console.error('Error fetching action history:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch action history',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
