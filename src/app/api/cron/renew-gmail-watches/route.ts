import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GmailPushService } from '@/lib/email/gmailPushService';
import { getGmailPubSubTopic } from '@/lib/email/gmailIngestionConfig';

export async function GET(request: NextRequest) {
  // Security: Only allow requests with the correct cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('❌ Unauthorized cron request');
    return new Response('Unauthorized', { status: 401 });
  }

  console.log('🔄 Starting Gmail watch renewal for all mailboxes...');

  try {
    const topicName = getGmailPubSubTopic();
    const mailboxes = await prisma.mailbox.findMany({
      where: {
        provider: 'google',
        status: 'CONNECTED',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    console.log(`📧 Found ${mailboxes.length} connected Gmail mailboxes`);

    const results = [];
    let successful = 0;
    let failed = 0;

    // Renew Gmail watch for each mailbox
    for (const mailbox of mailboxes) {
      try {
        console.log(`🔄 Renewing Gmail watch for mailbox: ${mailbox.id} (user ${mailbox.userId})`);

        const pushService = new GmailPushService(mailbox.userId);

        const result = await pushService.setupPushNotifications({
          userId: mailbox.userId,
          mailboxId: mailbox.id,
          topicName,
        });

        if (!result) {
          console.log(`⚠️ Skipping mailbox ${mailbox.id} - Gmail credentials unavailable`);
          results.push({
            mailboxId: mailbox.id,
            userId: mailbox.userId,
            email: mailbox.user?.email ?? null,
            success: false,
            error: 'Gmail credentials unavailable',
          });
          failed++;
          continue;
        }
        
        console.log(`✅ Renewed Gmail watch for mailbox ${mailbox.id} - historyId: ${result.historyId}, expiration: ${result.expiration}`);
        
        results.push({
          mailboxId: mailbox.id,
          userId: mailbox.userId,
          email: mailbox.user?.email ?? null,
          success: true,
          historyId: result.historyId,
          expiration: result.expiration
        });
        
        successful++;
        
        // Add small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Failed to renew Gmail watch for mailbox ${mailbox.id}:`, error);
        
        results.push({
          mailboxId: mailbox.id,
          userId: mailbox.userId,
          email: mailbox.user?.email ?? null,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        failed++;
      }
    }

    const summary = {
      total: mailboxes.length,
      successful,
      failed,
      timestamp: new Date().toISOString()
    };

    console.log(`🏁 Gmail watch renewal completed:`, summary);

    return NextResponse.json({
      success: true,
      message: 'Gmail watch renewal completed',
      summary,
      results
    });

  } catch (error) {
    console.error('❌ Error during Gmail watch renewal:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
