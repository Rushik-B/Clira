export function getPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }

  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : null;
}

export function isPrismaAuthenticationFailure(error: unknown): boolean {
  return getPrismaErrorCode(error) === 'P1000';
}
