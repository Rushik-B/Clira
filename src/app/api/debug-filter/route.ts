import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { EmailFilterService, EmailMessage } from '@/lib/email/emailFilterService';
import { prisma } from '@/lib/prisma';
import { devOnlyGuard } from '@/lib/utils/devOnly';
import { logger } from '@/lib/logger';
import { ReplyRouterAgent } from '@/lib/ai/agents/replyRouterAgent';

const emailFilterService = new EmailFilterService();

export async function POST(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { testEmail } = body;

    if (!testEmail || !testEmail.from || !testEmail.subject) {
      return NextResponse.json({ 
        error: 'Missing required fields', 
        message: 'testEmail with from and subject are required' 
      }, { status: 400 });
    }

    logger.debug(`Filter test starting for user: ${session.userId}`);

    const userSettings = await prisma.userSettings.findUnique({
      where: { userId: session.userId }
    });

    const emailMessage: EmailMessage = {
      messageId: `test-${Date.now()}`,
      labelIds: testEmail.labelIds || [],
      from: testEmail.from,
      to: testEmail.to || [session.user.email],
      cc: testEmail.cc || [],
      subject: testEmail.subject,
      body: testEmail.body || 'Test email body'
    };

    const filterResult = await emailFilterService.shouldReplyToEmail(
      emailMessage,
      session.userId,
      session.user.email
    );

    const routerDecision = filterResult.shouldReply
      ? await new ReplyRouterAgent().evaluate({
          userId: session.userId,
          userEmail: session.user.email,
          message: emailMessage,
          filterResult,
          strict: false,
        })
      : null;

    const manualTests = {
      hardCodedFilters: await emailFilterService['applyHardCodedFilters'](emailMessage),
      recipientFilter: await emailFilterService['checkRecipientFilter'](emailMessage, session.user.email),
      blocklistCheck: userSettings ? await emailFilterService['checkBlocklist'](emailMessage.from, userSettings.blockedSenders) : null,
      allowlistCheck: userSettings ? await emailFilterService['checkAllowlist'](emailMessage.from, userSettings.allowedSenders) : null,
    };

    return NextResponse.json({
      success: true,
      testEmail: emailMessage,
      userEmail: session.user.email,
      userSettings: {
        replyScope: userSettings?.replyScope || 'ALL_SENDERS',
        blockedSenders: userSettings?.blockedSenders || [],
        allowedSenders: userSettings?.allowedSenders || [],
        preferencesSaved: userSettings?.preferencesSaved || false
      },
      filterResult: {
        shouldReply: filterResult.shouldReply,
        reason: filterResult.reason,  
        category: filterResult.category
      },
      router: {
        enabled: true, // Router is always enabled in the new reply system
        decision: routerDecision,
      },
      manualTests,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error in filter test endpoint:', error);
    return NextResponse.json({ 
      error: 'Failed to test email filter',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userSettings = await prisma.userSettings.findUnique({
      where: { userId: session.userId }
    });

    return NextResponse.json({
      success: true,
      currentSettings: {
        replyScope: userSettings?.replyScope || 'ALL_SENDERS',
        blockedSenders: userSettings?.blockedSenders || [],
        allowedSenders: userSettings?.allowedSenders || [],
        preferencesSaved: userSettings?.preferencesSaved || false
      },
      testInstructions: {
        method: 'POST',
        body: {
          testEmail: {
            from: 'test@example.com',
            subject: 'Test Subject',
            body: 'Test body (optional)',
            to: ['your-email@gmail.com'],
            labelIds: []
          }
        }
      }
    });

  } catch (error) {
    logger.error('Error getting current filter settings:', error);
    return NextResponse.json({ 
      error: 'Failed to get current settings',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 