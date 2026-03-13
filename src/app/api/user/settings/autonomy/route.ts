import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { isUnauthorizedError, requireUserId, unauthorizedResponse } from '../shared';

const levelSchema = z.object({
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

const AUTONOMY_MAP: Record<0 | 1 | 2, { autonomyLevel: number; autoSendConfidence: number; autoFileLowPriority: number }> = {
  0: { autonomyLevel: 0, autoSendConfidence: 100, autoFileLowPriority: 0 },
  1: { autonomyLevel: 1, autoSendConfidence: 100, autoFileLowPriority: 50 },
  2: { autonomyLevel: 2, autoSendConfidence: 95, autoFileLowPriority: 50 },
};

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        autonomyLevel: true,
        autoSendConfidence: true,
        autoFileLowPriority: true,
      },
    });

    return NextResponse.json({
      success: true,
      level: (settings?.autonomyLevel ?? 0) as 0 | 1 | 2,
      autoSendConfidence: settings?.autoSendConfidence ?? 100,
      autoFileLowPriority: settings?.autoFileLowPriority ?? 0,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }
    console.error('[AUTONOMY_SETTINGS_GET] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to load autonomy settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = levelSchema.parse(await request.json());
    const nextValues = AUTONOMY_MAP[body.level];

    await prisma.userSettings.upsert({
      where: { userId },
      update: nextValues,
      create: {
        userId,
        autonomyLevel: nextValues.autonomyLevel,
        autoSendConfidence: nextValues.autoSendConfidence,
        autoFileLowPriority: nextValues.autoFileLowPriority,
        replyScope: 'ALL_SENDERS',
        enablePushNotifications: true,
        preferencesSaved: true,
      },
    });

    return NextResponse.json({ success: true, level: body.level, ...nextValues });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }
    console.error('[AUTONOMY_SETTINGS_PATCH] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to update autonomy level' }, { status: 500 });
  }
}
