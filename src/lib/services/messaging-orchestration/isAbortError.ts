/**
 * Classifies errors that represent deliberate cancellation/abort signals
 * from orchestrators, channel adapters, or underlying SDKs.
 */
export function isAbortError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (
      code === 'abort' ||
      code === 'ABORT_ERR' ||
      code === 'ERR_ABORTED' ||
      code === 'ERR_CANCELED'
    ) {
      return true;
    }
  }

  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      /abort|aborted|cancel|superseded/i.test(error.message ?? '')
    );
  }

  return false;
}
