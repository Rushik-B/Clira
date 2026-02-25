/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Placeholder Redis utility - to be revisited
import IORedis from 'ioredis';

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

// In test environment, use lazy-connect and never actually connect.
// Tests that need orchestration use the in-memory harness, not Redis.
const redisConnection = new IORedis(
  isTest ? 'redis://localhost:16379' : (process.env.REDIS_URL || 'redis://localhost:16379'),
  {
    maxRetriesPerRequest: null,
    lazyConnect: isTest, // tests: don't connect; prod: connect immediately
    keepAlive: 30000,
    enableOfflineQueue: !isTest,
    connectTimeout: 30000,
    commandTimeout: 60000,
    retryStrategy: isTest ? () => null : undefined, // tests: never retry
  },
);

if (!isTest) {
  // Handle connection events — only in real environments
  redisConnection.on('connect', () => {
    console.log('✅ Connected to Redis');
  });

  redisConnection.on('ready', () => {
    console.log('🟢 Redis is ready to accept commands');
  });

  redisConnection.on('error', (err: Error) => {
    console.error('❌ Redis connection error:', err);
  });

  redisConnection.on('close', () => {
    console.log('🔌 Redis connection closed');
  });

  redisConnection.on('reconnecting', () => {
    console.log('🔄 Redis reconnecting...');
  });

  redisConnection.on('end', () => {
    console.log('🛑 Redis connection ended');
  });
}

// Health check method
export const isRedisConnected = (): boolean => {
  return redisConnection.status === 'ready';
};

// Graceful Redis operation wrapper
export const safeRedisOperation = async <T>(
  operation: () => Promise<T>,
  fallback: T,
  operationName = 'Redis operation'
): Promise<T> => {
  try {
    if (!isRedisConnected()) {
      console.warn(`⚠️ Redis not ready for ${operationName}, using fallback`);
      return fallback;
    }
    return await operation();
  } catch (error) {
    if (error.message?.includes('Command timed out')) {
      console.warn(`⏰ Redis timeout for ${operationName}, using fallback`);
    } else {
      console.warn(`⚠️ ${operationName} failed:`, error);
    }
    return fallback;
  }
};

export default redisConnection;
