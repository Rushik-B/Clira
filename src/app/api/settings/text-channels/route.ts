import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { getTextChannelsSettingsSnapshot } from '@/lib/services/textChannelsSettings';

/**
 * GET /api/settings/text-channels
 * Consolidated read endpoint for Text Clira settings:
 * - SMS/Twilio settings
 * - WhatsApp settings
 * - Telegram integration state
 * - Reminder/alert delivery channel preference
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await getTextChannelsSettingsSnapshot(session.userId);

    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error('[TextChannelSettings] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch text channel settings' },
      { status: 500 },
    );
  }
}
