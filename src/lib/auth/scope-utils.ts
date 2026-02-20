// OAuth scope utilities for checking and managing Gmail + Calendar permissions

export const REQUIRED_SCOPES = {
  OPENID: 'openid',
  EMAIL: 'email',
  PROFILE: 'profile',
  USERINFO_EMAIL: 'https://www.googleapis.com/auth/userinfo.email',
  USERINFO_PROFILE: 'https://www.googleapis.com/auth/userinfo.profile',
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
  GMAIL_SEND: 'https://www.googleapis.com/auth/gmail.send',
  GMAIL_LABELS: 'https://www.googleapis.com/auth/gmail.labels',
  GMAIL_MODIFY: 'https://www.googleapis.com/auth/gmail.modify',
  CALENDAR_READONLY: 'https://www.googleapis.com/auth/calendar.readonly',
  CALENDAR_EVENTS: 'https://www.googleapis.com/auth/calendar.events',
} as const;

export const CORE_SCOPES = [
  REQUIRED_SCOPES.OPENID,
  REQUIRED_SCOPES.EMAIL,
  REQUIRED_SCOPES.PROFILE,
  REQUIRED_SCOPES.GMAIL_READONLY,
  REQUIRED_SCOPES.GMAIL_SEND,
  REQUIRED_SCOPES.GMAIL_LABELS,
  REQUIRED_SCOPES.CALENDAR_READONLY,
];

export const ENHANCED_SCOPES = [
  ...CORE_SCOPES,
  REQUIRED_SCOPES.GMAIL_MODIFY
];

export interface ScopeCheckResult {
  hasAllRequiredScopes: boolean;
  hasGmailModify: boolean;
  hasCalendarEvents: boolean;
  missingScopes: string[];
  currentScopes: string[];
}

/**
 * Check if user has all required scopes
 */
export function checkUserScopes(userScopes: string[]): ScopeCheckResult {
  const normalizedScopes = normalizeGoogleScopes(userScopes);
  const missingCoreScopes = CORE_SCOPES.filter(scope => !normalizedScopes.includes(scope));
  const hasGmailModify = normalizedScopes.includes(REQUIRED_SCOPES.GMAIL_MODIFY);
  const hasCalendarEvents = normalizedScopes.includes(REQUIRED_SCOPES.CALENDAR_EVENTS);
  
  return {
    hasAllRequiredScopes: missingCoreScopes.length === 0,
    hasGmailModify,
    hasCalendarEvents,
    missingScopes: missingCoreScopes,
    currentScopes: normalizedScopes
  };
}

function normalizeGoogleScopes(scopes: string[]): string[] {
  const normalized = new Set<string>();

  for (const rawScope of scopes) {
    const scope = rawScope.trim();
    if (!scope) continue;

    if (scope === REQUIRED_SCOPES.USERINFO_EMAIL) {
      normalized.add(REQUIRED_SCOPES.EMAIL);
      normalized.add(REQUIRED_SCOPES.USERINFO_EMAIL);
      continue;
    }

    if (scope === REQUIRED_SCOPES.USERINFO_PROFILE) {
      normalized.add(REQUIRED_SCOPES.PROFILE);
      normalized.add(REQUIRED_SCOPES.USERINFO_PROFILE);
      continue;
    }

    normalized.add(scope);
  }

  return Array.from(normalized);
}

/**
 * Generate OAuth URL for re-authorization with missing scopes
 */
export function generateReauthUrl(
  missingScopes: string[] = [],
  opts?: { callbackUrl?: string },
): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const scopesToRequest =
    missingScopes.length > 0
      ? Array.from(new Set([...ENHANCED_SCOPES, ...missingScopes]))
      : ENHANCED_SCOPES;
  
  const params = new URLSearchParams({
    scope: scopesToRequest.join(' '),
    access_type: 'offline',
    prompt: 'consent', // Force consent screen to show updated scopes
    include_granted_scopes: 'true' // Keep existing scopes
  });

  if (opts?.callbackUrl) {
    params.set('callbackUrl', opts.callbackUrl);
  }

  return `${baseUrl}/api/auth/signin/google?${params.toString()}`;
}

/**
 * Check if a specific Gmail operation requires modify scope
 */
export function requiresModifyScope(operation: 'read' | 'send' | 'label' | 'modify'): boolean {
  return operation === 'modify' || operation === 'label';
}
