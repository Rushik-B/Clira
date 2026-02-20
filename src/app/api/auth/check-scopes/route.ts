import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { checkUserScopes, generateReauthUrl, REQUIRED_SCOPES } from '@/lib/auth/scope-utils';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's OAuth account
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const oauthAccount = await prisma.oAuthAccount.findFirst({
      where: {
        userId: user.id,
        provider: 'google'
      },
      select: {
        scope: true
      }
    });

    if (!oauthAccount) {
      return NextResponse.json({ error: 'No OAuth account found' }, { status: 404 });
    }

    const userScopes = oauthAccount.scope?.split(' ') || [];
    const scopeCheck = checkUserScopes(userScopes);

    const response = {
      success: true,
      scopes: scopeCheck,
      recommendations: {
        shouldUpgrade: !scopeCheck.hasGmailModify,
        upgradeReason: !scopeCheck.hasGmailModify 
          ? 'Gmail modify permission is needed to organize emails with labels and folders'
          : null,
        reauthUrl: !scopeCheck.hasGmailModify 
          ? generateReauthUrl([REQUIRED_SCOPES.GMAIL_MODIFY])
          : null
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('[SCOPE CHECK] Error checking user scopes:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to check scopes',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
