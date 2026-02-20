import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time';
import { emailQueue } from '@/lib/services/utils/queues';
import { enqueueSupermemoryBootstrap } from '@/lib/services/supermemory/queueHelpers';
import { logger } from '@/lib/logger';

const folderSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(64),
  originalName: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(160),
  metaPrompt: z.string().min(1).max(800),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  colorName: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']).optional(),
  icon: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  reasoning: z.string().optional(),
  expectedWeeklyVolume: z.number().int().min(0).optional(),
  overlapsWithExisting: z.array(z.string().min(1)).optional(),
  stability: z.enum(['stable', 'emerging', 'new']).optional(),
  stabilityReason: z.string().optional(),
  guidance: z.string().optional(),
});

const requestSchema = z.object({
  acceptedFolders: z.array(folderSchema).default([]),
  autoSortingEnabled: z.boolean().default(false),
  skip: z.boolean().default(false),
});

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId as string;

    const body = requestSchema.parse(await request.json());
    const acceptedFolders = body.acceptedFolders.filter((folder, index, all) => {
      const normalized = folder.name.trim().toLowerCase();
      return all.findIndex(candidate => candidate.name.trim().toLowerCase() === normalized) === index;
    });

    const shouldSkip = body.skip || acceptedFolders.length === 0;

    const upsertUserSettings = async () => {
      await prisma.userSettings.upsert({
        where: { userId },
        update: {
          autoSortingEnabled: body.autoSortingEnabled,
          newOnboardingCompleted: true,
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
          newOnboardingCompleted: true,
          // Calendar preferences default to PST until user updates in settings
          calendarTimezone: DEFAULT_CALENDAR_TIMEZONE,
          calendarContextCalendarIds: [],
        },
      });
    };

    if (shouldSkip) {
      // Mark labeling onboarding complete so user won't be sent back into flow
      await prisma.user.update({
        where: { id: userId },
        data: {
          labelingOnboardingGenerated: true,
          labelingOnboardingQualityGenerated: true,
        },
      });
      await upsertUserSettings();
      return NextResponse.json({
        success: true,
        skipped: true,
        autoSortingEnabled: body.autoSortingEnabled,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const savedLabels = [] as Array<{ id: string; name: string; metaPrompt?: string; color?: string; description: string }>; 

    for (const folder of acceptedFolders) {
      const normalizedName = folder.name.trim();
      const existing = await prisma.label.findFirst({
        where: {
          userId: user.id,
          name: { equals: normalizedName, mode: 'insensitive' },
        },
      });

      if (existing) {
        const updated = await prisma.label.update({
          where: { id: existing.id },
          data: {
            name: normalizedName,
            metaPrompt: folder.metaPrompt,
            color: folder.color,
            isCustom: true,
            isSystemDefault: false,
          },
        });
        savedLabels.push({
          id: updated.id,
          name: updated.name,
          metaPrompt: updated.metaPrompt ?? undefined,
          color: updated.color ?? undefined,
          description: folder.description,
        });
        continue;
      }

      const created = await prisma.label.create({
        data: {
          userId: user.id,
          name: normalizedName,
          metaPrompt: folder.metaPrompt,
          color: folder.color,
          isCustom: true,
          isSystemDefault: false,
          isSystemLabel: false,
          emailCount: 0,
        },
      });

      savedLabels.push({
        id: created.id,
        name: created.name,
        metaPrompt: created.metaPrompt ?? undefined,
        color: created.color ?? undefined,
        description: folder.description,
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        labelingOnboardingGenerated: true,
        labelingOnboardingQualityGenerated: true,
      },
    });

    await upsertUserSettings();

    // Enqueue Supermemory bootstrap job to build user memory graph from historical emails
    if (savedLabels.length > 0 && !shouldSkip) {
      try {
        const supermemoryJobId = await enqueueSupermemoryBootstrap(userId, {
          delayMs: 90_000, // 90s delay to prevent Gmail API throttling
        });

        if (supermemoryJobId) {
          logger.info(
            `[FAST ONBOARDING] Enqueued Supermemory bootstrap: ${supermemoryJobId} ` +
            `for user ${userId} (starts in 90s)`
          );
        } else {
          logger.warn(
            `[FAST ONBOARDING] Supermemory bootstrap NOT enqueued for user ${userId}. ` +
            `Reason: SUPERMEMORY_API_KEY not configured (and the worker process must be running to process jobs).`,
          );
        }
      } catch (error) {
        // Don't fail onboarding if Supermemory enqueue fails
        logger.warn(
          `[FAST ONBOARDING] Failed to enqueue Supermemory bootstrap for user ${userId}:`,
          error
        );
      }
    }

    if (savedLabels.length > 0) {
      const jobId = `fast-onboarding-mapping:${user.id}`;
      await emailQueue.add(
        'fast-onboarding-mapping',
        {
          userId: user.id,
          folders: savedLabels.map((label) => ({
            id: label.id,
            name: label.name,
            metaPrompt: label.metaPrompt,
            color: label.color,
            description: label.description,
          })),
        },
        { jobId, removeOnComplete: 20, removeOnFail: 10 }
      );
    }

    return NextResponse.json({
      success: true,
      accepted: savedLabels.length,
      autoSortingEnabled: body.autoSortingEnabled,
    });
  } catch (error) {
    console.error('[FAST ONBOARDING] Failed to accept folders:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to save folders',
    }, { status: 500 });
  }
}
