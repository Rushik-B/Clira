/**
 * Simple Rate Limiter Utility
 *
 * Provides controlled execution pacing without using setTimeout for flow control.
 * Uses a queue-based approach with explicit delay tracking.
 */

interface RateLimiterConfig {
  /** Minimum milliseconds between operations */
  delayMs: number;
}

/**
 * Simple rate limiter that ensures minimum delay between operations
 */
export class RateLimiter {
  private lastExecutionTime: number = 0;
  private readonly delayMs: number;

  constructor(config: RateLimiterConfig) {
    this.delayMs = config.delayMs;
  }

  /**
   * Wait if necessary to maintain the rate limit
   * Returns immediately if enough time has passed since last execution
   */
  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastExecution = now - this.lastExecutionTime;
    const timeToWait = Math.max(0, this.delayMs - timeSinceLastExecution);

    if (timeToWait > 0) {
      await this.sleep(timeToWait);
    }

    this.lastExecutionTime = Date.now();
  }

  /**
   * Execute a function with rate limiting applied
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.wait();
    return fn();
  }

  /**
   * Simple sleep implementation using Promise
   * Encapsulated here so it's only used internally by the rate limiter
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Store timer ref for potential cleanup if needed
      timer.unref?.(); // Allow process to exit if this is the only thing running
    });
  }

  /**
   * Reset the rate limiter (useful for testing or restarting operations)
   */
  reset(): void {
    this.lastExecutionTime = 0;
  }
}

/**
 * Create a rate limiter with sensible defaults for API calls
 */
export function createApiRateLimiter(delayMs: number = 100): RateLimiter {
  return new RateLimiter({ delayMs });
}
