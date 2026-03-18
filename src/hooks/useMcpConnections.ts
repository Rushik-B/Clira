'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  reconcileSyncingConnectionIds,
  type McpConnectionSummary,
} from '@/lib/services/mcp/ui';

const FAST_REFRESH_INTERVAL_MS = 2_000;

type FetchOptions = {
  background?: boolean;
  manual?: boolean;
};

type ConnectionsResponse = {
  success?: boolean;
  connections?: McpConnectionSummary[];
  error?: string;
};

export function useMcpConnections() {
  const [connections, setConnections] = useState<McpConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );

  const hasLoadedRef = useRef(false);
  const requestSeqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const syncRequestedAtRef = useRef(new Map<string, number>());

  const fetchConnections = useCallback(async (options?: FetchOptions) => {
    const requestId = ++requestSeqRef.current;
    const background = options?.background ?? hasLoadedRef.current;
    const manual = options?.manual ?? false;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (!background) {
      setLoading(true);
    }
    if (manual) {
      setManualRefreshing(true);
    }

    try {
      const response = await fetch('/api/mcp/connections', {
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = (await response.json()) as ConnectionsResponse;

      if (controller.signal.aborted || requestId !== requestSeqRef.current) {
        return;
      }

      if (!response.ok || !data.success) {
        setError(data.error ?? 'Failed to load connections.');
        return;
      }

      const nextConnections = data.connections ?? [];
      hasLoadedRef.current = true;
      setError('');
      setConnections(nextConnections);
      setSyncingIds((currentSyncingIds) => {
        const nextSyncingIds = reconcileSyncingConnectionIds(
          currentSyncingIds,
          nextConnections,
          syncRequestedAtRef.current,
        );

        for (const connectionId of currentSyncingIds) {
          if (!nextSyncingIds.has(connectionId)) {
            syncRequestedAtRef.current.delete(connectionId);
          }
        }

        return nextSyncingIds;
      });
    } catch (fetchError) {
      if (controller.signal.aborted || requestId !== requestSeqRef.current) {
        return;
      }

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return;
      }

      setError('Network error loading connections.');
    } finally {
      if (requestId !== requestSeqRef.current) {
        return;
      }

      setLoading(false);
      if (manual) {
        setManualRefreshing(false);
      }
      hasLoadedRef.current = true;
    }
  }, []);

  const refreshConnections = useCallback(
    (options?: { manual?: boolean }) =>
      fetchConnections({ background: true, manual: options?.manual ?? false }),
    [fetchConnections],
  );

  const requestSync = useCallback(async (connectionId: string) => {
    const requestedAt = Date.now();
    syncRequestedAtRef.current.set(connectionId, requestedAt);
    setSyncingIds((currentSyncingIds) => {
      const nextSyncingIds = new Set(currentSyncingIds);
      nextSyncingIds.add(connectionId);
      return nextSyncingIds;
    });

    try {
      const response = await fetch('/api/mcp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Failed to enqueue MCP sync.');
      }

      await fetchConnections({ background: true });
      return { success: true as const };
    } catch (syncError) {
      syncRequestedAtRef.current.delete(connectionId);
      setSyncingIds((currentSyncingIds) => {
        const nextSyncingIds = new Set(currentSyncingIds);
        nextSyncingIds.delete(connectionId);
        return nextSyncingIds;
      });
      setError(syncError instanceof Error ? syncError.message : 'Failed to enqueue MCP sync.');
      return { success: false as const };
    }
  }, [fetchConnections]);

  useEffect(() => {
    void fetchConnections();

    return () => {
      controllerRef.current?.abort();
    };
  }, [fetchConnections]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') {
        void fetchConnections({ background: true });
      }
    };

    const refreshOnVisible = () => {
      const visible = document.visibilityState === 'visible';
      setIsPageVisible(visible);
      if (visible) {
        void fetchConnections({ background: true });
      }
    };

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisible);

    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [fetchConnections]);

  const hasUnsettledConnections = useMemo(
    () => connections.some((connection) => connection.status === 'pending') || syncingIds.size > 0,
    [connections, syncingIds],
  );

  useEffect(() => {
    if (!isPageVisible || !hasUnsettledConnections) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchConnections({ background: true });
    }, FAST_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchConnections, hasUnsettledConnections, isPageVisible]);

  return {
    connections,
    error,
    loading,
    manualRefreshing,
    syncingIds,
    refreshConnections,
    requestSync,
  };
}
