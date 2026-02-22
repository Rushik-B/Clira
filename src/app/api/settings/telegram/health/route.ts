import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { getTelegramHealthSnapshot } from '@/lib/services/telegram';

/**
 * GET /api/settings/telegram/health
 * Returns Telegram worker/poller health for the authenticated user.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const health = await getTelegramHealthSnapshot();

    return NextResponse.json({
      success: true,
      health,
    });
  } catch (error) {
    console.error('[Telegram Health] Error fetching health:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Telegram health' },
      { status: 500 },
    );
  }
}
