import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { coalesceApiRequest } from '@/lib/cache/requestCoalescing';
import {
  createGmailLabelForUser,
  GmailNotConnectedError,
} from '@/lib/services/labels/createGmailLabelForUser';
import { createGmailServiceForUser, OAuthTokenDecryptionError } from '@/lib/security/getUserGmailCredentials';
import { getUnifiedLabels } from '@/lib/services/unified/unifiedReads';

/**
 * GET /api/labels
 *
 * Returns all labels across ALL connected mailboxes.
 * Multi-inbox: Unified read aggregates from all mailboxes.
 * Each label includes mailboxId for client-side filtering.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Use request coalescing to prevent duplicate concurrent requests
    const result = await coalesceApiRequest(user.id, 'labels', async () => {
      return await getUnifiedLabels({
        userId: user.id,
        purpose: 'labels:fetch',
        requester: 'api.labels.GET',
        includeSystemLabels: true,
      });
    });

    return NextResponse.json({
      success: true,
      labels: result.labels,
      mailboxesProcessed: result.mailboxesProcessed,
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error fetching labels:', err.message, err.stack);
    if (error instanceof OAuthTokenDecryptionError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Gmail credentials could not be decrypted',
          code: 'oauth_token_decrypt_failed',
          message: error.message,
        },
        { status: 409 }
      );
    }
    if (error instanceof GmailNotConnectedError) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
    }

    return NextResponse.json({
      error: 'Failed to fetch labels'
    }, { status: 500 });
  }
}

/**
 * POST /api/labels
 *
 * Creates a new label in a SPECIFIC mailbox.
 * Multi-inbox: Writes require explicit mailboxId (falls back to primary for backward compat).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { name, color, mailboxId } = await request.json();

    if (!name || !color) {
      return NextResponse.json({ error: 'Name and color are required' }, { status: 400 });
    }

    // Resolve mailboxId: use provided value or fall back to primary mailbox
    let resolvedMailboxId = mailboxId;
    if (!resolvedMailboxId) {
      const primaryMailbox = await prisma.mailbox.findFirst({
        where: { userId: user.id, provider: 'google', status: 'CONNECTED' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      resolvedMailboxId = primaryMailbox?.id;
    }

    if (!resolvedMailboxId) {
      return NextResponse.json(
        { error: 'No connected mailbox found. Please connect a Gmail account.' },
        { status: 400 }
      );
    }

    // Validate user owns the mailbox
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: resolvedMailboxId, userId: user.id },
      select: { id: true, emailAddress: true },
    });

    if (!mailbox) {
      return NextResponse.json({ error: 'Mailbox not found or access denied' }, { status: 403 });
    }

    let gmailLabelId: string;
    let backgroundColor: string;
    let textColor: string;

    try {
      const gmailLabel = await createGmailLabelForUser({
        userId: user.id,
        mailboxId: resolvedMailboxId,
        name,
        color,
        purpose: 'labels:create',
        requester: 'api.labels.POST',
      });
      gmailLabelId = gmailLabel.gmailLabelId;
      backgroundColor = gmailLabel.backgroundColor;
      textColor = gmailLabel.textColor;
    } catch (error) {
      if (error instanceof GmailNotConnectedError) {
        return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
      }

      console.error('Error creating Gmail label:', error);
      const message = error instanceof Error ? error.message : 'Failed to create Gmail label';
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Create database record with mailbox scope
    const label = await prisma.label.create({
      data: {
        userId: user.id,
        mailboxId: resolvedMailboxId,
        name,
        color: backgroundColor,
        gmailLabelId,
        isCustom: true
      }
    });

    return NextResponse.json({
      success: true,
      label: {
        id: label.gmailLabelId, // Use Gmail ID to match GET response format
        name: label.name,
        color: backgroundColor,
        gmailLabelId: label.gmailLabelId,
        isCustom: label.isCustom,
        emailCount: 0,
        backgroundColor: backgroundColor,
        textColor: textColor,
        // Multi-inbox context
        mailboxId: resolvedMailboxId,
        mailboxEmail: mailbox.emailAddress,
      }
    });

  } catch (error) {
    console.error('Error creating label:', error);
    return NextResponse.json({
      error: 'Failed to create label'
    }, { status: 500 });
  }
}

/**
 * PUT /api/labels
 *
 * Updates a label. Label ID determines which mailbox the label belongs to.
 * Multi-inbox: Label is identified by its database ID which is already scoped to a mailbox.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { id, name, color } = await request.json();

    console.log('PUT request received:', { id, name, color });

    if (!id || !name || !color) {
      return NextResponse.json({ error: 'ID, name, and color are required' }, { status: 400 });
    }

    // Convert hex color to Gmail format
    const backgroundColor = color.startsWith('#') ? color : `#${color}`;
    const textColor = '#ffffff'; // Default white text for contrast

    // Get the label from database - try Gmail label ID first, then database ID
    let dbLabel = await prisma.label.findFirst({
      where: {
        gmailLabelId: id,
        userId: user.id
      },
      include: { mailbox: { select: { id: true, emailAddress: true } } }
    });

    if (!dbLabel) {
      // Fallback: check if we're receiving a database ID instead
      dbLabel = await prisma.label.findFirst({
        where: {
          id: id,
          userId: user.id
        },
        include: { mailbox: { select: { id: true, emailAddress: true } } }
      });
    }

    if (!dbLabel) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 });
    }

    // Get Gmail service for the specific mailbox this label belongs to
    const gmailResult = await createGmailServiceForUser({
      userId: user.id,
      mailboxId: dbLabel.mailboxId ?? undefined,
      purpose: 'labels:update',
      requester: 'api.labels.PUT',
    });

    if (!gmailResult) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
    }

    const gmailService = gmailResult.gmail;

    // Update Gmail label
    try {
      const gmailLabelId = dbLabel.gmailLabelId || id;
      console.log('Updating Gmail label with ID:', gmailLabelId, 'in mailbox:', dbLabel.mailbox?.emailAddress);
      await gmailService.updateLabel(gmailLabelId, {
        name,
        backgroundColor,
        textColor
      });
    } catch (error) {
      console.error('Error updating Gmail label:', error);
      // Continue with database update even if Gmail update fails
    }

    // Update database record
    const updatedLabel = await prisma.label.update({
      where: { id: dbLabel.id },
      data: {
        name,
        color,
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      label: {
        id: updatedLabel.gmailLabelId, // Use Gmail ID to match GET response
        name: updatedLabel.name,
        color: backgroundColor,
        gmailLabelId: updatedLabel.gmailLabelId,
        isCustom: updatedLabel.isCustom,
        emailCount: updatedLabel.emailCount,
        backgroundColor: backgroundColor,
        textColor: textColor,
        // Multi-inbox context
        mailboxId: dbLabel.mailboxId,
        mailboxEmail: dbLabel.mailbox?.emailAddress,
      }
    });

  } catch (error) {
    console.error('Error updating label:', error);
    return NextResponse.json({
      error: 'Failed to update label'
    }, { status: 500 });
  }
}

/**
 * DELETE /api/labels
 *
 * Deletes a label. Label ID determines which mailbox the label belongs to.
 * Multi-inbox: Uses the label's mailboxId to determine which Gmail account to update.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Label ID is required' }, { status: 400 });
    }

    // Get the label from database - try Gmail label ID first, then database ID
    let dbLabel = await prisma.label.findFirst({
      where: {
        gmailLabelId: id,
        userId: user.id
      }
    });

    if (!dbLabel) {
      // Fallback: check if we're receiving a database ID instead
      dbLabel = await prisma.label.findFirst({
        where: {
          id: id,
          userId: user.id
        }
      });
    }

    if (!dbLabel) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 });
    }

    // Get Gmail service for the specific mailbox this label belongs to
    const gmailResult = await createGmailServiceForUser({
      userId: user.id,
      mailboxId: dbLabel.mailboxId ?? undefined,
      purpose: 'labels:delete',
      requester: 'api.labels.DELETE',
    });

    if (!gmailResult) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
    }

    const gmailService = gmailResult.gmail;

    // Delete Gmail label if it has a Gmail ID
    if (dbLabel.gmailLabelId) {
      try {
        await gmailService.deleteLabel(dbLabel.gmailLabelId);
      } catch (error) {
        console.error('Error deleting Gmail label:', error);
        // Continue with database deletion even if Gmail deletion fails
      }
    }

    // Delete database record
    await prisma.label.delete({
      where: { id: dbLabel.id }
    });

    return NextResponse.json({
      success: true,
      message: 'Label deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting label:', error);
    return NextResponse.json({
      error: 'Failed to delete label'
    }, { status: 500 });
  }
} 
