import { NextResponse } from 'next/server';
import { generateReauthUrl, REQUIRED_SCOPES } from '@/lib/auth/scope-utils';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const referer = request.headers.get('referer');
  let callbackUrl = `${requestUrl.origin}/settings/calendar`;

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === requestUrl.origin) {
        callbackUrl = refererUrl.toString();
      }
    } catch {
      // Ignore invalid referrer and use safe default.
    }
  }

  const reauthUrl = generateReauthUrl([REQUIRED_SCOPES.CALENDAR_EVENTS], {
    callbackUrl,
  });
  return NextResponse.redirect(reauthUrl);
}
