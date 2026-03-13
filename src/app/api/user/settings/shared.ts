import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';

const UNAUTHORIZED_ERROR = 'UNAUTHORIZED';

export async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    throw new Error(UNAUTHORIZED_ERROR);
  }

  return session.userId as string;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message === UNAUTHORIZED_ERROR;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
