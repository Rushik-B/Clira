import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ZodError } from 'zod';
import { authOptions } from '@/lib/auth/auth';
import { devOnlyGuard } from '@/lib/utils/devOnly';
import { runInjectionHarness } from '@/lib/testing/injection-harness';

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

export async function POST(request: NextRequest) {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawEmail = await request.json();

    const result = await runInjectionHarness({
      userId: session.userId,
      userEmail: session.user.email,
      rawEmail,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    const message = errorMessage(error);
    const status = message.toLowerCase().includes('invalid date') ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function GET() {
  const devBlock = devOnlyGuard();
  if (devBlock) return devBlock;

  return NextResponse.json({
    endpoint: '/api/test-simulate-email',
    description:
      'Injection Harness (Flight Simulator): inject a raw email object into the reply pipeline without Gmail or DB persistence.',
    notes: [
      'Auth required.',
      'No DB writes for simulated emails/threads.',
      'No Gmail draft creation.',
      'Optional: provide a real DB threadId to include thread context.',
    ],
    requiredFields: ['from', 'to[]', 'subject', 'body'],
    optionalFields: ['cc[]', 'labelIds[]', 'date', 'messageId', 'threadId', 'simulateReply', 'parentMessageId'],
    example: {
      from: 'sarah.chen@company.com',
      to: ['me@company.com'],
      cc: [],
      subject: 'Quick question about Tuesday',
      body: 'Are we still on for Tuesday at 3pm?',
      labelIds: ['INBOX'],
      date: '2025-12-19T17:00:00Z',
    },
  });
}

