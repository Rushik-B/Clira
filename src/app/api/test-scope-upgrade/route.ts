import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { checkUserScopes, generateReauthUrl } from '@/lib/auth/scope-utils';
import { devOnlyGuard } from '@/lib/utils/devOnly';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Simulate a user without gmail.modify scope
    const testScopes = [
      'openid',
      'email', 
      'profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/calendar.readonly'
      // Note: gmail.modify is missing
    ];

    const scopeCheck = checkUserScopes(testScopes);
    const reauthUrl = generateReauthUrl();

    return NextResponse.json({
      success: true,
      message: 'Scope upgrade test endpoint',
      testData: {
        simulatedScopes: testScopes,
        scopeCheck,
        reauthUrl,
        needsUpgrade: !scopeCheck.hasGmailModify
      }
    });

  } catch (error) {
    logger.error('Error in scope upgrade test:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Test failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
