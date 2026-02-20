import redisConnection, { isRedisConnected, safeRedisOperation } from './redis';

interface RedisOperationResult<T> {
  success: boolean;
  data: T | null;
  error?: Error;
  fromCache: boolean;
}

/**
 * RedisService - Provides safe, connection-aware Redis operations
 * 
 * This service ensures Redis operations are resilient to connection issues
 * by providing proper error handling and connection management.
 */
export class RedisService {
  private static instance: RedisService;

  private constructor() {}

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  /**
   * Ensure Redis connection is ready for operations
   */
  async ensureConnection(): Promise<void> {
    const maxWaitTime = 5000; // 5 seconds max wait
    const startTime = Date.now();

    while (!this.isConnected() && (Date.now() - startTime) < maxWaitTime) {
      if (redisConnection.status === 'connecting') {
        // Wait a bit for connection to establish
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      if (redisConnection.status === 'end' || redisConnection.status === 'close') {
        try {
          await redisConnection.connect();
          break;
        } catch (error) {
          console.warn('🔄 Redis connection attempt failed, retrying...', error);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    if (!this.isConnected()) {
      throw new Error('Redis connection could not be established within timeout');
    }
  }

  /**
   * Check if Redis is connected and ready
   */
  isConnected(): boolean {
    return redisConnection.status === 'ready';
  }

  /**
   * Get connection state for monitoring
   */
  getConnectionState() {
    return isRedisConnected() ? 'connected' : 'disconnected';
  }

  /**
   * Safely get a value from Redis
   */
  async safeGet(key: string): Promise<string | null> {
    try {
      // If offline queue is enabled, this will queue the operation if disconnected
      const result = await redisConnection.get(key);
      return result;
    } catch (error) {
      console.warn(`[REDIS] Failed to get key "${key}":`, error);
      return null;
    }
  }

  /**
   * Safely set a value in Redis
   */
  async safeSet(key: string, value: string, ttl?: number): Promise<boolean> {
    try {
      if (ttl) {
        await redisConnection.setex(key, ttl, value);
      } else {
        await redisConnection.set(key, value);
      }
      return true;
    } catch (error) {
      console.warn(`[REDIS] Failed to set key "${key}":`, error);
      return false;
    }
  }

  /**
   * Safely set a value in Redis with expiration
   */
  async safeSetex(key: string, ttl: number, value: string): Promise<boolean> {
    try {
      await redisConnection.setex(key, ttl, value);
      return true;
    } catch (error) {
      console.warn(`[REDIS] Failed to setex key "${key}":`, error);
      return false;
    }
  }

  /**
   * Safely delete a key from Redis
   */
  async safeDel(key: string): Promise<boolean> {
    try {
      const result = await redisConnection.del(key);
      return result > 0;
    } catch (error) {
      console.warn(`[REDIS] Failed to delete key "${key}":`, error);
      return false;
    }
  }

  /**
   * Safely check if a key exists in Redis
   */
  async safeExists(key: string): Promise<boolean> {
    try {
      const result = await redisConnection.exists(key);
      return result === 1;
    } catch (error) {
      console.warn(`[REDIS] Failed to check existence of key "${key}":`, error);
      return false;
    }
  }

  /**
   * Get Redis operation result with detailed information
   */
  async getWithResult<T>(key: string, parser?: (value: string) => T): Promise<RedisOperationResult<T>> {
    try {
      const value = await redisConnection.get(key);
      
      if (value === null) {
        return {
          success: true,
          data: null,
          fromCache: false
        };
      }

      const parsedData = parser ? parser(value) : value as unknown as T;
      
      return {
        success: true,
        data: parsedData,
        fromCache: true
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error as Error,
        fromCache: false
      };
    }
  }

  /**
   * Health check for Redis connection
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      await redisConnection.ping();
      const latency = Date.now() - startTime;
      
      return {
        healthy: true,
        latency
      };
    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message
      };
    }
  }
}

// Export singleton instance
export const redisService = RedisService.getInstance();