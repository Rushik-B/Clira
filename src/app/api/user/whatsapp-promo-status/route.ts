import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

const bodySchema = z.object({
  seen: z.boolean(),
});

async function resolveSession() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    throw new Error('UNAUTHORIZED');
  }
  return session;
}

/**
 * GET /api/user/whatsapp-promo-status
 * Returns whether the user has seen the WhatsApp promotional card
 */
export async function GET() {
  try {
    const session = await resolveSession();
    const userId = session.userId as string;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { whatsappPromoSeen: true },
    });

    return NextResponse.json({
      success: true,
      hasSeen: settings?.whatsappPromoSeen ?? false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[WHATSAPP PROMO] Failed to load status:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to load WhatsApp promo status',
    }, { status: 500 });
  }
}

/**
 * POST /api/user/whatsapp-promo-status
 * Marks the WhatsApp promotional card as seen
 */
export async function POST(request: NextRequest) {
  try {
    const session = await resolveSession();
    const userId = session.userId as string;
    const body = bodySchema.parse(await request.json());

    await prisma.userSettings.upsert({
      where: { userId },
      update: {
        whatsappPromoSeen: body.seen,
      },
      create: {
        userId,
        autonomyLevel: 0,
        replyScope: 'ALL_SENDERS',
        enablePushNotifications: true,
        preferencesSaved: true,
        autoFileLowPriority: 50,
        autoSendConfidence: 95,
        autoSortingEnabled: false,
        newOnboardingCompleted: false,
        whatsappPromoSeen: body.seen,
      },
    });

    return NextResponse.json({
      success: true,
      hasSeen: body.seen,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[WHATSAPP PROMO] Failed to update status:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update WhatsApp promo status',
    }, { status: 500 });
  }
}
