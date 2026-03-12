import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { isUnauthorizedError, requireUserId, unauthorizedResponse } from '../shared';

const bodySchema = z.object({
  autoSortingEnabled: z.boolean(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { autoSortingEnabled: true },
    });

    return NextResponse.json({
      success: true,
      autoSortingEnabled: settings?.autoSortingEnabled ?? false,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }
    console.error('[AUTO SORTING] Failed to load setting:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to load automatic sorting preference',
    }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = bodySchema.parse(await request.json());

    await prisma.userSettings.upsert({
      where: { userId },
      update: {
        autoSortingEnabled: body.autoSortingEnabled,
      },
      create: {
        userId,
        autonomyLevel: 0,
        replyScope: 'ALL_SENDERS',
        enablePushNotifications: true,
        preferencesSaved: true,
        autoFileLowPriority: 50,
        autoSendConfidence: 95,
        autoSortingEnabled: body.autoSortingEnabled,
        newOnboardingCompleted: false,
      },
    });

    return NextResponse.json({
      success: true,
      autoSortingEnabled: body.autoSortingEnabled,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }
    console.error('[AUTO SORTING] Failed to update setting:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update automatic sorting preference',
    }, { status: 500 });
  }
}
