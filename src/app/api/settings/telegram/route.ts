import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import {
  getPairingManager,
  PairingCodeError,
  isTelegramConfigured,
  isTelegramEnabled,
  getTelegramClient,
} from '@/lib/services/telegram';

/**
 * GET /api/settings/telegram
 * Returns Telegram integration status and active links for the authenticated user.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pairingManager = getPairingManager();
    const links = await pairingManager.getActiveLinksForUser(session.userId);

    let botUsername: string | null = null;
    if (isTelegramConfigured()) {
      const identity = await getTelegramClient().getBotIdentity();
      botUsername = identity?.username ?? null;
    }

    return NextResponse.json({
      success: true,
      settings: {
        telegramConfigured: isTelegramConfigured(),
        telegramEnabled: isTelegramEnabled(),
        botUsername,
        links,
      },
    });
  } catch (error) {
    console.error('[Telegram Settings] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Telegram settings' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/settings/telegram
 * Approves a Telegram pairing request by code and links it to the authenticated user.
 *
 * Body:
 * {
 *   pairingCode: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const pairingCode = typeof body?.pairingCode === 'string' ? body.pairingCode : '';

    if (!pairingCode.trim()) {
      return NextResponse.json(
        { error: 'Pairing code is required' },
        { status: 400 },
      );
    }

    const pairingManager = getPairingManager();
    const link = await pairingManager.approvePairingCode(session.userId, pairingCode);

    return NextResponse.json({
      success: true,
      message: 'Telegram account linked successfully',
      link: {
        id: link.id,
        telegramUserId: link.telegramUserId,
        chatId: link.chatId,
        telegramUsername: link.telegramUsername,
        telegramFirstName: link.telegramFirstName,
        linkedAt: link.linkedAt,
        lastSeenAt: link.lastSeenAt,
      },
    });
  } catch (error) {
    if (error instanceof PairingCodeError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }

    console.error('[Telegram Settings] Error approving pairing code:', error);
    return NextResponse.json(
      { error: 'Failed to approve pairing code' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/settings/telegram
 * Unlinks an active Telegram account for the authenticated user.
 *
 * Body (optional):
 * {
 *   linkId?: string
 * }
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const explicitLinkId = typeof body?.linkId === 'string' ? body.linkId : null;

    const pairingManager = getPairingManager();
    const linkToDeactivate = explicitLinkId
      ? { id: explicitLinkId }
      : await pairingManager.getMostRecentActiveLinkForUser(session.userId);

    if (!linkToDeactivate?.id) {
      return NextResponse.json(
        { error: 'No active Telegram link found' },
        { status: 404 },
      );
    }

    await pairingManager.deactivateLink(session.userId, linkToDeactivate.id);

    return NextResponse.json({
      success: true,
      message: 'Telegram link removed',
    });
  } catch (error) {
    console.error('[Telegram Settings] Error unlinking Telegram account:', error);
    return NextResponse.json(
      { error: 'Failed to unlink Telegram account' },
      { status: 500 },
    );
  }
}
