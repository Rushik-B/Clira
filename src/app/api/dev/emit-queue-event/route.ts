import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/auth';
import { emitQueueEvent } from '@/lib/events/queueEvents';
import { devOnlyGuard } from '@/lib/utils/devOnly';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  const session = await getServerSession(authOptions);
  
  // For local testing, allow bypassing auth with a dev user ID
  const userId = session?.userId || 'dev-test-user';
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      type = 'start',
      emailId = 'dev-email-id',
      messageId = 'dev-message-id',
      subject = 'Dev Subject',
      from = 'sender@example.com',
      snippet = 'This is a dev snippet...',
      labelId,
    } = body || {};

    if (type === 'start') {
      emitQueueEvent({
        type: 'start',
        userId,
        emailId,
        messageId,
        subject,
        from,
        snippet,
        receivedAt: new Date().toISOString(),
        labelId,
      });
    } else if (type === 'ready') {
      emitQueueEvent({
        type: 'ready',
        userId,
        emailId,
        messageId,
        labelId,
      });
    } else if (type === 'fail') {
      emitQueueEvent({
        type: 'fail',
        userId,
        emailId,
        messageId,
        labelId,
        reason: 'Dev-triggered failure',
      });
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
