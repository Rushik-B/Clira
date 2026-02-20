import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const masterPrompts = await prisma.masterPrompt.findMany({
      where: {
        userId: session.userId
      },
      orderBy: {
        version: 'desc'
      }
    });

    return NextResponse.json({
      prompts: masterPrompts,
      count: masterPrompts.length
    });

  } catch (error) {
    console.error('Error fetching master prompt history:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch master prompt history',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 