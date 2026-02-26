import { config } from 'dotenv';
import { resolve } from 'path';
import cron from 'node-cron';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local') });

type CronMethod = 'GET' | 'POST';

type CronJobConfig = {
  name: string;
  schedule: string;
  method: CronMethod;
  path: string;
};

const CRON_SECRET = process.env.CRON_SECRET;
const DEFAULT_BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const CRON_BASE_URL = (process.env.CRON_TARGET_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const NEXTAUTH_URL = process.env.NEXTAUTH_URL;
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'UTC';
const CRON_TRIGGER_TIMEOUT_MS = 60_000;
const CRON_STARTUP_WAIT_TIMEOUT_MS = Number.parseInt(
  process.env.CRON_STARTUP_WAIT_TIMEOUT_MS || '120000',
  10,
);
const CRON_STARTUP_RETRY_INTERVAL_MS = 2_000;
const CRON_INTERNAL_PROXY_HEADERS = {
  'x-forwarded-proto': 'https',
} as const;
const CRON_VERBOSE = process.env.CRON_VERBOSE === 'true';

const cronJobs: CronJobConfig[] = [
  {
    name: 'reminders',
    schedule: process.env.CRON_REMINDERS_SCHEDULE || '*/5 * * * * *',
    method: 'POST',
    path: '/api/cron/reminders',
  },
  {
    name: 'sort',
    schedule: process.env.CRON_SORT_SCHEDULE || '0 */2 * * *',
    method: 'POST',
    path: '/api/cron/sort',
  },
  {
    name: 'renew-gmail-watches',
    schedule: process.env.CRON_RENEW_GMAIL_WATCHES_SCHEDULE || '0 6 * * *',
    method: 'GET',
    path: '/api/cron/renew-gmail-watches',
  },
];

const inFlightJobs = new Set<string>();
const scheduledTasks: Array<{ name: string; stop: () => void }> = [];

async function triggerCronJob(job: CronJobConfig): Promise<void> {
  if (inFlightJobs.has(job.name)) {
    console.warn(`[LOCAL CRON] Skipping ${job.name}; previous run still in progress`);
    return;
  }

  inFlightJobs.add(job.name);
  const startedAt = Date.now();
  const endpoint = `${CRON_BASE_URL}${job.path}`;

  try {
    if (CRON_VERBOSE) {
      console.log(`[LOCAL CRON] Triggering ${job.name}: ${job.method} ${endpoint}`);
    }

    const response = await fetch(endpoint, {
      method: job.method,
      headers: {
        ...CRON_INTERNAL_PROXY_HEADERS,
        Authorization: `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(CRON_TRIGGER_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `${job.name} failed with ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`,
      );
    }

    if (CRON_VERBOSE) {
      const durationMs = Date.now() - startedAt;
      const preview = responseText.slice(0, 200).replace(/\s+/g, ' ').trim();
      console.log(`[LOCAL CRON] ${job.name} succeeded in ${durationMs}ms: ${preview}`);
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[LOCAL CRON] ${job.name} failed in ${durationMs}ms`, error);
  } finally {
    inFlightJobs.delete(job.name);
  }
}

function validateCronConfiguration(): void {
  if (!CRON_SECRET) {
    throw new Error('CRON_SECRET is required for local cron runner');
  }

  for (const job of cronJobs) {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron expression for ${job.name}: "${job.schedule}"`);
    }
  }
}

async function waitForCronTargetReachable(): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + CRON_STARTUP_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(CRON_BASE_URL, {
        method: 'GET',
        headers: CRON_INTERNAL_PROXY_HEADERS,
        signal: AbortSignal.timeout(5_000),
      });
      console.log(`[LOCAL CRON] Cron target reachable (${response.status})`);
      return;
    } catch (error) {
      const remainingMs = Math.max(0, deadline - Date.now());
      console.log(
        `[LOCAL CRON] Waiting for app target ${CRON_BASE_URL} (${remainingMs}ms left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, CRON_STARTUP_RETRY_INTERVAL_MS));
    }
  }

  throw new Error(
    `Timed out waiting for cron target ${CRON_BASE_URL} after ${CRON_STARTUP_WAIT_TIMEOUT_MS}ms`,
  );
}

async function startCronRunner(): Promise<void> {
  validateCronConfiguration();

  console.log('[LOCAL CRON] Starting local cron scheduler');
  console.log(`[LOCAL CRON] Cron target URL (internal): ${CRON_BASE_URL}`);
  if (NEXTAUTH_URL) {
    console.log(`[LOCAL CRON] App URL (host/browser): ${NEXTAUTH_URL}`);
  }
  if (CRON_BASE_URL.includes('app:3000')) {
    console.log('[LOCAL CRON] Note: Docker internal calls use app:3000; host access still uses localhost:13000');
  }
  console.log(`[LOCAL CRON] Timezone: ${CRON_TIMEZONE}`);
  await waitForCronTargetReachable();

  for (const job of cronJobs) {
    const task = cron.schedule(
      job.schedule,
      () => {
        void triggerCronJob(job);
      },
      { timezone: CRON_TIMEZONE },
    );

    scheduledTasks.push({
      name: job.name,
      stop: () => task.stop(),
    });

    console.log(`[LOCAL CRON] Scheduled ${job.name} with "${job.schedule}"`);
  }
}

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[LOCAL CRON] Received ${signal}; stopping scheduler...`);
  for (const task of scheduledTasks) {
    try {
      task.stop();
      console.log(`[LOCAL CRON] Stopped ${task.name}`);
    } catch (error) {
      console.error(`[LOCAL CRON] Failed to stop ${task.name}`, error);
    }
  }

  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

void (async () => {
  try {
    await startCronRunner();
  } catch (error) {
    console.error('[LOCAL CRON] Failed to start local scheduler', error);
    process.exit(1);
  }
})();
