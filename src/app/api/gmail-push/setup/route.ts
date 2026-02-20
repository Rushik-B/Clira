import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { GmailPushService } from '@/lib/email/gmailPushService';
import { getMailboxById, getPrimaryMailbox } from '@/lib/services/mailbox/getPrimaryMailbox';

export async function POST(request: Request) {
  try {
    console.log('📧 Setting up Gmail push notifications...');

    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as { mailboxId?: string }));
    const mailbox = body.mailboxId
      ? await getMailboxById(session.userId, body.mailboxId)
      : await getPrimaryMailbox({ userId: session.userId });

    if (!mailbox) {
      return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
    }

    // Create Gmail push service
    const pushService = new GmailPushService(session.userId);

    // Setup push notifications with the Cloud Pub/Sub topic
    const topicName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/clira-email-updates`;
    
    const result = await pushService.setupPushNotifications({
      userId: session.userId,
      mailboxId: mailbox.id,
      topicName,
    });

    if (!result) {
      return NextResponse.json({
        error: 'No Gmail access token found. Please reconnect your Google account.',
      }, { status: 400 });
    }

    console.log(`✅ Gmail push notifications setup for user ${session.userId}, mailbox ${mailbox.id}`);

    return NextResponse.json({
      success: true,
      message: 'Gmail push notifications setup successfully',
      historyId: result.historyId,
      expiration: result.expiration
    });

  } catch (error) {
    console.error('❌ Error setting up Gmail push notifications:', error);
    return NextResponse.json({ 
      error: 'Failed to setup Gmail push notifications',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
