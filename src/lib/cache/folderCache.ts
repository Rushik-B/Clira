/**
 * Folder cache for fast, instant UI on FolderManagementPage
 * - Stores lightweight folder metadata (no rules)
 * - Reuses LabelCache to synthesize instant placeholders when needed
 * - TTL + versioned with user scoping; safe in localStorage
 */

import { LabelCache } from './labelCache';
import { getFolderIconWithFallback } from '@/lib/utils/folderIconHelper';

export interface CachedFolderSummary {
  id: string;
  name: string;
  color: string;
  emailCount: number;
  isSystemDefault: boolean;
  instruction: string; // metaPrompt or fallback text
  mailboxId?: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
}

interface CachedFolderData {
  folders: CachedFolderSummary[];
  timestamp: number;
  version: string;
  userId: string;
}

class FolderCache {
  private static readonly CACHE_KEY = 'clira-folders';
  private static readonly CACHE_VERSION = '1.0.0';
  private static readonly TTL_MS = 3 * 60 * 1000; // 3 minutes
  private static readonly STALE_WHILE_REVALIDATE_MS = 30 * 60 * 1000; // 30 minutes

  static getCached(userId: string): {
    data: CachedFolderData | null;
    isFresh: boolean;
    isStale: boolean;
  } {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) return { data: null, isFresh: false, isStale: false };

      const raw = storage.getItem(this.CACHE_KEY);
      if (!raw) return { data: null, isFresh: false, isStale: false };

      const parsed: CachedFolderData = JSON.parse(raw);
      if (parsed.version !== this.CACHE_VERSION || parsed.userId !== userId) {
        this.invalidate();
        return { data: null, isFresh: false, isStale: false };
      }

      const age = Date.now() - parsed.timestamp;
      const isFresh = age < this.TTL_MS;
      const isStale = age > this.STALE_WHILE_REVALIDATE_MS;
      return { data: parsed, isFresh, isStale };
    } catch (err) {
      console.warn('FolderCache: read error', err);
      this.invalidate();
      return { data: null, isFresh: false, isStale: false };
    }
  }

  static setCached(userId: string, folders: CachedFolderSummary[]): void {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) return;

      const payload: CachedFolderData = {
        folders,
        timestamp: Date.now(),
        version: this.CACHE_VERSION,
        userId
      };

      storage.setItem(this.CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('FolderCache: write error', err);
    }
  }

  static invalidate(): void {
    try {
      const storage = (globalThis as any)?.localStorage;
      if (!storage) return;
      storage.removeItem(this.CACHE_KEY);
    } catch (err) {
      console.warn('FolderCache: invalidate error', err);
    }
  }

  /**
   * Build instant placeholders from LabelCache (no rules, basic instruction)
   * Useful when FolderCache is empty or stale, to render UI immediately.
   */
  static getPlaceholdersFromLabels(userId: string): CachedFolderSummary[] | null {
    const { data } = LabelCache.getCached(userId);
    if (!data?.labels) return null;

    return data.labels.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      emailCount: l.emailCount ?? 0,
      isSystemDefault: false,
      instruction: `Emails related to ${l.name}`,
      mailboxId: l.mailboxId,
      mailboxEmail: l.mailboxEmail,
      mailboxDisplayName: l.mailboxDisplayName,
    }));
  }

  /**
   * Fetch folders from API and cache minimal metadata.
   * Returns cached folder summaries for UI consumption.
   */
  static async warmupFromApi(userId: string): Promise<CachedFolderSummary[] | null> {
    try {
      const res = await fetch('/api/folders', { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return null;
      const json: any = await res.json();
      if (!json?.success || !Array.isArray(json.folders)) return null;

      const summaries: CachedFolderSummary[] = json.folders.map((f: any) => ({
        id: f.id,
        name: f.name,
        color: f.color,
        emailCount: f.emailCount || 0,
        isSystemDefault: !!f.isSystemDefault,
        instruction: f.metaPrompt ?? `Emails related to ${f.name}`,
        mailboxId: f.mailboxId,
        mailboxEmail: f.mailboxEmail,
        mailboxDisplayName: f.mailboxDisplayName,
      }));

      this.setCached(userId, summaries);
      return summaries;
    } catch (err) {
      console.warn('FolderCache: warmupFromApi error', err);
      return null;
    }
  }

  /**
   * Helper to convert cached summaries to the FolderManagementPage shape.
   * This keeps UI mapping logic centralized and cheap.
   */
  static toFolderData(summaries: CachedFolderSummary[]) {
    return summaries.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.instruction,
      instruction: f.instruction,
      color: f.color,
      icon: getFolderIconWithFallback(f.name, f.instruction),
      emailCount: f.emailCount,
      isSystemDefault: f.isSystemDefault,
      mailboxId: f.mailboxId,
      mailboxEmail: f.mailboxEmail,
      mailboxDisplayName: f.mailboxDisplayName,
      hardRules: [],
      examples: []
    }));
  }

  /**
   * Debugging stats
   */
  static getStats(userId: string) {
    const { data, isFresh, isStale } = this.getCached(userId);
    return {
      exists: !!data,
      age: data ? Date.now() - data.timestamp : 0,
      isFresh,
      isStale,
      version: data?.version || 'none',
      folderCount: data?.folders?.length || 0
    };
  }
}

export { FolderCache };
export type { CachedFolderData };
