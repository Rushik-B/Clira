/**
 * Queue cache for fast, instant UI on LabelQueuePage
 * - Stores label-specific queue data with 2-minute TTL
 * - User-scoped and versioned with safe localStorage operations
 * - Separate cache entries per label for optimal granularity
 * - Integrates with request coalescing to prevent duplicate API calls
 */

import { QueueItem } from '@/types';
import { FolderData } from '@/components/ui/folder-management/types';

export interface CachedQueueData {
  queueItems: QueueItem[];
  labelInfo: {
    id: string;
    name: string;
    color: string;
    metaPrompt?: string;
    gmailLabelId?: string;
    isSystemDefault: boolean;
    emailCount: number;
    icon: string;
    queueCount: number;
  };
  timestamp: number;
  version: string;
  userId: string;
  labelId: string;
}

interface CacheStats {
  exists: boolean;
  age: number;
  isFresh: boolean;
  isStale: boolean;
  version: string;
  itemCount: number;
}

class QueueCache {
  private static readonly CACHE_PREFIX = 'clira-queue';
  private static readonly CACHE_VERSION = '1.0.0';
  private static readonly TTL_MS = 2 * 60 * 1000; // 2 minutes - balance between freshness and performance
  private static readonly STALE_WHILE_REVALIDATE_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Generate cache key for specific label queue
   */
  private static getCacheKey(labelId: string): string {
    return `${this.CACHE_PREFIX}-${labelId}`;
  }

  /**
   * Get cached queue data for specific label with freshness checks
   */
  static getCached(userId: string, labelId: string): {
    data: CachedQueueData | null;
    isFresh: boolean;
    isStale: boolean;
  } {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) {
        return { data: null, isFresh: false, isStale: false };
      }

      const cacheKey = this.getCacheKey(labelId);
      const cached = storage.getItem(cacheKey);
      if (!cached) {
        return { data: null, isFresh: false, isStale: false };
      }

      const parsedData: CachedQueueData = JSON.parse(cached);

      // Version check
      if (parsedData.version !== this.CACHE_VERSION) {
        this.invalidateLabel(labelId);
        return { data: null, isFresh: false, isStale: false };
      }

      // User check
      if (parsedData.userId !== userId) {
        this.invalidateLabel(labelId);
        return { data: null, isFresh: false, isStale: false };
      }

