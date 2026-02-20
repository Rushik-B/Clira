import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { GmailPushService } from '@/lib/email/gmailPushService';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';
import { devOnlyGuard } from '@/lib/utils/devOnly';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    logger.debug('Testing Gmail push notification flow...');

    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's OAuth token
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { accounts: true }
    });

    if (!user || !user.accounts.length) {
      return NextResponse.json({ 
        error: 'No OAuth accounts found' 
      }, { status: 400 });
    }

    const gmailContext = await createGmailServiceForUser({
      userId: session.userId,
      purpose: 'gmail-push:test-flow',
      requester: 'api.test-gmail-flow.POST',
    });

    if (!gmailContext) {
      return NextResponse.json({
        error: 'No Gmail access token found. Please reconnect your Google account.'
      }, { status: 400 });
    }

    // Create Gmail push service with user credentials
    const pushService = new GmailPushService(session.userId);

    logger.debug('Simulating push notification processing...');
    await pushService.processPushNotification({
      emailAddress: user.email,
      historyId: Date.now().toString()
    });

    // Check if any emails were processed and replies generated
    const recentReplies = await prisma.generatedDraft.findMany({
      where: {
        email: {
          thread: {
            userId: session.userId
          }
        }
      },
      include: {
        email: {
          include: {
            thread: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    logger.debug(`Found ${recentReplies.length} recent generated replies`);

    // Get queue status
    const queueEmails = await prisma.email.findMany({
      where: {
        thread: {
          userId: session.userId
        },
        isSent: false,
        generatedDraft: {
          isNot: null
        }
      },
      include: {
        generatedDraft: true,
        thread: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    logger.debug(`Found ${queueEmails.length} emails in queue`);

    return NextResponse.json({
      success: true,
      message: 'Gmail push notification flow test completed',
      results: {
        userEmail: user.email,
        hasGmailAccess: !!gmailContext.credentials.accessToken,
        recentRepliesCount: recentReplies.length,
        queueEmailsCount: queueEmails.length,
        recentReplies: recentReplies.map(reply => ({
          emailId: reply.emailId,
          from: reply.email.from,
          subject: reply.email.subject,
          confidenceScore: reply.confidenceScore,
          gmailDraftId: reply.gmailDraftId,
          createdAt: reply.createdAt
        })),
        queueEmails: queueEmails.map(email => ({
          id: email.id,
          from: email.from,
          subject: email.subject,
          hasDraft: !!email.generatedDraft,
          confidenceScore: email.generatedDraft?.confidenceScore,
          gmailDraftId: email.generatedDraft?.gmailDraftId,
          createdAt: email.createdAt
        }))
      }
    });

  } catch (error) {
    logger.error('Error testing Gmail flow:', error);
    return NextResponse.json({ 
      error: 'Failed to test Gmail flow',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
