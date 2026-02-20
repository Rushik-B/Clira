import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

const bodySchema = z.object({
  autoSortingEnabled: z.boolean(),
});

async function resolveSession() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    throw new Error('UNAUTHORIZED');
  }
  return session;
}

export async function GET() {
  try {
    const session = await resolveSession();
    const userId = session.userId as string;
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { autoSortingEnabled: true },
    });

    return NextResponse.json({
      success: true,
      autoSortingEnabled: settings?.autoSortingEnabled ?? false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const session = await resolveSession();
    const userId = session.userId as string;
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
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[AUTO SORTING] Failed to update setting:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update automatic sorting preference',
    }, { status: 500 });
  }
}
