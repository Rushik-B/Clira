import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/mailbox/[id]
 * Update mailbox settings. Currently supports setting as primary.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { action } = body;

    // Verify mailbox belongs to user
    const mailbox = await prisma.mailbox.findFirst({
      where: { id, userId: session.userId },
    });

    if (!mailbox) {
      return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
    }

    if (action === 'set-primary') {
      // Transaction: unset current primary, set new primary
      await prisma.$transaction([
        prisma.mailbox.updateMany({
          where: { userId: session.userId, isPrimary: true },
          data: { isPrimary: false },
        }),
        prisma.mailbox.update({
          where: { id },
          data: { isPrimary: true },
        }),
      ]);

      return NextResponse.json({
        success: true,
        message: 'Mailbox set as primary',
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[PATCH /api/mailbox/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update mailbox' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mailbox/[id]
 * Disconnect (remove) a mailbox from the user's account.
 * Cannot delete the primary mailbox if it's the only one.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify mailbox belongs to user
    const mailbox = await prisma.mailbox.findFirst({
      where: { id, userId: session.userId },
    });

    if (!mailbox) {
      return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
    }

    // Count user's mailboxes
    const mailboxCount = await prisma.mailbox.count({
      where: { userId: session.userId },
    });

    // Don't allow deleting the only mailbox
    if (mailboxCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot disconnect your only inbox. At least one inbox is required.' },
        { status: 400 }
      );
    }

    // If deleting primary, promote another mailbox to primary
    if (mailbox.isPrimary) {
      const nextPrimary = await prisma.mailbox.findFirst({
        where: {
          userId: session.userId,
          id: { not: id },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (nextPrimary) {
        await prisma.mailbox.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }
    }

    // Delete the mailbox
    await prisma.mailbox.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Mailbox disconnected',
    });
  } catch (error) {
    console.error('[DELETE /api/mailbox/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect mailbox' },
      { status: 500 }
    );
  }
}
