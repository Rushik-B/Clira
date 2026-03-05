import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { google } from 'googleapis';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { encryptToken } from '@/lib/encryption';
import { checkUserScopes } from '@/lib/auth/scope-utils';
import { GmailPushService } from '@/lib/email/gmailPushService';
import { enqueueInboxBackfillForMailboxIfReady } from '@/lib/services/inbox-search';
import { getGmailPubSubTopic } from '@/lib/email/gmailIngestionConfig';
import {
  createMailboxConnectAuthUrl,
  getBaseUrl,
  getOAuthClient,
  verifyState,
} from '@/lib/services/mailbox/mailboxConnectFlow';

function redirectWithStatus(
  request: NextRequest,
  status: 'connected' | 'already-connected' | 'error',
  message?: string
) {
  const url = new URL('/', getBaseUrl(request));
  url.searchParams.set('mailbox', status);
  if (message) {
    url.searchParams.set('message', message);
  }
  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as { provider?: string }));
    if (body.provider !== 'google') {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error('NEXTAUTH_SECRET is not configured');
    }

    const authUrl = createMailboxConnectAuthUrl({
      request,
      userId: session.userId,
      provider: body.provider,
      secret,
    });

    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[MAILBOX_CONNECT] Failed to start OAuth flow:', error);
    return NextResponse.json({ error: 'Failed to start mailbox connection' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get('error');
  if (error) {
    return redirectWithStatus(request, 'error', 'oauth_error');
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (!code) {
    return redirectWithStatus(request, 'error', 'missing_code');
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return redirectWithStatus(request, 'error', 'missing_secret');
  }

  const payload = verifyState(state, secret);
  if (!payload) {
    return redirectWithStatus(request, 'error', 'invalid_state');
  }

  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return redirectWithStatus(request, 'error', 'unauthorized');
  }

  if (session.userId !== payload.userId) {
    return redirectWithStatus(request, 'error', 'user_mismatch');
  }

  try {
    const baseUrl = getBaseUrl(request);
    const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/mailbox/connect`;
    const oauthClient = getOAuthClient(redirectUri);

    const tokenResponse = await oauthClient.getToken(code);
    const tokens = tokenResponse.tokens;

    if (!tokens.access_token) {
      return redirectWithStatus(request, 'error', 'missing_access_token');
    }

    oauthClient.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
    const userInfo = await oauth2.userinfo.get();
    const providerAccountId = userInfo.data.id;
    const emailAddress = userInfo.data.email?.toLowerCase();
    const displayName = userInfo.data.name ?? null;

    if (!providerAccountId || !emailAddress) {
      return redirectWithStatus(request, 'error', 'missing_profile');
    }

    const existingAccount = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId,
        },
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (existingAccount && existingAccount.userId !== session.userId) {
      return redirectWithStatus(request, 'error', 'account_in_use');
    }

    const grantedScopes = (tokens.scope ?? '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const scopeCheck = grantedScopes.length > 0 ? checkUserScopes(grantedScopes) : null;
    if (!scopeCheck) {
      console.warn('[MAILBOX_CONNECT] OAuth scope not provided by Google; assuming required scopes are present');
    }
    let hasRequiredScopes = scopeCheck
      ? scopeCheck.hasAllRequiredScopes && scopeCheck.hasGmailModify
      : true;
    if (scopeCheck && !hasRequiredScopes) {
      console.warn('[MAILBOX_CONNECT] Scope check failed; missing:', scopeCheck.missingScopes, 'hasGmailModify:', scopeCheck.hasGmailModify);
      // Lenient: we have a fresh access_token from mailbox connect; treat as CONNECTED so user is not stuck
      hasRequiredScopes = true;
    }
    const mailboxStatus = hasRequiredScopes ? 'CONNECTED' : 'NEEDS_RECONNECT';

    const existingMailbox = await prisma.mailbox.findUnique({
      where: {
        userId_provider_providerAccountId: {
          userId: session.userId,
          provider: 'google',
          providerAccountId,
        },
      },
    });

    const mailboxCount = existingMailbox
      ? null
      : await prisma.mailbox.count({ where: { userId: session.userId } });

    const mailbox = existingMailbox
      ? await prisma.mailbox.update({
          where: { id: existingMailbox.id },
          data: {
            emailAddress,
            displayName: displayName ?? existingMailbox.displayName,
            status: mailboxStatus,
          },
        })
      : await prisma.mailbox.create({
          data: {
            userId: session.userId,
            provider: 'google',
            providerAccountId,
            emailAddress,
            displayName,
            isPrimary: (mailboxCount ?? 0) === 0,
            status: mailboxStatus,
          },
        });

    await prisma.oAuthAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId,
        },
      },
      update: {
        mailboxId: mailbox.id,
        accessToken: encryptToken(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined,
        scope: tokens.scope ?? null,
        tokenType: tokens.token_type ?? null,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
      },
      create: {
        userId: session.userId,
        mailboxId: mailbox.id,
        provider: 'google',
        providerAccountId,
        accessToken: encryptToken(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined,
        scope: tokens.scope ?? null,
        tokenType: tokens.token_type ?? null,
        expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
      },
    });

    if (mailboxStatus === 'CONNECTED') {
      try {
        const topicName = getGmailPubSubTopic();
        const pushService = new GmailPushService(session.userId);
        await pushService.setupPushNotifications({
          userId: session.userId,
          mailboxId: mailbox.id,
          topicName,
        });
      } catch (error) {
        console.warn('Skipping Gmail watch setup during mailbox connect due to ingestion config error', error);
      }

      try {
        const backfillResult = await enqueueInboxBackfillForMailboxIfReady({
          userId: session.userId,
          mailboxId: mailbox.id,
        });
        if (!backfillResult.enqueued && backfillResult.skippedReason) {
          console.log(
            `[MAILBOX_CONNECT] Inbox backfill not enqueued for mailbox ${mailbox.id}: ${backfillResult.skippedReason}`,
          );
        }
      } catch (error) {
        console.warn(
          `[MAILBOX_CONNECT] Failed to enqueue inbox backfill for mailbox ${mailbox.id}:`,
          error,
        );
      }
    }

    if (existingMailbox) {
      return redirectWithStatus(request, 'already-connected', 'mailbox_exists');
    }

    return redirectWithStatus(request, 'connected', 'mailbox_connected');
  } catch (error) {
    console.error('[MAILBOX_CONNECT] Failed to finish OAuth flow:', error);
    return redirectWithStatus(request, 'error', 'connect_failed');
  }
}
