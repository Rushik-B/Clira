import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import {
  createGmailLabelForUser,
  GmailNotConnectedError,
} from '@/lib/services/labels/createGmailLabelForUser';
import { OAuthTokenDecryptionError } from '@/lib/security/getUserGmailCredentials';
import { getUnifiedLabels } from '@/lib/services/unified/unifiedReads';

/**
 * GET /api/folders
 *
 * Returns all folders (labels) across ALL connected mailboxes.
 * Multi-inbox: Unified read aggregates from all mailboxes.
 * Each folder includes mailboxId for client-side filtering if needed.
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

    // Unified read: get labels from ALL connected mailboxes
    const { labels: syncedLabels, removedLabelIds, mailboxesProcessed } = await getUnifiedLabels({
      userId: user.id,
      purpose: 'folders:list',
      requester: 'api.folders.GET',
      includeSystemLabels: false,
      deleteMissing: true,
    });

    if (removedLabelIds.length > 0) {
      console.log(
        `[FOLDERS API] Removed ${removedLabelIds.length} orphaned labels for user ${user.email}`,
        removedLabelIds
      );
    }

    const formattedFolders = syncedLabels.map((folder) => {
      const effectivePrompt = folder.metaPrompt ?? `Emails related to ${folder.name}`;
      return {
        id: folder.id,
        name: folder.name,
        metaPrompt: effectivePrompt,
        emailCount: folder.emailCount ?? 0,
        color: folder.color || '#6366f1',
        isSystemDefault: folder.isSystemDefault,
        // Multi-inbox context
        mailboxId: folder.mailboxId,
        mailboxEmail: folder.mailboxEmail,
      };
    });

    console.log(`[FOLDERS API] Retrieved ${formattedFolders.length} folders from ${mailboxesProcessed} mailbox(es) for user ${user.email}`);

    return NextResponse.json({
      success: true,
      folders: formattedFolders,
      mailboxesProcessed,
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[FOLDERS API] Error fetching folders:', err.message, err.stack);
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
      return NextResponse.json(
        {
          success: false,
          error: 'Gmail not connected',
          message: 'Reconnect Gmail to refresh folder data.',
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch folders',
        message: err.message
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/folders
 *
 * Creates a new folder (label) in a SPECIFIC mailbox.
 * Multi-inbox: Writes require explicit mailboxId (no silent fallback).
 * If mailboxId not provided, falls back to primary mailbox for backward compatibility.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, metaPrompt, color, mailboxId } = body;

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedPrompt = typeof metaPrompt === 'string' ? metaPrompt.trim() : '';

    if (!trimmedName || !trimmedPrompt) {
      return NextResponse.json({ error: 'Name and metaPrompt are required' }, { status: 400 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
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

    // Prevent duplicate folder names per mailbox (case-insensitive)
    const existing = await prisma.label.findFirst({
      where: {
        userId: user.id,
        mailboxId: resolvedMailboxId,
        isSystemLabel: false,
        name: { equals: trimmedName, mode: 'insensitive' }
      },
      select: { id: true }
    });

    if (existing) {
      return NextResponse.json(
        { error: `Folder "${trimmedName}" already exists in ${mailbox.emailAddress}` },
        { status: 409 }
      );
    }

    let gmailLabelId: string;
    let backgroundColor: string;
    let textColor: string;

    try {
      const gmailLabel = await createGmailLabelForUser({
        userId: user.id,
        mailboxId: resolvedMailboxId,
        name: trimmedName,
        color,
        purpose: 'folders:create',
        requester: 'api.folders.POST',
      });

      gmailLabelId = gmailLabel.gmailLabelId;
      backgroundColor = gmailLabel.backgroundColor;
      textColor = gmailLabel.textColor;
    } catch (error) {
      if (error instanceof GmailNotConnectedError) {
        return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
      }

      console.error('[FOLDERS API] Error creating Gmail label:', error);
      const message = error instanceof Error ? error.message : 'Failed to create Gmail label';
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        { status: 502 }
      );
    }

    const newFolder = await prisma.label.create({
      data: {
        userId: user.id,
        mailboxId: resolvedMailboxId,
        name: trimmedName,
        metaPrompt: trimmedPrompt,
        color: backgroundColor,
        gmailLabelId,
        isCustom: true,
        isSystemDefault: false,
        emailCount: 0,
      },
    });

    console.log(`[FOLDERS API] Created new folder: ${trimmedName} (${gmailLabelId}) in mailbox ${mailbox.emailAddress} for user ${user.email}`);

    return NextResponse.json({
      success: true,
      folder: {
        id: newFolder.id,
        name: newFolder.name,
        metaPrompt: newFolder.metaPrompt,
        emailCount: newFolder.emailCount,
        color: newFolder.color,
        gmailLabelId: newFolder.gmailLabelId,
        textColor,
        isSystemDefault: false,
        // Multi-inbox context
        mailboxId: resolvedMailboxId,
        mailboxEmail: mailbox.emailAddress,
      },
    });

  } catch (error) {
    console.error('[FOLDERS API] Error creating folder:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create folder',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
