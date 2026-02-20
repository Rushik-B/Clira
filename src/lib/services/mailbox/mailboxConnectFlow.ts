import { NextRequest } from 'next/server';
import { google } from 'googleapis';
import crypto from 'crypto';
import { ENHANCED_SCOPES } from '@/lib/auth/scope-utils';

/**
 * Mailbox connect uses a different redirect URI than NextAuth sign-in.
 * GCP OAuth client must have BOTH in Authorized redirect URIs:
 * - Sign-in:  {NEXTAUTH_URL}/api/auth/callback/google
 * - Mailbox:  {NEXTAUTH_URL}/api/mailbox/connect
 */
type MailboxConnectState = {
  userId: string;
  ts: number;
  nonce: string;
};

const STATE_TTL_MS = 10 * 60 * 1000;

export function getBaseUrl(request: NextRequest): string {
  const raw =
    process.env.NEXTAUTH_URL ?? request.nextUrl.origin;
  // Use only origin (scheme + host + port) so redirect_uri never gets query/path from env.
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

export function getOAuthClient(redirectUri: string) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth is not configured');
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function signState(payload: MailboxConnectState, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyState(state: string | null, secret: string): MailboxConnectState | null {
  if (!state) return null;
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');

  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf-8')
    ) as MailboxConnectState;

    if (!payload.userId || !payload.ts) return null;
    if (Date.now() - payload.ts > STATE_TTL_MS) return null;

    return payload;
  } catch {
    return null;
  }
}

export function createMailboxConnectAuthUrl({
  request,
  userId,
  provider,
  secret,
}: {
  request: NextRequest;
  userId: string;
  provider: string;
  secret: string;
}): string {
  if (provider !== 'google') {
    throw new Error('Unsupported provider');
  }

  const baseUrl = getBaseUrl(request);
  // Redirect URI must match exactly what is registered in Google Cloud Console (no extra query params).
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/mailbox/connect`;
  const oauthClient = getOAuthClient(redirectUri);

  const state = signState(
    {
      userId,
      ts: Date.now(),
      nonce: crypto.randomUUID(),
    },
    secret
  );

  return oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: ENHANCED_SCOPES,
    state,
  });
}
