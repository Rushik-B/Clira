import { NextRequest, NextResponse } from 'next/server';
import { GmailPushService, type PushNotificationPayload } from '@/lib/email/gmailPushService';
import { decodeGmailPubSubPayload, isNonRetryablePayloadError } from '@/lib/email/gmailPubSubPayload';
import { getGmailIngestionMode } from '@/lib/email/gmailIngestionConfig';

export async function POST(request: NextRequest) {
  const mode = getGmailIngestionMode();
  if (mode !== 'push') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    console.log('📧 Received Gmail push notification webhook');

    const body = await request.json();
    
    // Extract Pub/Sub message
    const pubsubMessage = body.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      console.log('⚠️ No message data in webhook payload');
      return NextResponse.json({ success: true }); // Acknowledge anyway
    }

    let payload: PushNotificationPayload;
    try {
      payload = decodeGmailPubSubPayload(pubsubMessage.data);
    } catch (error) {
      if (isNonRetryablePayloadError(error)) {
        console.warn('⚠️ Non-retryable Gmail Pub/Sub payload error:', error.message);
      } else {
        console.error('❌ Unexpected Gmail Pub/Sub payload error:', error);
      }
      return NextResponse.json({ success: true });
    }

    // Process the notification asynchronously; acknowledge immediately to avoid timeouts.
    // Note: We create a service instance without credentials since we'll fetch them from the database
    const pushService = new GmailPushService();
    pushService
      .processPushNotification(payload)
      .then(() => console.log(`✅ Processed Gmail push notification for ${payload.emailAddress}`))
      .catch((err) => console.error('❌ Error processing Gmail push notification (deferred):', err));

    // Immediate 200 to prevent Heroku H12 and Pub/Sub retries
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('❌ Error processing Gmail push notification:', error);
    
    // Always acknowledge the webhook to prevent retries
    return NextResponse.json({ 
      success: true,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 
