/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Placeholder Redis utility - to be revisited
import IORedis from 'ioredis';

// For local development with Docker Redis, set REDIS_URL=redis://localhost:16379
const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:16379', {
  // This is important to prevent jobs from failing during a brief Redis disconnect.
  maxRetriesPerRequest: null,
  // Connection pool settings for better performance
  lazyConnect: false, // Connect immediately to avoid race conditions
  keepAlive: 30000,
  enableOfflineQueue: true, // Queue commands until connection is ready
  connectTimeout: 30000,
  commandTimeout: 60000, // Increased to 60 seconds for LLM operations
});

// Handle connection events
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