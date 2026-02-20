import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const REQUIRED_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NEXTAUTH_SECRET',
  'DATABASE_URL',
];

export async function GET() {
  const isDevelopment = process.env.NODE_ENV === 'development';

  try {
    await prisma.$queryRaw`SELECT 1`;

    const hasLlmKey = !!(
      process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
    );
    const missingRequired = REQUIRED_ENV.filter((envVar) => !process.env[envVar]);

    if (!hasLlmKey) {
      missingRequired.push('GOOGLE_GENERATIVE_AI_API_KEY');
    }

    if (missingRequired.length > 0) {
      return NextResponse.json(
        {
          status: 'unhealthy',
          error: 'Configuration incomplete',
          ...(isDevelopment ? { missing: missingRequired } : {}),
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      checks: {
        database: 'healthy',
        environment: 'healthy',
      },
      uptime: process.uptime(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: isDevelopment && error instanceof Error ? error.message : 'Health check failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
