/**
 * Robust caching layer for Gmail labels with TTL and version management
 * Eliminates slow sidebar loading by showing cached labels instantly
 */

interface Label {
  id: string;
  name: string;
  color: string;
  gmailLabelId: string;
  isCustom: boolean;
  emailCount: number;
  backgroundColor?: string;
  textColor?: string;
  mailboxId?: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
}

interface CachedLabelData {
  labels: Label[];
  timestamp: number;
  version: string;
  userId: string;
}

class LabelCache {
  private static readonly CACHE_KEY = 'clira-gmail-labels';
  private static readonly CACHE_VERSION = '1.0.0';
  private static readonly TTL_MS = 10 * 60 * 1000; // 10 minutes (labels change less frequently)
  private static readonly STALE_WHILE_REVALIDATE_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Get cached labels with freshness checks
   */
  static getCached(userId: string): {
    data: CachedLabelData | null;
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

      const parsedData: CachedLabelData = JSON.parse(cached);
      
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
      console.warn('LabelCache: Error reading cache:', error);
      this.invalidate();
      return { data: null, isFresh: false, isStale: false };
    }
  }

  /**
   * Store labels in cache
   */
  static setCached(userId: string, labels: Label[]): void {
    try {
      // Check if localStorage is available (browser environment)
      const storage = (globalThis as any)?.localStorage;
      if (!storage) {
        return;
      }
      
      const cacheData: CachedLabelData = {
        labels,
        timestamp: Date.now(),
        version: this.CACHE_VERSION,
        userId
      };

      storage.setItem(this.CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('LabelCache: Error writing cache:', error);
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
      console.warn('LabelCache: Error invalidating cache:', error);
    }
  }

  /**
   * Update specific label in cache without full refetch
   */
  static updateLabel(userId: string, updatedLabel: Label): boolean {
    const { data } = this.getCached(userId);
    if (!data) return false;

    try {
      const updatedLabels = data.labels.map(label => 
        label.id === updatedLabel.id ? updatedLabel : label
      );
      
      this.setCached(userId, updatedLabels);
      return true;
    } catch (error) {
      console.warn('LabelCache: Error updating label:', error);
      return false;
    }
  }

  /**
   * Add new label to cache
   */
  static addLabel(userId: string, newLabel: Label): boolean {
    const { data } = this.getCached(userId);
    if (!data) return false;

    try {
      const updatedLabels = [...data.labels, newLabel];
      this.setCached(userId, updatedLabels);
      return true;
    } catch (error) {
      console.warn('LabelCache: Error adding label:', error);
      return false;
    }
  }

  /**
   * Remove label from cache
   */
  static removeLabel(userId: string, labelId: string): boolean {
    const { data } = this.getCached(userId);
    if (!data) return false;

    try {
      const updatedLabels = data.labels.filter(label => label.id !== labelId);
      this.setCached(userId, updatedLabels);
      return true;
    } catch (error) {
      console.warn('LabelCache: Error removing label:', error);
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
    labelCount: number;
  } {
    const { data, isFresh, isStale } = this.getCached(userId);
    
    return {
      exists: !!data,
      age: data ? Date.now() - data.timestamp : 0,
      isFresh,
      isStale,
      version: data?.version || 'none',
      labelCount: data?.labels?.length || 0
    };
  }

  /**
   * Preload cache warmup - useful for background loading
   */
  static async warmupCache(userId: string): Promise<boolean> {
    try {
          const response = await fetch('/api/labels');
    const data = await response.json() as { success: boolean; labels?: Label[] };
    
    if (data.success && data.labels) {
      this.setCached(userId, data.labels);
        return true;
      }
      return false;
    } catch (error) {
      console.warn('LabelCache: Error warming up cache:', error);
      return false;
    }
  }
}

export { LabelCache };
export type { Label, CachedLabelData };
