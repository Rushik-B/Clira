'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { LabelCache, type Label } from '@/lib/cache/labelCache';

export function useFolderManagement() {
  const { data: session } = useSession();
  const [labels, setLabels] = useState<Label[]>([]);
  const loading = false; // Never show loading states for instant label display
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);

  // Refs for cleanup and preventing duplicate calls
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const hasInitializedRef = useRef(false);

  /**
   * Fetch labels from API with intelligent caching
   * @param userId - User identifier for cache operations
   * @param silent - If true, don't show loading states (background refresh)
   */
  const fetchLabels = useCallback(async (userId: string, silent = false) => {
    // Generate unique request ID to prevent React StrictMode duplicates
    const requestId = Math.random().toString(36).substring(2, 11);
    
    // Prevent duplicate concurrent calls
    if (isFetchingRef.current) {
      console.log('🏷️ useFolderManagement: Already fetching, skipping duplicate call');
      return;
    }
    
    // Additional StrictMode protection
    if (requestIdRef.current === requestId) {
      console.log('🏷️ useFolderManagement: Duplicate request ID detected, skipping');
      return;
    }
    
    try {
      // Set fetch state
      requestIdRef.current = requestId;
      isFetchingRef.current = true;
      
      // Only show refresh indicator for background updates
      if (silent) {
        setIsRefreshing(true);
      }
      // Never show loading states for labels
      
      // Clear any previous errors
      setError(null);
      
      // Create AbortController for request cancellation
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      
      console.log(`🏷️ useFolderManagement: Fetching labels${silent ? ' (background)' : ''}`, requestId);
      
      const response = await fetch('/api/labels', {
        signal: abortController.signal
      });
      
      // Check for request cancellation
      if (abortController.signal.aborted) {
        console.log('🏷️ useFolderManagement: Request cancelled', requestId);
        return;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (abortController.signal.aborted) {
        console.log('🏷️ useFolderManagement: Request cancelled during processing', requestId);
        return;
      }
      
      if (data.success) {
        const fetchedLabels: Label[] = data.labels || [];
        
        // Update React state
        setLabels(fetchedLabels);
        setLastFetchTime(Date.now());
        setError(null);
        
        // Cache the fresh data
        LabelCache.setCached(userId, fetchedLabels);
        
        console.log(`🏷️ useFolderManagement: Successfully ${silent ? 'refreshed' : 'fetched'} labels`, requestId, { 
          labelCount: fetchedLabels.length,
          cached: true 
        });
      } else {
        const errorMessage = data.error || 'Failed to fetch labels';
        setError(errorMessage);
        console.warn('🏷️ useFolderManagement: API error:', errorMessage, requestId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('🏷️ useFolderManagement: Request was aborted', requestId);
        return;
      }
      
      const errorMessage = 'Failed to fetch labels';
      console.error('🏷️ useFolderManagement: Error fetching labels:', error, requestId);
      
      // On error during background refresh, keep using cached data
      if (silent) {
        console.log('🏷️ useFolderManagement: Background refresh failed, keeping cached labels');
      } else {
        setError(errorMessage);
      }
    } finally {
      // Always clean up refresh state and references
      setIsRefreshing(false);
      
      // Clear abort controller if not already aborted
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        abortControllerRef.current = null;
      }
      
      requestIdRef.current = null;
      isFetchingRef.current = false;
    }
  }, []); // Intentionally no dependencies to prevent infinite loops

  /**
   * Initialize state from cache and determine if background fetch is needed
   * This implements the cache-first strategy with intelligent refresh logic
   */
  const initializeFromCache = useCallback((userId: string) => {
    // Prevent multiple initializations
    if (hasInitializedRef.current) {
      console.log('🏷️ useFolderManagement: Already initialized, skipping');
      return;
    }
    
    const { data, isFresh, isStale } = LabelCache.getCached(userId);
    
    if (data) {
      // Load cached data immediately - instant sidebar population!
      setLabels(data.labels);
      setLastFetchTime(data.timestamp);
      setError(null);
      
      console.log('🏷️ useFolderManagement: Loaded from cache', { 
        isFresh, 
        isStale, 
        age: Date.now() - data.timestamp,
        labelCount: data.labels.length,
        cacheVersion: data.version
      });
      
      // Intelligent refresh strategy based on cache age
      if (!isFresh && !isStale) {
        // Data is somewhat old but not stale - background refresh
        console.log('🏷️ useFolderManagement: Triggering background refresh');
        fetchLabels(userId, true);
      } else if (isStale) {
        // Data is very old - visible refresh
        console.log('🏷️ useFolderManagement: Data is stale, triggering visible refresh');
        fetchLabels(userId, false);
      }
      // If isFresh is true, no refresh needed at all
    } else {
      // No cache exists - need to fetch
      console.log('🏷️ useFolderManagement: No cache found, fetching from server');
      fetchLabels(userId, false);
    }
    
    hasInitializedRef.current = true;
  }, [fetchLabels]);

  // Main effect - initialize on session change
  useEffect(() => {
    let isMounted = true;
    
    // Reset initialization flag when session changes
    hasInitializedRef.current = false;
    
    if (!session?.user?.email) {
      if (isMounted) {
        setLabels([]);
        setError(null);
      }
      return () => { isMounted = false; };
    }

    // Initialize from cache immediately
    if (isMounted) {
      initializeFromCache(session.user.email);
    }
    
    return () => {
      isMounted = false;
      
      // Cancel any ongoing requests on cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      requestIdRef.current = null;
      isFetchingRef.current = false;
    };
  }, [session?.user?.email, initializeFromCache]);

  /**
   * Force refresh from server (invalidates cache completely)
   */
  const forceRefresh = useCallback(() => {
    if (!session?.user?.email) return;
    
    console.log('🏷️ useFolderManagement: Force refresh requested');
    LabelCache.invalidate();
    hasInitializedRef.current = false;
    fetchLabels(session.user.email, false);
  }, [session?.user?.email, fetchLabels]);

  /**
   * Regular refetch (respects cache)
   */
  const refetch = useCallback(() => {
    if (session?.user?.email) {
      fetchLabels(session.user.email, false);
    }
  }, [session?.user?.email, fetchLabels]);

  /**
   * Optimistically update a label in cache and state
   */
  const updateLabel = useCallback((updatedLabel: Label) => {
    if (!session?.user?.email) return false;
    
    // Optimistic UI update
    setLabels(currentLabels => 
      currentLabels.map(label => 
        label.id === updatedLabel.id ? updatedLabel : label
      )
    );
    
    // Update cache
    const cacheSuccess = LabelCache.updateLabel(session.user.email, updatedLabel);
    
    console.log('🏷️ useFolderManagement: Optimistic label update', { 
      labelId: updatedLabel.id, 
      cacheSuccess 
    });
    
    return cacheSuccess;
  }, [session?.user?.email]);

  /**
   * Optimistically add a new label
   */
  const addLabel = useCallback((newLabel: Label) => {
    if (!session?.user?.email) return false;
    
    // Optimistic UI update
    setLabels(currentLabels => [...currentLabels, newLabel]);
    
    // Update cache
    const cacheSuccess = LabelCache.addLabel(session.user.email, newLabel);
    
    console.log('🏷️ useFolderManagement: Optimistic label add', { 
      labelId: newLabel.id, 
      cacheSuccess 
    });
    
    return cacheSuccess;
  }, [session?.user?.email]);

  /**
   * Optimistically remove a label
   */
  const removeLabel = useCallback((labelId: string) => {
    if (!session?.user?.email) return false;
    
    // Optimistic UI update
    setLabels(currentLabels => currentLabels.filter(label => label.id !== labelId));
    
    // Update cache
    const cacheSuccess = LabelCache.removeLabel(session.user.email, labelId);
    
    console.log('🏷️ useFolderManagement: Optimistic label remove', { 
      labelId, 
      cacheSuccess 
    });
    
    return cacheSuccess;
  }, [session?.user?.email]);

  // Public API
  return {
    // State
    labels,
    loading,
    isRefreshing,
    error,
    lastFetchTime,
    
    // Actions
    refetch,
    forceRefresh,
    updateLabel,
    addLabel,
    removeLabel,
    
    // Debug info
    cacheStats: session?.user?.email ? LabelCache.getStats(session.user.email) : null
  };
}