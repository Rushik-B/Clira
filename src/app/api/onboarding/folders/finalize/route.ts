import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

interface FolderFinalizeRequest {
  folders: Array<{
    name: string;
    description: string;
    icon: string;
    color: string;
  }>;
}

/**
 * POST /api/onboarding/folders/finalize
 * Writes the final folder set that the onboarding wizard approved and makes sure
 * duplicates are skipped rather than re-created.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body: FolderFinalizeRequest = await request.json();
    const { folders } = body;

    if (!folders || !Array.isArray(folders) || folders.length === 0) {
      return NextResponse.json({ error: 'Folders array is required.' }, { status: 400 });
    }

    // Check if labels already exist for this user to prevent duplicates
    const existingLabels = await prisma.label.findMany({
      where: { userId: user.id },
      select: { name: true }
    });

    const existingLabelNames = new Set(existingLabels.map(l => l.name));
    const newFolders = folders.filter(folder => !existingLabelNames.has(folder.name));

    if (newFolders.length === 0) {
      console.log(`[ONBOARDING FINALIZE] No new folders to create for user ${user.email} (all already exist)`);
      return NextResponse.json({ 
        success: true,
        message: 'Folders already exist', 
        count: 0,
        existingCount: existingLabels.length 
      });
    }

    // Use a transaction to ensure all folders are created or none are.
    const createdFolders = await prisma.$transaction(
      newFolders.map((folder) =>
        prisma.label.create({
          data: {
            userId: user.id,
            name: folder.name,
            // Store the LLM-provided metaPrompt, not the human description
            metaPrompt: (folder as any).metaPrompt ?? folder.description,
            color: folder.color,
            isCustom: true,
            isSystemDefault: false, // All user-created folders are not system defaults
            emailCount: 0,
          },
        })
      )
    );

    console.log(`[ONBOARDING FINALIZE] Saved ${createdFolders.length} folders for user ${user.email}`);

    return NextResponse.json({
      success: true,
      count: createdFolders.length,
    });

  } catch (error) {
    console.error('[ONBOARDING FINALIZE] Error saving folders:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save folders',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
