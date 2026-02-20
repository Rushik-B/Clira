import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { parseBoundedInt } from '@/lib/utils/params';

// API endpoint to get feedback analytics for the user
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const daysResult = parseBoundedInt('days', searchParams.get('days'), { defaultValue: 30, min: 1, max: 365 });
    if (!daysResult.ok) {
      return NextResponse.json({ error: daysResult.error }, { status: 400 });
    }

    const days = daysResult.value;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    // Get comprehensive feedback statistics
    const feedbackStats = await prisma.feedback.findMany({
      where: {
        userId: session.userId,
        createdAt: {
          gte: dateFrom
        }
      },
      include: {
        email: {
          select: {
            from: true,
            subject: true,
            createdAt: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Analyze feedback patterns
    const analytics = {
      totalFeedback: feedbackStats.length,
      actionBreakdown: {
        accepted: feedbackStats.filter(f => f.action === 'ACCEPTED').length,
        edited: feedbackStats.filter(f => f.action === 'EDITED').length,
        rejected: feedbackStats.filter(f => f.action === 'REJECTED').length,
      },
      rejectionAnalysis: {
        totalRejections: feedbackStats.filter(f => f.action === 'REJECTED').length,
        rejectionReasons: feedbackStats
          .filter(f => f.action === 'REJECTED')
          .map(f => ({
            reason: (f.editDelta as any)?.reason || 'No reason provided',
            category: (f.editDelta as any)?.feedbackCategory || 'general',
            confidenceScore: (f.editDelta as any)?.confidenceScore || 0,
            sender: f.email.from,
            subject: f.email.subject,
            rejectedAt: (f.editDelta as any)?.rejectedAt || f.createdAt
          }))
          .sort((a, b) => new Date(b.rejectedAt).getTime() - new Date(a.rejectedAt).getTime()),
        commonCategories: getCategoryFrequency(feedbackStats.filter(f => f.action === 'REJECTED')),
        averageConfidenceOfRejected: getAverageConfidence(feedbackStats.filter(f => f.action === 'REJECTED'))
      },
      editAnalysis: {
        totalEdits: feedbackStats.filter(f => f.action === 'EDITED').length,
        editPatterns: feedbackStats
          .filter(f => f.action === 'EDITED')
          .map(f => ({
            originalLength: (f.editDelta as any)?.originalLength || 0,
            finalLength: (f.editDelta as any)?.finalLength || 0,
            lengthChange: ((f.editDelta as any)?.finalLength || 0) - ((f.editDelta as any)?.originalLength || 0),
            confidenceScore: (f.editDelta as any)?.confidenceScore || 0,
            sender: f.email.from,
            subject: f.email.subject,
            editedAt: (f.editDelta as any)?.editedAt || f.createdAt
          }))
          .sort((a, b) => new Date(b.editedAt).getTime() - new Date(a.editedAt).getTime()),
        averageConfidenceOfEdited: getAverageConfidence(feedbackStats.filter(f => f.action === 'EDITED'))
      },
      acceptanceAnalysis: {
        totalAccepted: feedbackStats.filter(f => f.action === 'ACCEPTED').length,
        averageConfidenceOfAccepted: getAverageConfidence(feedbackStats.filter(f => f.action === 'ACCEPTED')),
        acceptedEmails: feedbackStats
          .filter(f => f.action === 'ACCEPTED')
          .map(f => ({
            confidenceScore: (f.editDelta as any)?.confidenceScore || 0,
            sender: f.email.from,
            subject: f.email.subject,
            acceptedAt: (f.editDelta as any)?.acceptedAt || f.createdAt
          }))
          .sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime())
      },
      performanceMetrics: {
        acceptanceRate: feedbackStats.length > 0 ? 
          (feedbackStats.filter(f => f.action === 'ACCEPTED').length / feedbackStats.length * 100).toFixed(1) : 0,
        editRate: feedbackStats.length > 0 ? 
          (feedbackStats.filter(f => f.action === 'EDITED').length / feedbackStats.length * 100).toFixed(1) : 0,
        rejectionRate: feedbackStats.length > 0 ? 
          (feedbackStats.filter(f => f.action === 'REJECTED').length / feedbackStats.length * 100).toFixed(1) : 0,
        averageConfidenceOverall: getAverageConfidence(feedbackStats)
      },
      timeRange: {
        from: dateFrom.toISOString(),
        to: new Date().toISOString(),
        days: days
      }
    };

    return NextResponse.json({ 
      success: true, 
      analytics,
      feedbackCount: feedbackStats.length 
    });

  } catch (error) {
    console.error('Error fetching feedback analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch feedback analytics' }, { status: 500 });
  }
}

// Helper function to get category frequency
function getCategoryFrequency(rejectedFeedback: any[]): Record<string, number> {
  const categories: Record<string, number> = {};
  
  rejectedFeedback.forEach(feedback => {
    const category = (feedback.editDelta as any)?.feedbackCategory || 'general';
    categories[category] = (categories[category] || 0) + 1;
  });
  
  return Object.entries(categories)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
}

// Helper function to get average confidence
function getAverageConfidence(feedbackList: any[]): number {
  if (feedbackList.length === 0) return 0;
  
  const validConfidences = feedbackList
    .map(f => (f.editDelta as any)?.confidenceScore || 0)
    .filter(score => score > 0);
  
  if (validConfidences.length === 0) return 0;
  
  const sum = validConfidences.reduce((acc, score) => acc + score, 0);
  return parseFloat((sum / validConfidences.length).toFixed(2));
} 
