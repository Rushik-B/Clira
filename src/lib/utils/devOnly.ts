/**
 * Utility to check if the current environment is development.
 * Use this to gate debug-only functionality.
 */
export const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Returns 404 response if not in development environment.
 * Use at the start of debug endpoints to prevent production exposure.
 */
export function devOnlyGuard(): Response | null {
  if (!isDevelopment) {
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

