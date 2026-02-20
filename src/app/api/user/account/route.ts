import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { GmailPushService } from '@/lib/email/gmailPushService';

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId as string;

    try {
      const mailboxes = await prisma.mailbox.findMany({
        where: {
          userId,
          provider: 'google',
        },
        select: { id: true },
      });

      const pushService = new GmailPushService(userId);
      for (const mailbox of mailboxes) {
        await pushService.stopPushNotifications({
          userId,
          mailboxId: mailbox.id,
        });
      }
    } catch (error) {
      console.warn('[DELETE_ACCOUNT] Failed to stop Gmail watch:', error);
    }

    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE_ACCOUNT] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete account' }, { status: 500 });
  }
}
