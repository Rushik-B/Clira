import type { JobsOptions, Queue } from 'bullmq';
import {
  mcpHealthcheckConnectionQueue,
  mcpSyncConnectionQueue,
  type McpHealthcheckConnectionJobData,
  type McpSyncConnectionJobData,
} from '@/lib/services/utils/queues';

const ACTIVE_JOB_STATES = new Set(['waiting', 'delayed', 'active', 'prioritized']);

async function addStableJob<T>(
  queue: Queue<T, unknown, string>,
  name: string,
  data: T,
  jobId: string,
  options: JobsOptions = {},
): Promise<{ jobId: string; enqueued: boolean }> {
  const existingJob = await queue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (ACTIVE_JOB_STATES.has(state)) {
      return { jobId, enqueued: false };
    }

    await existingJob.remove().catch(() => {});
  }

  const job = await queue.add(name as never, data as never, {
    ...options,
    jobId,
  });

  return { jobId: job.id ?? jobId, enqueued: true };
}

export async function enqueueMcpSyncConnectionJob(
  data: McpSyncConnectionJobData,
): Promise<{ jobId: string; enqueued: boolean }> {
  return addStableJob(
    mcpSyncConnectionQueue,
    'sync-mcp-connection',
    data,
    `mcp-sync:${data.connectionId}`,
  );
}

export async function enqueueMcpHealthcheckConnectionJob(
  data: McpHealthcheckConnectionJobData,
): Promise<{ jobId: string; enqueued: boolean }> {
  return addStableJob(
    mcpHealthcheckConnectionQueue,
    'healthcheck-mcp-connection',
    data,
    `mcp-health:${data.connectionId}`,
  );
}
