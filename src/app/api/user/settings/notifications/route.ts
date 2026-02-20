import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

const bodySchema = z.object({
  enable: z.boolean(),
});

async function resolveSession() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    throw new Error('UNAUTHORIZED');
  }
  return session.userId as string;
}

export async function GET() {
  try {
    const userId = await resolveSession();
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { enablePushNotifications: true },
    });

    return NextResponse.json({
      success: true,
      enablePushNotifications: settings?.enablePushNotifications ?? true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[NOTIFICATION_SETTINGS_GET] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to load notification settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await resolveSession();
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
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[NOTIFICATION_SETTINGS_PATCH] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to update notification settings' }, { status: 500 });
  }
}
