import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { getMailboxesForUser } from '@/lib/services/mailbox/getMailboxesForUser';

/**
 * GET /api/mailbox
 * Returns all mailboxes for the authenticated user.
 * Sorted by isPrimary (primary first), then createdAt.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const mailboxes = await getMailboxesForUser({ userId: session.userId });

    return NextResponse.json({
      success: true,
      mailboxes,
    });
  } catch (error) {
    console.error('[GET /api/mailbox] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mailboxes' },
      { status: 500 }
    );
  }
}
