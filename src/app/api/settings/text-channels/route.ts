import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { logger } from '@/lib/logger';
import { getTextChannelsSettingsSnapshot } from '@/lib/services/textChannelsSettings';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
} as const;

/**
 * GET /api/settings/text-channels
 * Consolidated read endpoint for Text Clira settings:
 * - SMS/Twilio settings
 * - WhatsApp settings
 * - Telegram integration state
 * - Reminder/alert delivery channel preference
 */
export async function GET() {
  let sessionUserId: string | null = null;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    sessionUserId = session.userId;
    const settings = await getTextChannelsSettingsSnapshot(sessionUserId);

    return NextResponse.json(
      {
        success: true,
        settings,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    logger.error('[TextChannelSettings] Error fetching settings', {
      userId: sessionUserId,
      hasSessionUserId: Boolean(sessionUserId),
      error,
    });
    return NextResponse.json(
      { error: 'Failed to fetch text channel settings' },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
