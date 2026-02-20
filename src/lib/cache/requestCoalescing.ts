/**
 * Request coalescing utility to prevent duplicate concurrent requests
 * 
 * When multiple components make the same API call simultaneously,
 * this utility ensures only one actual request is made and all
 * callers receive the same response.
 */

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

class RequestCoalescer {
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private readonly TTL = 5000; // 5 seconds TTL for coalescing

  /**
   * Coalesce requests with the same key
   * If a request with the same key is already pending, return that promise
   * Otherwise, execute the request function and cache the promise
   */
  async coalesce<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    // Clean up expired requests
    this.cleanup();

    // Check if we already have a pending request for this key
    const existing = this.pendingRequests.get(key);
    if (existing) {
      console.log(`🔄 Request coalescing: Reusing existing request for ${key}`);
      return existing.promise;
    }

    console.log(`🚀 Request coalescing: Starting new request for ${key}`);

    // Create new request
    const promise = requestFn().finally(() => {
      // Remove from cache when completed (success or failure)
      this.pendingRequests.delete(key);
    });

    // Cache the promise
    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now()
    });

    return promise;
  }

  /**
   * Clean up expired requests
   */
  private cleanup() {
    const now = Date.now();
    for (const [key, request] of this.pendingRequests) {
      if (now - request.timestamp > this.TTL) {
        console.log(`🧹 Request coalescing: Cleaning up expired request for ${key}`);
        this.pendingRequests.delete(key);
      }
    }
  }

  /**
   * Clear all pending requests (useful for testing)
   */
  clear() {
    this.pendingRequests.clear();
  }

  /**
   * Get current cache status (useful for debugging)
   */
  getStatus() {
    return {
      pendingCount: this.pendingRequests.size,
      pendingKeys: Array.from(this.pendingRequests.keys())
    };
  }
}

// Global instance for request coalescing
export const requestCoalescer = new RequestCoalescer();

/**
 * Helper function for API endpoints to use request coalescing
 * 
 * @param userId - User ID to scope the request
 * @param requestType - Type of request (e.g., 'labels', 'folders')
 * @param requestFn - Function that performs the actual request
 */
export async function coalesceApiRequest<T>(
  userId: string,
  requestType: string,
  requestFn: () => Promise<T>
): Promise<T> {
  const key = `${userId}:${requestType}`;
  return requestCoalescer.coalesce(key, requestFn);
}

