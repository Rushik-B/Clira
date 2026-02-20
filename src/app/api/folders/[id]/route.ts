import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { createGmailServiceForUser } from '@/lib/security/getUserGmailCredentials';

interface UpdateFolderRequest {
  name?: string;
  color?: string;
  metaPrompt?: string; // Use metaPrompt for LLM classification consistency
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const folder = await prisma.label.findFirst({
      where: {
        id,
        userId: session.userId
      },
      include: {
        emailMappings: {
          where: { isActive: true },
          select: {
            id: true,
            emailAddress: true,
            domain: true,
            mappingType: true,
            createdAt: true
          }
        },
        _count: {
          select: {
            emailSorts: true
          }
        }
      }
    });

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      folder: {
        id: folder.id,
        name: folder.name,
        color: folder.color,
        metaPrompt: folder.metaPrompt,
        isSystemDefault: folder.isSystemDefault,
        isCustom: folder.isCustom,
        emailCount: folder.emailCount,
        gmailLabelId: folder.gmailLabelId,
        emailMappings: folder.emailMappings,
        totalSorts: folder._count.emailSorts,
        lastBatchSort: folder.lastBatchSort,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt
      }
    });

  } catch (error) {
    console.error('Error fetching folder:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch folder' 
    }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: folderId } = await params;
    const body: UpdateFolderRequest = await request.json();

    console.log(`📝 Updating folder ${folderId} for user ${session.userId}:`, body);

    // Validate the folder exists and user owns it
    const existingFolder = await prisma.label.findFirst({
      where: {
        id: folderId,
        userId: session.userId
      }
    });

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found or access denied' }, { status: 404 });
    }

    // Check if this is a system folder with restrictions
    if (existingFolder.isSystemDefault) {
      // System folders can only have metaPrompt and color updated
      if (body.name && body.name !== existingFolder.name) {
        return NextResponse.json({ 
          error: 'Cannot rename system folders' 
        }, { status: 400 });
      }
    }

    // Validate inputs
    const updates: any = {};
    
    if (body.name !== undefined) {
      if (!body.name.trim()) {
        return NextResponse.json({ error: 'Folder name cannot be empty' }, { status: 400 });
      }
      
      // Check for duplicate names
      const duplicateFolder = await prisma.label.findFirst({
        where: {
          userId: session.userId,
          name: body.name.trim(),
          id: { not: folderId }
        }
      });
      
      if (duplicateFolder) {
        return NextResponse.json({ error: 'A folder with this name already exists' }, { status: 400 });
      }
      
      updates.name = body.name.trim();
    }

    if (body.color !== undefined) {
      // Validate color format (hex color)
      if (!/^#[0-9A-F]{6}$/i.test(body.color)) {
        return NextResponse.json({ error: 'Invalid color format. Use hex format like #FF5733' }, { status: 400 });
      }
      updates.color = body.color;
    }

    if (body.metaPrompt !== undefined) {
      if (body.metaPrompt.length > 2000) {
        return NextResponse.json({ error: 'Folder prompt too long (max 2000 characters)' }, { status: 400 });
      }
      updates.metaPrompt = body.metaPrompt.trim();
    }

    // Check if there are running batch jobs
    const runningJob = await prisma.batchSortJob.findFirst({
      where: {
        userId: session.userId,
        status: 'running'
      }
    });

    if (runningJob && (body.metaPrompt !== undefined || body.name !== undefined)) {
      console.warn(`⚠️ User ${session.userId} trying to update folder while batch job ${runningJob.id} is running`);
      return NextResponse.json({ 
        error: 'Cannot modify folder properties while email processing is in progress. Please try again in a few minutes.',
        runningJobId: runningJob.id
      }, { status: 409 });
    }

    // Update Gmail label if name changed and folder has a Gmail label
    if (updates.name && existingFolder.gmailLabelId) {
      try {
        const gmailResult = await createGmailServiceForUser({
          userId: session.userId,
          purpose: 'folders:update-label',
          requester: 'api.folders.[id].PUT',
        });

        if (gmailResult) {
          await gmailResult.gmail.updateLabel(existingFolder.gmailLabelId, {
            name: updates.name
          });
          
          console.log(`📧 Updated Gmail label ${existingFolder.gmailLabelId} name to "${updates.name}"`);
        }
      } catch (gmailError) {
        console.error('Error updating Gmail label:', gmailError);
        // Continue with database update even if Gmail update fails
        // The user will see the change in our system, and Gmail sync can be retried later
      }
    }

    // Update the folder in database
    const updatedFolder = await prisma.label.update({
      where: { id: folderId },
      data: {
        ...updates,
        updatedAt: new Date()
      },
      include: {
        emailMappings: {
          where: { isActive: true },
          select: {
            id: true,
            emailAddress: true,
            domain: true,
            mappingType: true,
            createdAt: true
          }
        },
        _count: {
          select: {
            emailSorts: true
          }
        }
      }
    });

    console.log(`✅ Successfully updated folder ${folderId}: ${Object.keys(updates).join(', ')}`);

    return NextResponse.json({
      success: true,
      message: 'Folder updated successfully',
      folder: {
        id: updatedFolder.id,
        name: updatedFolder.name,
        color: updatedFolder.color,
        metaPrompt: updatedFolder.metaPrompt,
        isSystemDefault: updatedFolder.isSystemDefault,
        isCustom: updatedFolder.isCustom,
        emailCount: updatedFolder.emailCount,
        gmailLabelId: updatedFolder.gmailLabelId,
        emailMappings: updatedFolder.emailMappings,
        totalSorts: updatedFolder._count.emailSorts,
        lastBatchSort: updatedFolder.lastBatchSort,
        createdAt: updatedFolder.createdAt,
        updatedAt: updatedFolder.updatedAt
      }
    });

  } catch (error) {
    console.error('Error updating folder:', error);
    return NextResponse.json({ 
      error: 'Failed to update folder' 
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: folderId } = await params;

    console.log(`🗑️ Deleting folder ${folderId} for user ${session.userId}`);

    // Validate the folder exists and user owns it
    const existingFolder = await prisma.label.findFirst({
      where: {
        id: folderId,
        userId: session.userId
      }
    });

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found or access denied' }, { status: 404 });
    }

    // Prevent deletion of system folders
    if (existingFolder.isSystemDefault) {
      return NextResponse.json({ 
        error: 'Cannot delete system folders' 
      }, { status: 400 });
    }

    // Check if there are running batch jobs
    const runningJob = await prisma.batchSortJob.findFirst({
      where: {
        userId: session.userId,
        status: 'running'
      }
    });

    if (runningJob) {
      return NextResponse.json({ 
        error: 'Cannot delete folder while email processing is in progress. Please try again in a few minutes.',
        runningJobId: runningJob.id
      }, { status: 409 });
    }

    const gmailLabelId = existingFolder.gmailLabelId;

    if (gmailLabelId) {
      const gmailResult = await createGmailServiceForUser({
        userId: session.userId,
        purpose: 'folders:delete-label',
        requester: 'api.folders.[id].DELETE',
        includeRefreshToken: true,
      });

      if (!gmailResult) {
        return NextResponse.json(
          {
            success: false,
            error: 'Gmail not connected',
            message: 'Reconnect Gmail to delete this folder and its Gmail label.',
          },
          { status: 400 }
        );
      }

      try {
        await gmailResult.gmail.deleteLabel(gmailLabelId);
        console.log(`📧 Deleted Gmail label ${gmailLabelId}`);
      } catch (gmailError: any) {
        const status = gmailError?.status ?? gmailError?.code ?? gmailError?.response?.status;
        if (status === 404) {
          console.warn(
            `[FOLDERS API] Gmail label ${gmailLabelId} already removed upstream. Continuing with folder deletion.`
          );
        } else {
          console.error('[FOLDERS API] Gmail label deletion failed:', gmailError);
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to delete Gmail label',
              message: 'Gmail rejected label deletion. Please reconnect Gmail and try again.',
            },
            { status: 502 }
          );
        }
      }
    }

    await prisma.label.delete({
      where: { id: folderId }
    });

    console.log(`✅ Successfully deleted folder ${folderId}`);

    return NextResponse.json({
      success: true,
      message: `Folder "${existingFolder.name}" deleted successfully.`
    });

  } catch (error) {
    console.error('Error deleting folder:', error);
    return NextResponse.json({ 
      error: 'Failed to delete folder' 
    }, { status: 500 });
  }
}
