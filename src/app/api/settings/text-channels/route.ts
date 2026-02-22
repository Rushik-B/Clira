import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import {
  getPairingManager,
  getTelegramClient,
  getTelegramHealthSnapshot,
  isTelegramConfigured,
  isTelegramEnabled,
} from '@/lib/services/telegram';

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

    const [settings, links, telegramHealth] = await Promise.all([
      prisma.userSettings.findUnique({
        where: { userId: session.userId },
        select: {
          whatsappPhoneNumber: true,
          whatsappVerified: true,
          twilioPhoneNumber: true,
          twilioVerified: true,
          notificationDeliveryChannel: true,
        },
      }),
      getPairingManager().getActiveLinksForUser(session.userId),
      getTelegramHealthSnapshot(),
    ]);

    let botUsername: string | null = null;
    if (isTelegramConfigured()) {
      const identity = await getTelegramClient().getBotIdentity();
      botUsername = identity?.username ?? null;
    }

    return NextResponse.json({
      success: true,
      settings: {
        whatsappPhoneNumber: settings?.whatsappPhoneNumber ?? null,
        whatsappVerified: settings?.whatsappVerified ?? false,
        twilioPhoneNumber: settings?.twilioPhoneNumber ?? null,
        twilioVerified: settings?.twilioVerified ?? false,
        notificationDeliveryChannel:
          settings?.notificationDeliveryChannel ?? 'BOTH',
        telegramConfigured: isTelegramConfigured(),
        telegramEnabled: isTelegramEnabled(),
        botUsername,
        links,
        telegramHealth,
      },
    });
  } catch (error) {
    console.error('[TextChannelSettings] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch text channel settings' },
      { status: 500 },
    );
  }
}
