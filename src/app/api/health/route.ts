import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getGmailIngestionMode,
  getGmailPubSubTopic,
  getGmailPullSubscription,
} from '@/lib/email/gmailIngestionConfig';
import {
  GMAIL_PULL_WORKER_HEARTBEAT_TTL_SECONDS,
  readGmailPullWorkerHeartbeat,
} from '@/lib/email/gmailPullWorkerHeartbeat';
import {
  getConfiguredLanguageModelProviders,
  getMissingLanguageModelConfig,
} from '@/lib/ai/models';

const REQUIRED_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NEXTAUTH_SECRET',
  'DATABASE_URL',
  'CRON_SECRET',
  'EMAIL_ENCRYPT_SECRET',
  'EMAIL_ENCRYPT_SALT',
];

type DeepHealthResult = {
  status: 'healthy' | 'unhealthy';
  degraded: boolean;
  checks?: Record<string, unknown>;
  missing?: string[];
  error?: string;
};

function buildBaseResponse(mode: 'live' | 'deep') {
  return {
    mode,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    uptime: process.uptime(),
  };
}

async function runDeepHealth(): Promise<DeepHealthResult> {
  await prisma.$queryRaw`SELECT 1`;

  const mode = getGmailIngestionMode();
  getGmailPubSubTopic();
  if (mode === 'pull') {
    getGmailPullSubscription();
  }

  const missingRequired = REQUIRED_ENV.filter((envVar) => !process.env[envVar]);
  const missingLanguageModelConfig = getMissingLanguageModelConfig();
  const missing = [...missingRequired, ...missingLanguageModelConfig];

  const pullHeartbeat = mode === 'pull' ? await readGmailPullWorkerHeartbeat() : null;
  const pullWorkerHealthy =
    mode === 'push'
      ? true
      : Boolean(
          pullHeartbeat && pullHeartbeat.ageMs <= GMAIL_PULL_WORKER_HEARTBEAT_TTL_SECONDS * 1000,
        );

  const checks = {
    database: 'healthy',
    environment: missing.length === 0 ? 'healthy' : 'unhealthy',
    languageModelProviders: getConfiguredLanguageModelProviders(),
    gmailIngestionMode: mode,
    gmailPullWorker: mode === 'pull' ? (pullWorkerHealthy ? 'healthy' : 'unhealthy') : 'not-required',
    gmailPullWorkerHeartbeatAgeMs: pullHeartbeat?.ageMs ?? null,
  };

  if (missing.length > 0) {
    return {
      status: 'unhealthy',
      degraded: true,
      checks,
      missing,
      error: 'Configuration incomplete',
    };
  }

  if (!pullWorkerHealthy) {
    return {
      status: 'unhealthy',
      degraded: true,
      checks,
      error: 'Gmail pull worker heartbeat is stale or missing',
    };
  }

  return {
    status: 'healthy',
    degraded: false,
    checks,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get('deep') === '1';
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (!deep) {
    return NextResponse.json({
      status: 'healthy',
      degraded: false,
      checks: {
        app: 'healthy',
        readiness: 'not-run',
      },
      ...buildBaseResponse('live'),
    });
  }

  try {
    const result = await runDeepHealth();

    return NextResponse.json(
      {
        ...buildBaseResponse('deep'),
        ...result,
      },
      { status: result.status === 'healthy' ? 200 : 500 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ...buildBaseResponse('deep'),
        status: 'unhealthy',
        degraded: true,
        error: isDevelopment && error instanceof Error ? error.message : 'Health check failed',
      },
      { status: 500 },
    );
  }
}
