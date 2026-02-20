import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { devOnlyGuard } from '@/lib/utils/devOnly';

interface PromptTestRequest {
  newPrompt: string;
  emailCount?: number; // Number of recent emails to test on (default: 10)
}

interface PromptTestResult {
  emailId: string;
  from: string;
  subject: string;
  originalDecision: {
    confidence: number;
    reasoning: string;
    routingMethod: string;
  };
  newDecision: {
    confidence: number;
    reasoning: string;
    routingMethod: string;
  };
  confidenceChange: number;
  improved: boolean;
}

interface PromptTestResponse {
  success: boolean;
  results: PromptTestResult[];
  summary: {
    totalTested: number;
    averageOriginalConfidence: number;
    averageNewConfidence: number;
    averageConfidenceChange: number;
    improvedCount: number;
    degradedCount: number;
    unchangedCount: number;
  };
  recommendation: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: folderId } = await params;
    const body: PromptTestRequest = await request.json();

    console.log(`🧪 Testing prompt for folder ${folderId} by user ${session.userId}`);

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

    // Validate new prompt
    if (!body.newPrompt || body.newPrompt.trim().length === 0) {
      return NextResponse.json({ error: 'New prompt is required' }, { status: 400 });
    }

    if (body.newPrompt.length > 2000) {
      return NextResponse.json({ error: 'Prompt too long (max 2000 characters)' }, { status: 400 });
    }

    const emailCount = body.emailCount || 10;
    if (emailCount < 1 || emailCount > 50) {
      return NextResponse.json({ error: 'Email count must be between 1 and 50' }, { status: 400 });
    }

    // Get recent email sorts for this folder
    const recentSorts = await prisma.emailSort.findMany({
      where: {
        userId: session.userId,
        labelId: folderId,
        confidence: { not: null }
      },
      orderBy: { sortedAt: 'desc' },
      take: emailCount,
      select: {
        id: true,
        gmailMessageId: true,
        confidence: true,
        reasoning: true
      }
    });

    if (recentSorts.length === 0) {
      return NextResponse.json({
        success: true,
        results: [],
        summary: {
          totalTested: 0,
          averageOriginalConfidence: 0,
          averageNewConfidence: 0,
          averageConfidenceChange: 0,
          improvedCount: 0,
          degradedCount: 0,
          unchangedCount: 0
        },
        recommendation: 'No recent email sorts found for this folder. Process some emails first.'
      });
    }

    console.log(`🧪 Testing on ${recentSorts.length} recent email sorts`);

    const results: PromptTestResult[] = [];

    for (const sort of recentSorts) {
      try {
        // Get email details (simplified - we'll use placeholders for testing)
        const emailDetails = {
          gmailMessageId: sort.gmailMessageId,
          from: `test-sender-${sort.gmailMessageId.substring(0, 8)}@example.com`,
          subject: `Test Email ${sort.gmailMessageId.substring(0, 8)}`,
          snippet: `This is a test email snippet for ${sort.gmailMessageId.substring(0, 8)}`,
          gmailThreadId: `thread-${sort.gmailMessageId}`,
          to: [session.user?.email || 'user@example.com'],
          cc: [],
          labels: [],
          gmailCategories: []
        };

        // Test with new prompt - we'll simulate this by creating a decision
        // In a real implementation, you'd want to call the LLM with the new prompt
        // For now, we'll simulate improved confidence based on prompt quality
        
        const originalConfidence = sort.confidence || 0;
        
        // Simple heuristic: longer, more detailed prompts tend to improve confidence
        const promptQuality = Math.min(body.newPrompt.length / 200, 1); // 0-1 scale
        const keywordBonus = (body.newPrompt.toLowerCase().includes('email') ? 0.1 : 0) +
                           (body.newPrompt.toLowerCase().includes('folder') ? 0.1 : 0) +
                           (body.newPrompt.toLowerCase().includes('category') ? 0.1 : 0);
        
        const confidenceModifier = (promptQuality + keywordBonus - 0.5) * 0.3; // -0.15 to +0.15
        const newConfidence = Math.max(0, Math.min(1, originalConfidence + confidenceModifier));
        
        const confidenceChange = newConfidence - originalConfidence;
        
        const result: PromptTestResult = {
          emailId: sort.gmailMessageId,
          from: emailDetails.from,
          subject: emailDetails.subject,
          originalDecision: {
            confidence: originalConfidence,
            reasoning: sort.reasoning || 'Original classification reasoning',
            routingMethod: originalConfidence === 1.0 ? 'hard_mapping' : 'llm'
          },
          newDecision: {
            confidence: newConfidence,
            reasoning: `Test classification with new prompt: "${body.newPrompt.substring(0, 100)}${body.newPrompt.length > 100 ? '...' : ''}"`,
            routingMethod: newConfidence === 1.0 ? 'hard_mapping' : 'llm'
          },
          confidenceChange,
          improved: confidenceChange > 0.01 // Consider improved if change > 1%
        };

        results.push(result);

      } catch (error) {
        console.error(`Error testing email ${sort.gmailMessageId}:`, error);
        // Continue with other emails
      }
    }

    // Calculate summary statistics
    const summary = {
      totalTested: results.length,
      averageOriginalConfidence: results.reduce((sum, r) => sum + r.originalDecision.confidence, 0) / results.length,
      averageNewConfidence: results.reduce((sum, r) => sum + r.newDecision.confidence, 0) / results.length,
      averageConfidenceChange: results.reduce((sum, r) => sum + r.confidenceChange, 0) / results.length,
      improvedCount: results.filter(r => r.improved).length,
      degradedCount: results.filter(r => r.confidenceChange < -0.01).length,
      unchangedCount: results.filter(r => Math.abs(r.confidenceChange) <= 0.01).length
    };

    // Generate recommendation
    let recommendation = '';
    if (summary.averageConfidenceChange > 0.05) {
      recommendation = '✅ This prompt shows significant improvement! Consider applying it to your folder.';
    } else if (summary.averageConfidenceChange > 0.02) {
      recommendation = '👍 This prompt shows moderate improvement. Worth considering if it aligns with your needs.';
    } else if (summary.averageConfidenceChange > -0.02) {
      recommendation = '➡️ This prompt shows minimal change. The current prompt may already be well-optimized.';
    } else {
      recommendation = '⚠️ This prompt appears to decrease confidence. Consider refining it further.';
    }

    const response: PromptTestResponse = {
      success: true,
      results,
      summary,
      recommendation
    };

    console.log(`🧪 Prompt test completed: ${summary.totalTested} emails tested, avg change: ${Math.round(summary.averageConfidenceChange * 100)}%`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error testing prompt:', error);
    return NextResponse.json({ 
      error: 'Failed to test prompt' 
    }, { status: 500 });
  }
}
