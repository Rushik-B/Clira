import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { createMailboxConnectAuthUrl } from '@/lib/services/mailbox/mailboxConnectFlow';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const provider = request.nextUrl.searchParams.get('provider') ?? 'google';
    if (provider !== 'google') {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error('NEXTAUTH_SECRET is not configured');
    }

    const authUrl = createMailboxConnectAuthUrl({
      request,
      userId: session.userId,
      provider,
      secret,
    });

    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[MAILBOX_CONNECT_START] Failed to start OAuth flow:', error);
    return NextResponse.json({ error: 'Failed to start mailbox connection' }, { status: 500 });
  }
}
