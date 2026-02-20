import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { GmailService } from '@/lib/email/gmail';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { parseBoundedFloat, parseBoundedInt } from '@/lib/utils/params';

interface EmailReviewItem {
  id: string;
  gmailMessageId: string;
  gmailThreadId?: string;
  from: string;
  subject: string;
  snippet: string;
  body?: string;
  date: Date;
  folderId: string;
  folderName: string;
  confidence: number;
  reasoning: string;
  routingMethod: string;
  wasManuallyOverridden: boolean;
  hasAttachment?: boolean;
  priority?: 'high' | 'medium' | 'low';
  gmailCategories?: string[];
}

interface EmailReviewResponse {
  emails: EmailReviewItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    availableFolders: Array<{
      id: string;
      name: string;
      color: string;
      count: number;
    }>;
    confidenceRange: {
      min: number;
      max: number;
    };
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const pageResult = parseBoundedInt('page', url.searchParams.get('page'), { defaultValue: 1, min: 1, max: 500 });
    if (!pageResult.ok) {
      return NextResponse.json({ error: pageResult.error }, { status: 400 });
    }

    const limitResult = parseBoundedInt('limit', url.searchParams.get('limit'), { defaultValue: 20, min: 1, max: 100 });
    if (!limitResult.ok) {
      return NextResponse.json({ error: limitResult.error }, { status: 400 });
    }

    const page = pageResult.value;
    const limit = limitResult.value;
    const folderId = url.searchParams.get('folderId');
    const confidenceMinResult = parseBoundedFloat('confidenceMin', url.searchParams.get('confidenceMin'), {
      defaultValue: 0,
      min: 0,
      max: 1,
    });
    if (!confidenceMinResult.ok) {
      return NextResponse.json({ error: confidenceMinResult.error }, { status: 400 });
    }

    const confidenceMaxResult = parseBoundedFloat('confidenceMax', url.searchParams.get('confidenceMax'), {
      defaultValue: 1,
      min: 0,
      max: 1,
    });
    if (!confidenceMaxResult.ok) {
      return NextResponse.json({ error: confidenceMaxResult.error }, { status: 400 });
    }

    const confidenceMin = confidenceMinResult.value;
    const confidenceMax = confidenceMaxResult.value;
    const search = url.searchParams.get('search');
    const daysResult = parseBoundedInt('days', url.searchParams.get('days'), { defaultValue: 30, min: 1, max: 365 });
    if (!daysResult.ok) {
      return NextResponse.json({ error: daysResult.error }, { status: 400 });
    }

    const days = daysResult.value;

    if (confidenceMin > confidenceMax) {
      return NextResponse.json({ error: 'confidenceMin must be <= confidenceMax' }, { status: 400 });
    }

    console.log(`📧 Fetching email review data for user ${session.userId}: page=${page}, limit=${limit}, folder=${folderId}`);

    // Calculate date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Build where clause
    const whereClause: any = {
      userId: session.userId,
      sortedAt: { gte: cutoffDate },
      confidence: {
        gte: confidenceMin,
        lte: confidenceMax
      }
    };

    if (folderId) {
      whereClause.labelId = folderId;
    }

    // Get OAuth token for Gmail API access
    let gmailService: GmailService | null = null;
    const gmailResult = await createGmailServiceForUser({
      userId: session.userId,
      purpose: 'email-review:list',
      requester: 'api.email-review.GET',
    });
    if (gmailResult) {
      gmailService = gmailResult.gmail;
    }

