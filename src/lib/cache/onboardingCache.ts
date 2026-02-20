/**
 * Robust caching layer for onboarding status with TTL and version management
 * Prevents unnecessary API calls while ensuring data freshness
 */

interface OnboardingStatus {
  masterPromptGenerated: boolean;
  labelingOnboardingGenerated: boolean;
  labelingOnboardingQualityGenerated: boolean;
}

interface CachedOnboardingData {
  status: OnboardingStatus;
  isOnboardingComplete: boolean;
  timestamp: number;
  version: string;
  userId: string;
}

class OnboardingCache {
  private static readonly CACHE_KEY = 'clira-onboarding-status';
  private static readonly CACHE_VERSION = '1.0.0';
  // Tight TTL because we also poll every 10s; this prevents stale banners
  private static readonly TTL_MS = 10 * 1000; // 10 seconds
  private static readonly STALE_WHILE_REVALIDATE_MS = 2 * 60 * 1000; // 2 minutes

  /**
   * Get cached onboarding status with freshness checks
   */
  static getCached(userId: string): {
    data: CachedOnboardingData | null;
    isFresh: boolean;
    isStale: boolean;
  } {
    try {
      // Check if localStorage is available (browser environment)
      const storage = (globalThis as any)?.localStorage;
      if (!storage) {
        return { data: null, isFresh: false, isStale: false };
      }
      
      const cached = storage.getItem(this.CACHE_KEY);
      if (!cached) {
        return { data: null, isFresh: false, isStale: false };
      }

      const parsedData: CachedOnboardingData = JSON.parse(cached);
      
      // Version check
      if (parsedData.version !== this.CACHE_VERSION) {
        this.invalidate();
        return { data: null, isFresh: false, isStale: false };
      }

      // User check
      if (parsedData.userId !== userId) {
        this.invalidate();
        return { data: null, isFresh: false, isStale: false };
      }

      const now = Date.now();
      const age = now - parsedData.timestamp;
      
      const isFresh = age < this.TTL_MS;
      const isStale = age > this.STALE_WHILE_REVALIDATE_MS;

      return {
        data: parsedData,
        isFresh,
        isStale
      };
    } catch (error) {
      console.warn('OnboardingCache: Error reading cache:', error);
      this.invalidate();
      return { data: null, isFresh: false, isStale: false };
    }
  }

  /**
   * Store onboarding status in cache
   */
  static setCached(userId: string, status: OnboardingStatus): void {
    try {
      const isOnboardingComplete = status.masterPromptGenerated && 
                                  status.labelingOnboardingGenerated;

      // Check if localStorage is available (browser environment)
      const storage = (globalThis as any)?.localStorage;
      if (!storage) {
        return;
      }
      
      const cacheData: CachedOnboardingData = {
        status,
        isOnboardingComplete,
        timestamp: Date.now(),
        version: this.CACHE_VERSION,
        userId
      };

      storage.setItem(this.CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('OnboardingCache: Error writing cache:', error);
    }
  }

  /**
   * Invalidate cache (useful for testing or forced refresh)
   */
  static invalidate(): void {
    try {
      // Check if localStorage is available (browser environment)
      const storage = (globalThis as any)?.localStorage;
      if (!storage) {
        return;
      }
      
      storage.removeItem(this.CACHE_KEY);
    } catch (error) {
      console.warn('OnboardingCache: Error invalidating cache:', error);
    }
  }

  /**
   * Update specific status fields without full refetch
   */
  static updateStatus(userId: string, updates: Partial<OnboardingStatus>): boolean {
    const { data } = this.getCached(userId);
    if (!data) return false;

    try {
      const updatedStatus = { ...data.status, ...updates };
      this.setCached(userId, updatedStatus);
      return true;
    } catch (error) {
      console.warn('OnboardingCache: Error updating status:', error);
      return false;
    }
  }

  /**
   * Get cache statistics for debugging
   */
  static getStats(userId: string): {
    exists: boolean;
    age: number;
    isFresh: boolean;
    isStale: boolean;
    version: string;
  } {
    const { data, isFresh, isStale } = this.getCached(userId);
    
    return {
      exists: !!data,
      age: data ? Date.now() - data.timestamp : 0,
      isFresh,
      isStale,
      version: data?.version || 'none'
    };
  }
}

export { OnboardingCache };
export type { OnboardingStatus, CachedOnboardingData };