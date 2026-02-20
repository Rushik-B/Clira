import { fastOnboardingQueue } from '../utils/queues';
import redisConnection, { safeRedisOperation } from '../utils/redis';
import { getJobStatus } from './utils/queueStatus';
import {
  FastOnboardingJobPayload,
  JobStatus,
} from './types';

interface QueueOptions {
  maxEmails?: number;
  daysBack?: number;
}

const REDIS_KEY_PREFIX = 'fast_onboarding:proposal:';

export class FastOnboardingService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly REDIS_TTL_SEC = 30 * 60; // 30 minutes
  private static cache = new Map<string, { payload: FastOnboardingJobPayload; timestamp: number }>();

  private static cleanupExpired(): void {
    const now = Date.now();
    for (const [userId, entry] of FastOnboardingService.cache.entries()) {
      if (now - entry.timestamp > FastOnboardingService.CACHE_TTL_MS) {
        FastOnboardingService.cache.delete(userId);
      }
    }
  }

  private static getRedisKey(userId: string): string {
    return `${REDIS_KEY_PREFIX}${userId}`;
  }

  private static touchCache(userId: string, payload: FastOnboardingJobPayload): FastOnboardingJobPayload {
    FastOnboardingService.cache.set(userId, {
      payload,
      timestamp: Date.now(),
    });
    return payload;
  }

  private static getFromCache(userId: string): FastOnboardingJobPayload | null {
    const entry = FastOnboardingService.cache.get(userId);
    if (!entry) {
      return null;
    }
    if (Date.now() - entry.timestamp > FastOnboardingService.CACHE_TTL_MS) {
      FastOnboardingService.cache.delete(userId);
      return null;
    }
    return entry.payload;
  }

  async queueProposalJob(userId: string, options: QueueOptions = {}): Promise<
    | { cached: true; payload: FastOnboardingJobPayload }
    | { cached: false; jobId: string }
  > {
    FastOnboardingService.cleanupExpired();

    const cached = await this.getProposalResult(userId);
    if (cached) {
      return { cached: true, payload: cached };
    }

    const jobId = `fast-onboarding-proposal:${userId}`;

    const existingJob = await fastOnboardingQueue.getJob(jobId);
    if (existingJob) {
      return { cached: false, jobId };
    }

    await fastOnboardingQueue.add(
      'fast-onboarding-proposal',
      {
        userId,
        options,
      },
      {
        jobId,
        priority: 1,
        removeOnComplete: 20,
        removeOnFail: 10,
      }
    );

    return { cached: false, jobId };
  }

  async getProposalResult(userId: string): Promise<FastOnboardingJobPayload | null> {
    const fromCache = FastOnboardingService.getFromCache(userId);
    if (fromCache) {
      return fromCache;
    }

    const redisKey = FastOnboardingService.getRedisKey(userId);
    const cachedRaw = await safeRedisOperation(
      () => redisConnection.get(redisKey),
      null,
      'fast onboarding get proposal'
    );

    if (!cachedRaw) {
      return null;
    }

    try {
      const parsed = JSON.parse(cachedRaw) as FastOnboardingJobPayload;
      if (!parsed.generatedAt) {
        parsed.generatedAt = new Date().toISOString();
      }
      return FastOnboardingService.touchCache(userId, parsed);
    } catch (error) {
      console.warn('[FAST ONBOARDING] Failed to parse cached proposal payload:', error);
      return null;
    }
  }

  async storeProposalResult(userId: string, payload: FastOnboardingJobPayload): Promise<void> {
    const withTimestamp: FastOnboardingJobPayload = {
      ...payload,
      generatedAt: payload.generatedAt || new Date().toISOString(),
    };
    FastOnboardingService.touchCache(userId, withTimestamp);

    const redisKey = FastOnboardingService.getRedisKey(userId);
    await safeRedisOperation(
      () =>
        redisConnection.set(
          redisKey,
          JSON.stringify(withTimestamp),
          'EX',
          FastOnboardingService.REDIS_TTL_SEC
        ),
      null,
      'fast onboarding store proposal'
    );
  }

  async clearCachedResult(userId: string): Promise<void> {
    FastOnboardingService.cache.delete(userId);
    const redisKey = FastOnboardingService.getRedisKey(userId);
    await safeRedisOperation(
      () => redisConnection.del(redisKey),
      null,
      'fast onboarding clear proposal'
    );
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    return getJobStatus(fastOnboardingQueue, jobId);
  }
}

export type { FastOnboardingJobPayload };