      // Label ID check (additional safety)
      if (parsedData.labelId !== labelId) {
        this.invalidateLabel(labelId);
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
      console.warn('QueueCache: Error reading cache for label', labelId, error);
      this.invalidateLabel(labelId);
      return { data: null, isFresh: false, isStale: false };
    }
  }

  /**
   * Store queue data in cache for specific label
   */
  static setCached(
    userId: string, 
    labelId: string, 
    queueItems: QueueItem[], 
    labelInfo: CachedQueueData['labelInfo']
  ): void {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) return;

      const cacheData: CachedQueueData = {
        queueItems,
        labelInfo,
        timestamp: Date.now(),
        version: this.CACHE_VERSION,
        userId,
        labelId
      };

      const cacheKey = this.getCacheKey(labelId);
      storage.setItem(cacheKey, JSON.stringify(cacheData));
      
      console.log(`🚀 QueueCache: Cached ${queueItems.length} items for label ${labelInfo.name} (${labelId})`);
    } catch (error) {
      console.warn('QueueCache: Error writing cache for label', labelId, error);
    }
  }

  /**
   * Invalidate cache for specific label
   */
  static invalidateLabel(labelId: string): void {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) return;

      const cacheKey = this.getCacheKey(labelId);
      storage.removeItem(cacheKey);
      console.log(`🗑️ QueueCache: Invalidated cache for label ${labelId}`);
    } catch (error) {
      console.warn('QueueCache: Error invalidating cache for label', labelId, error);
    }
  }

  /**
   * Invalidate all queue caches for user (useful after major actions)
   */
  static invalidateAll(): void {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) return;

      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(this.CACHE_PREFIX)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => storage.removeItem(key));
      console.log(`🗑️ QueueCache: Invalidated all queue caches (${keysToRemove.length} entries)`);
    } catch (error) {
      console.warn('QueueCache: Error invalidating all caches:', error);
    }
  }

  /**
   * Update queue item status in cache (for optimistic updates)
   */
  static updateItemStatus(
    userId: string, 
    labelId: string, 
    itemId: string, 
    updates: Partial<QueueItem>
  ): boolean {
    const { data } = this.getCached(userId, labelId);
    if (!data) return false;

    try {
      const updatedQueueItems = data.queueItems.map(item =>
        item.id === itemId ? { ...item, ...updates } : item
      );

      this.setCached(userId, labelId, updatedQueueItems, data.labelInfo);
      return true;
    } catch (error) {
      console.warn('QueueCache: Error updating item status:', error);
      return false;
    }
  }

  /**
   * Remove queue item from cache (for immediate UI feedback)
   */
  static removeItem(userId: string, labelId: string, itemId: string): boolean {
    const { data } = this.getCached(userId, labelId);
    if (!data) return false;

    try {
      const updatedQueueItems = data.queueItems.filter(item => item.id !== itemId);
      const updatedLabelInfo = {
        ...data.labelInfo,
        queueCount: updatedQueueItems.length
      };

      this.setCached(userId, labelId, updatedQueueItems, updatedLabelInfo);
      console.log(`🗑️ QueueCache: Removed item ${itemId} from label ${labelId}`);
      return true;
    } catch (error) {
      console.warn('QueueCache: Error removing item:', error);
      return false;
    }
  }

  /**
   * Get cache statistics for debugging and monitoring
   */
  static getStats(userId: string, labelId: string): CacheStats {
    const { data, isFresh, isStale } = this.getCached(userId, labelId);

    return {
      exists: !!data,
      age: data ? Date.now() - data.timestamp : 0,
      isFresh,
      isStale,
      version: data?.version || 'none',
      itemCount: data?.queueItems?.length || 0
    };
  }

  /**
   * Get cache statistics for all labels (useful for global cache health monitoring)
   */
  static getAllStats(): { [labelId: string]: CacheStats } {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) return {};

      const stats: { [labelId: string]: CacheStats } = {};
      
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(this.CACHE_PREFIX)) {
          try {
            const cached = storage.getItem(key);
            if (cached) {
              const data: CachedQueueData = JSON.parse(cached);
              const labelId = data.labelId;
              const age = Date.now() - data.timestamp;
              
              stats[labelId] = {
                exists: true,
                age,
                isFresh: age < this.TTL_MS,
                isStale: age > this.STALE_WHILE_REVALIDATE_MS,
                version: data.version,
                itemCount: data.queueItems.length
              };
            }
          } catch (parseError) {
            // Skip invalid cache entries
            continue;
          }
        }
      }

      return stats;
    } catch (error) {
      console.warn('QueueCache: Error getting all stats:', error);
      return {};
    }
  }

  /**
   * Preload cache for commonly accessed labels (performance optimization)
   */
  static async warmupCache(userId: string, labelIds: string[]): Promise<void> {
    console.log(`🔥 QueueCache: Warming up cache for ${labelIds.length} labels`);
    
    const warmupPromises = labelIds.map(async (labelId) => {
      try {
        const { isFresh } = this.getCached(userId, labelId);
        if (isFresh) return; // Skip if already fresh

        // Fetch fresh data in background
        const response = await fetch(`/api/queue/${labelId}`, {
          headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (response.ok) {
                  const data = await response.json() as any;
        if (data?.success && data?.queueItems && data?.labelInfo) {
          this.setCached(userId, labelId, data.queueItems, data.labelInfo);
        }
        }
      } catch (error) {
        console.warn(`QueueCache: Error warming up cache for label ${labelId}:`, error);
      }
    });

    await Promise.allSettled(warmupPromises);
  }
}

export { QueueCache };
export type { CacheStats };