    // Get email sorts with pagination
    const [emailSorts, totalCount] = await Promise.all([
      prisma.emailSort.findMany({
        where: whereClause,
        include: {
          label: {
            select: {
              id: true,
              name: true,
              color: true
            }
          }
        },
        orderBy: { sortedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.emailSort.count({ where: whereClause })
    ]);

    // If no email sorts found, return empty response
    if (emailSorts.length === 0) {
      console.log(`📧 No email sorts found for user ${session.userId}`);
      
      // Get available folders for filters (even if empty)
      const availableFolders = await prisma.label.findMany({
        where: { userId: session.userId },
        select: {
          id: true,
          name: true,
          color: true
        }
      }).then(folders => folders.map(folder => ({
        id: folder.id,
        name: folder.name,
        color: folder.color || '#6B7280',
        count: 0
      })));

      const response: EmailReviewResponse = {
        emails: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0
        },
        filters: {
          availableFolders,
          confidenceRange: {
            min: 0,
            max: 1
          }
        }
      };

      return NextResponse.json({
        success: true,
        data: response
      });
    }

    // Fetch email details from Gmail API
    const emails: EmailReviewItem[] = [];
    
    for (const sort of emailSorts) {
      try {
        let emailDetails: any = {
          from: 'Unknown',
          subject: 'No Subject',
          snippet: 'No preview available',
          body: '',
          hasAttachment: false,
          gmailCategories: []
        };

        // Try to fetch from Gmail API
        if (gmailService) {
          try {
            const gmailEmail = await gmailService.getMessage(sort.gmailMessageId);
            
            if (gmailEmail) {
              emailDetails = {
                from: gmailEmail.from || 'Unknown',
                subject: gmailEmail.subject || 'No Subject',
                snippet: gmailEmail.snippet || gmailEmail.body?.substring(0, 200) || 'No preview available',
                body: gmailEmail.body || '',
                hasAttachment: gmailEmail.body?.includes('attachment') || false,
                gmailCategories: gmailEmail.gmailCategories || []
              };
            }
          } catch (gmailError) {
            console.warn(`Failed to fetch Gmail details for ${sort.gmailMessageId}:`, gmailError);
            // Continue with placeholder data
          }
        }

        // Apply search filter if provided
        if (search) {
          const searchLower = search.toLowerCase();
          const matchesSearch = 
            emailDetails.from.toLowerCase().includes(searchLower) ||
            emailDetails.subject.toLowerCase().includes(searchLower) ||
            emailDetails.snippet.toLowerCase().includes(searchLower);
          
          if (!matchesSearch) {
            continue;
          }
        }

        // Determine routing method from reasoning
        let routingMethod = 'unknown';
        if (sort.reasoning?.includes('Hard mapping') || sort.confidence === 1.0) {
          routingMethod = 'hard_mapping';
        } else if (sort.reasoning?.includes('routing failed') || sort.confidence === 0.1) {
          routingMethod = 'fallback';
        } else {
          routingMethod = 'llm';
        }

        // Determine priority based on confidence and folder
        let priority: 'high' | 'medium' | 'low' = 'medium';
        if ((sort.confidence ?? 0) < 0.5) {
          priority = 'low';
        } else if ((sort.confidence ?? 0) > 0.9 || sort.label.name === 'Action Needed') {
          priority = 'high';
        }

        const emailItem: EmailReviewItem = {
          id: sort.id,
          gmailMessageId: sort.gmailMessageId,
          gmailThreadId: sort.gmailThreadId || undefined,
          from: emailDetails.from,
          subject: emailDetails.subject,
          snippet: emailDetails.snippet,
          body: emailDetails.body,
          date: sort.sortedAt,
          folderId: sort.labelId,
          folderName: sort.label.name,
          confidence: sort.confidence || 0,
          reasoning: sort.reasoning || 'No reasoning provided',
          routingMethod,
          wasManuallyOverridden: sort.wasManuallyOverridden,
          hasAttachment: emailDetails.hasAttachment,
          priority,
          gmailCategories: emailDetails.gmailCategories
        };

        emails.push(emailItem);

      } catch (error) {
        console.error(`Error processing email sort ${sort.id}:`, error);
        // Continue with next email
      }
    }

    // Get available folders with counts for filters
    const folderCounts = await prisma.emailSort.groupBy({
      by: ['labelId'],
      where: {
        userId: session.userId,
        sortedAt: { gte: cutoffDate }
      },
      _count: {
        id: true
      }
    });

    const folderDetails = await prisma.label.findMany({
      where: {
        userId: session.userId,
        id: {
          in: folderCounts.map(f => f.labelId)
        }
      },
      select: {
        id: true,
        name: true,
        color: true
      }
    });

    const availableFolders = folderDetails.map(folder => ({
      id: folder.id,
      name: folder.name,
      color: folder.color || '#6B7280',
      count: folderCounts.find(f => f.labelId === folder.id)?._count.id || 0
    })).sort((a, b) => b.count - a.count);

    // Get confidence range
    const confidenceStats = await prisma.emailSort.aggregate({
      where: {
        userId: session.userId,
        sortedAt: { gte: cutoffDate },
        confidence: { not: null }
      },
      _min: { confidence: true },
      _max: { confidence: true }
    });

    const response: EmailReviewResponse = {
      emails,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      },
      filters: {
        availableFolders,
        confidenceRange: {
          min: confidenceStats._min.confidence || 0,
          max: confidenceStats._max.confidence || 1
        }
      }
    };

    console.log(`📧 Email review data fetched: ${emails.length} emails, ${availableFolders.length} folders`);

    return NextResponse.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('Error fetching email review data:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch email review data' 
    }, { status: 500 });
  }
}
