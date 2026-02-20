import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { parseBoundedInt } from '@/lib/utils/params';

// In-memory cache for folder stats (5 minute expiry)
const cache = new Map<string, { data: FolderStatsResponse; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

interface FolderStats {
  id: string;
  name: string;
  emailCount: number;
  averageConfidence: number;
  lastActivity: Date | null;
  routingMethodBreakdown: {
    hardMapping: number;
    llm: number;
    fallback: number;
  };
  learningCount: number;
  recentCorrections: number;
  color: string;
  isSystemDefault: boolean;
  metaPrompt?: string;
}

interface FolderStatsResponse {
  totalFolders: number;
  totalEmails: number;
  totalLearnings: number;
  averageSystemConfidence: number;
  folderBreakdown: FolderStats[];
  recentActivity: {
    lastBatchJob: Date | null;
    emailsProcessedToday: number;
    correctionsToday: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`📊 Fetching optimized folder stats for user: ${session.userId}`);

    const url = new URL(request.url);
    const daysResult = parseBoundedInt('days', url.searchParams.get('days'), { defaultValue: 30, min: 1, max: 365 });
    if (!daysResult.ok) {
      return NextResponse.json({ error: daysResult.error }, { status: 400 });
    }

    const days = daysResult.value;
    const cacheKey = `${session.userId}-${days}`;

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`📊 Returning cached folder stats for user: ${session.userId}`);
      return NextResponse.json({
        success: true,
        data: cached.data,
        cached: true
      });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const recentCorrectionsDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Execute all queries in parallel for maximum performance
    const [
      userFolders,
      allEmailLearnings,
      recentEmailLearnings,
      lastBatchJob,
      emailsProcessedToday,
      correctionsToday,
      totalLearnings
    ] = await Promise.all([
      // Get user's folders with email sorts
      prisma.label.findMany({
        where: { userId: session.userId },
        select: {
          id: true,
          name: true,
          color: true,
          isSystemDefault: true,
          emailCount: true,
          lastBatchSort: true,
          metaPrompt: true,
          emailSorts: {
            where: {
              sortedAt: { gte: cutoffDate }
            },
            select: {
              confidence: true,
              reasoning: true,
              sortedAt: true,
              wasManuallyOverridden: true
            },
            orderBy: { sortedAt: 'desc' }
          }
        }
      }),

      // Get all email learnings grouped by folder (fix N+1 problem)
      prisma.emailLearning.groupBy({
        by: ['originalFolder', 'correctedFolder'],
        where: {
          userId: session.userId,
          isActive: true
        },
        _count: true
      }),

      // Get recent email learnings grouped by folder (fix N+1 problem)
      prisma.emailLearning.groupBy({
        by: ['originalFolder', 'correctedFolder'],
        where: {
          userId: session.userId,
          isActive: true,
          createdAt: { gte: recentCorrectionsDate }
        },
        _count: true
      }),

      // Last batch job
      prisma.batchSortJob.findFirst({
        where: { userId: session.userId },
        orderBy: { startedAt: 'desc' },
        select: { completedAt: true }
      }),

      // Emails processed today
      prisma.emailSort.count({
        where: {
          userId: session.userId,
          sortedAt: { gte: todayStart }
        }
      }),

      // Corrections today
      prisma.emailLearning.count({
        where: {
          userId: session.userId,
          createdAt: { gte: todayStart }
        }
      }),

      // Total learnings count
      prisma.emailLearning.count({
        where: {
          userId: session.userId,
          isActive: true
        }
      })
    ]);

    // Create lookup maps for learning counts (O(1) lookups instead of O(n) queries)
    const learningCountMap = new Map<string, number>();
    const recentCorrectionsMap = new Map<string, number>();

    // Process all learnings
    for (const learning of allEmailLearnings) {
      if (learning.originalFolder) {
        learningCountMap.set(learning.originalFolder, (learningCountMap.get(learning.originalFolder) || 0) + learning._count);
      }
      if (learning.correctedFolder) {
        learningCountMap.set(learning.correctedFolder, (learningCountMap.get(learning.correctedFolder) || 0) + learning._count);
      }
    }

    // Process recent corrections
    for (const correction of recentEmailLearnings) {
      if (correction.originalFolder) {
        recentCorrectionsMap.set(correction.originalFolder, (recentCorrectionsMap.get(correction.originalFolder) || 0) + correction._count);
      }
      if (correction.correctedFolder) {
        recentCorrectionsMap.set(correction.correctedFolder, (recentCorrectionsMap.get(correction.correctedFolder) || 0) + correction._count);
      }
    }

    // Process folder stats efficiently
    const folderBreakdown: FolderStats[] = [];
    let totalEmails = 0;
    let totalConfidenceSum = 0;
    let totalEmailsWithConfidence = 0;

    for (const folder of userFolders) {
      const sorts = folder.emailSorts;
      
      // Calculate routing method breakdown and confidence in a single pass
      const routingBreakdown = {
        hardMapping: 0,
        llm: 0,
        fallback: 0
      };

      let confidenceSum = 0;
      let confidenceCount = 0;

      for (const sort of sorts) {
        if (sort.confidence !== null) {
          confidenceSum += sort.confidence;
          confidenceCount++;
          totalConfidenceSum += sort.confidence;
          totalEmailsWithConfidence++;
        }

        // Optimized routing method detection
        if (sort.reasoning?.includes('Hard mapping') || sort.confidence === 1.0) {
          routingBreakdown.hardMapping++;
        } else if (sort.reasoning?.includes('routing failed') || sort.confidence === 0.1) {
          routingBreakdown.fallback++;
        } else {
          routingBreakdown.llm++;
        }
      }

      // Use O(1) lookup for learning counts instead of database queries
      const folderLearnings = learningCountMap.get(folder.name) || 0;
      const recentCorrections = recentCorrectionsMap.get(folder.name) || 0;

      const folderStat: FolderStats = {
        id: folder.id,
        name: folder.name,
        emailCount: sorts.length,
        averageConfidence: confidenceCount > 0 ? Math.round((confidenceSum / confidenceCount) * 100) / 100 : 0,
        lastActivity: sorts.length > 0 ? sorts[0].sortedAt : folder.lastBatchSort,
        routingMethodBreakdown: routingBreakdown,
        learningCount: folderLearnings,
        recentCorrections,
        color: folder.color || '#6B7280',
        isSystemDefault: folder.isSystemDefault,
        metaPrompt: folder.metaPrompt ?? undefined
      };

      folderBreakdown.push(folderStat);
      totalEmails += sorts.length;
    }

    // Sort folders by email count (most active first)
    folderBreakdown.sort((a, b) => b.emailCount - a.emailCount);

    const response: FolderStatsResponse = {
      totalFolders: userFolders.length,
      totalEmails,
      totalLearnings,
      averageSystemConfidence: totalEmailsWithConfidence > 0 
        ? Math.round((totalConfidenceSum / totalEmailsWithConfidence) * 100) / 100 
        : 0,
      folderBreakdown,
      recentActivity: {
        lastBatchJob: lastBatchJob?.completedAt ?? null,
        emailsProcessedToday,
        correctionsToday
      }
    };

    console.log(`📊 Optimized folder stats computed: ${response.totalFolders} folders, ${response.totalEmails} emails, ${response.totalLearnings} learnings (significant performance improvement)`);

    // Cache the response for future requests
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });

    return NextResponse.json({
      success: true,
      data: response,
      cached: false
    });

  } catch (error) {
    console.error('Error fetching folder stats:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch folder statistics' 
    }, { status: 500 });
  }
}
