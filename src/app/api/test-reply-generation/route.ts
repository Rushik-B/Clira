import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { ReplyGeneratorService } from '@/lib/services/core/replyGenerator';
import { devOnlyGuard } from '@/lib/utils/devOnly';
import { logger } from '@/lib/logger';

interface CustomEmailData {
  from: string;
  subject: string;
  body: string;
  to?: string[];
}

export async function POST(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body for custom email data
    const body = await request.json();
    const { customEmail }: { customEmail?: CustomEmailData } = body;

    let testEmail;

    if (customEmail) {
      // Use custom email data provided by user
      if (!customEmail.from || !customEmail.subject || !customEmail.body) {
        return NextResponse.json({
          error: 'Missing required fields',
          message: 'From, subject, and body are required for custom email testing'
        }, { status: 400 });
      }

      testEmail = {
        from: customEmail.from,
        to: customEmail.to || [session.user?.email || 'user@example.com'],
        subject: customEmail.subject,
        body: customEmail.body,
        createdAt: new Date()
      };
    } else {
      // Fallback to using existing email from database
      const randomEmail = await prisma.email.findFirst({
        where: {
          thread: {
            userId: session.userId
          },
          isSent: false, // Use received emails as test cases
        },
        include: {
          thread: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (!randomEmail) {
        return NextResponse.json({
          error: 'No emails found for testing',
          message: 'Please provide custom email data or fetch your emails first'
        }, { status: 404 });
      }

      testEmail = randomEmail;
    }

    // Initialize reply generator service
    const replyGenerator = new ReplyGeneratorService();

    // Generate reply using email data
    const result = await replyGenerator.generateReply({
      userId: session.userId,
      mailboxId: testEmail.mailboxId ?? undefined,
      gmailMessageId: testEmail.messageId, // Use stored messageId for potential label application
      currentLabelIds: [], // Labels not tracked in test endpoint
      incomingEmail: {
        from: testEmail.from,
        to: testEmail.to,
        subject: testEmail.subject,
        body: testEmail.body,
        date: testEmail.createdAt
      }
    });

    // Get user's active master prompt for response
    const masterPrompt = await prisma.masterPrompt.findFirst({
      where: {
        userId: session.userId,
        isActive: true
      }
    });

    // Get email history count from this sender
    const historyCount = await prisma.email.count({
      where: {
        thread: {
          userId: session.userId
        },
        from: testEmail.from
      }
    });

    return NextResponse.json({
      success: true,
      testEmail: {
        from: testEmail.from,
        to: testEmail.to,
        subject: testEmail.subject,
        body: testEmail.body,
        date: testEmail.createdAt
      },
      masterPrompt: {
        version: masterPrompt?.version || 0,
        isDefault: !masterPrompt,
        prompt: masterPrompt?.prompt || 'Default prompt'
      },
      historicalEmailsCount: historyCount,
      generatedReply: {
        reply: result.reply,
        confidence: result.confidence,
        reasoning: result.reasoning
      },
      timestamp: new Date().toISOString(),
      isCustomEmail: !!customEmail
    });

  } catch (error) {
    logger.error('Error in test reply generation:', error);
    return NextResponse.json({ 
      error: 'Failed to test reply generation',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
