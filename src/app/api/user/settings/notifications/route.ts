import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { isUnauthorizedError, requireUserId, unauthorizedResponse } from '../shared';

const bodySchema = z.object({
  enable: z.boolean(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { enablePushNotifications: true },
    });

    return NextResponse.json({
      success: true,
      enablePushNotifications: settings?.enablePushNotifications ?? true,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }
    console.error('[NOTIFICATION_SETTINGS_GET] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to load notification settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const { enable } = bodySchema.parse(await request.json());

    await prisma.userSettings.upsert({
      where: { userId },
      update: { enablePushNotifications: enable },
      create: {
        userId,
        autonomyLevel: 0,
        replyScope: 'ALL_SENDERS',
        enablePushNotifications: enable,
        preferencesSaved: true,
        autoFileLowPriority: 0,
        autoSendConfidence: 100,
      },
    });

    return NextResponse.json({ success: true, enablePushNotifications: enable });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }
    console.error('[NOTIFICATION_SETTINGS_PATCH] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to update notification settings' }, { status: 500 });
  }
}
