import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import type { NotificationDeliveryChannel } from '@prisma/client';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

const deliveryChannelSchema = z.object({
  notificationDeliveryChannel: z.enum(['WHATSAPP', 'TELEGRAM', 'BOTH']),
});

type DeliveryChannel = NotificationDeliveryChannel;

async function resolveSessionUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    throw new Error('UNAUTHORIZED');
  }
  return session.userId;
}

/**
 * GET /api/settings/messaging-channels
 * Returns the user's preferred messaging delivery channel for reminders/alerts.
 */
export async function GET() {
  try {
    const userId = await resolveSessionUserId();
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { notificationDeliveryChannel: true },
    });

    return NextResponse.json({
      success: true,
      settings: {
        notificationDeliveryChannel:
          settings?.notificationDeliveryChannel ?? 'BOTH',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error('[MessagingChannelSettings] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messaging channel settings' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/settings/messaging-channels
 * Updates the user's preferred messaging delivery channel for reminders/alerts.
 */
export async function PATCH(request: NextRequest) {
  try {
    const userId = await resolveSessionUserId();
    const body = deliveryChannelSchema.parse(await request.json());

    const updated = await prisma.userSettings.upsert({
      where: { userId },
      update: {
        notificationDeliveryChannel: body.notificationDeliveryChannel,
      },
      create: {
        userId,
        notificationDeliveryChannel: body.notificationDeliveryChannel,
      },
      select: {
        notificationDeliveryChannel: true,
      },
    });

    return NextResponse.json({
      success: true,
      settings: {
        notificationDeliveryChannel:
          updated.notificationDeliveryChannel as DeliveryChannel,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid notificationDeliveryChannel' },
        { status: 400 },
      );
    }

    console.error('[MessagingChannelSettings] Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update messaging channel settings' },
      { status: 500 },
    );
  }
}
