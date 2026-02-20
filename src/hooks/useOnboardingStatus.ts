import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { OnboardingCache, type OnboardingStatus } from '@/lib/cache/onboardingCache';

export const useOnboardingStatus = () => {
  const { data: session } = useSession();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);
  
  // Refs for cleanup and preventing duplicate calls
  const statusRef = useRef<OnboardingStatus | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  /**
   * Fetch onboarding status from API with intelligent caching
   * @param userId - User identifier for cache operations
   * @param silent - If true, don't show loading states (background refresh)
   */
  const fetchOnboardingStatus = useCallback(async (userId: string, silent = false) => {
    // Generate unique request ID to prevent React StrictMode duplicates
    const requestId = Math.random().toString(36).substring(2, 11);
    
    // Prevent duplicate concurrent calls
    if (isFetchingRef.current) {
      console.log('🔄 useOnboardingStatus: Already fetching, skipping duplicate call');
      return;
    }
    
    // Additional StrictMode protection
    if (requestIdRef.current === requestId) {
      console.log('🔄 useOnboardingStatus: Duplicate request ID detected, skipping');
      return;
    }
    
    try {
      // Set fetch state
      requestIdRef.current = requestId;
      isFetchingRef.current = true;
      
      // Manage loading states intelligently
      if (!silent) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      
      // Create AbortController for request cancellation
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      
      console.log(`🔄 useOnboardingStatus: Fetching onboarding status${silent ? ' (background)' : ''}`, requestId);
      
      const response = await fetch('/api/user/onboarding-status', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache',
          'X-No-Cache': '1'
        },
        signal: abortController.signal
      });
      
      // Check for request cancellation
      if (abortController.signal.aborted) {
        console.log('🔄 useOnboardingStatus: Request cancelled', requestId);
        return;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (abortController.signal.aborted) {
        console.log('🔄 useOnboardingStatus: Request cancelled during processing', requestId);
        return;
      }
      
      if (data.success && data.user) {
        const userStatus: OnboardingStatus = {
          masterPromptGenerated: data.user.masterPromptGenerated,
          labelingOnboardingGenerated: data.user.labelingOnboardingGenerated,
          labelingOnboardingQualityGenerated: data.user.labelingOnboardingQualityGenerated,
        };
        
        // Update React state
        setStatus(userStatus);
        setLastFetchTime(Date.now());
        
        // Calculate completion status
        const isComplete = userStatus.masterPromptGenerated && 
                          userStatus.labelingOnboardingGenerated;
        
        setIsOnboardingComplete(isComplete);
        
        // Cache the fresh data
        OnboardingCache.setCached(userId, userStatus);
        
        console.log(`🔄 useOnboardingStatus: Successfully ${silent ? 'refreshed' : 'fetched'} status`, requestId, { 
          isComplete,
          cached: true 
        });
      } else {
        console.warn('🔄 useOnboardingStatus: Invalid response format', requestId, data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('🔄 useOnboardingStatus: Request was aborted', requestId);
        return;
      }
      
      console.error('🔄 useOnboardingStatus: Error fetching onboarding status:', error, requestId);
      
      // On error during background refresh, keep using cached data
      if (silent) {
        console.log('🔄 useOnboardingStatus: Background refresh failed, keeping any existing data');
      }
    } finally {
      // Always clean up loading states and references
      setLoading(false);
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
   * Ensure background polling is running until onboarding is complete
   */
  const ensurePolling = useCallback((userId: string) => {
    // Do not start polling if already complete
    if (isOnboardingComplete) return;
    // Avoid duplicate intervals
    if (pollIntervalRef.current !== null) return;
    // Poll every 10 seconds in background until completion
    pollIntervalRef.current = window.setInterval(() => {
      // Silent refresh to avoid UI flicker
      fetchOnboardingStatus(userId, true);
    }, 10000) as unknown as number;
  }, [fetchOnboardingStatus, isOnboardingComplete]);

  /**
   * Stop polling helper
   */
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  /**
   * Initialize state from cache and determine if background fetch is needed
   * This implements the cache-first strategy with conservative refresh logic
   */
  const initializeFromCache = useCallback((userId: string) => {
    // Prevent multiple initializations and ensure we're not already fetching
    if (hasInitializedRef.current || isFetchingRef.current) {
      console.log('🏃‍♂️ useOnboardingStatus: Already initialized or fetching, skipping');
      return;
    }
    
    // IMPORTANT: If we already have complete status in state, don't refetch
    const currentStatus = statusRef.current;
    if (currentStatus && 
        currentStatus.labelingOnboardingGenerated === true &&
        currentStatus.masterPromptGenerated === true) {
      console.log('🏃‍♂️ useOnboardingStatus: Already have complete status, skipping fetch');
      hasInitializedRef.current = true;
      return;
    }
    
    const { data, isFresh, isStale } = OnboardingCache.getCached(userId);
    
    if (data) {
      // Load cached data immediately - this eliminates the loading screen!
      setStatus(data.status);
      setIsOnboardingComplete(data.isOnboardingComplete);
      setLastFetchTime(data.timestamp);
      setLoading(false); // Critical: Set loading to false since we have data
      
      console.log('🏃‍♂️ useOnboardingStatus: Loaded from cache', { 
        isFresh, 
        isStale, 
        age: Date.now() - data.timestamp,
        cacheVersion: data.version
      });
      
      // Kick off background polling if not complete
      if (!data.isOnboardingComplete) {
        ensurePolling(userId);
        // For stale data, also do an immediate visible refresh
        if (isStale) {
          console.log('🏃‍♂️ useOnboardingStatus: Data is stale, triggering refresh');
          fetchOnboardingStatus(userId, false);
        }
      }
    } else {
      // No cache exists - need to fetch
      console.log('🏃‍♂️ useOnboardingStatus: No cache found, fetching from server');
      fetchOnboardingStatus(userId, false);
      ensurePolling(userId);
    }
    
    hasInitializedRef.current = true;
  }, [fetchOnboardingStatus, ensurePolling]);

  // Main effect - initialize on session change
  useEffect(() => {
    let isMounted = true;
    
    // Reset initialization flag when session changes
    hasInitializedRef.current = false;
    
    // Also cancel any ongoing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    isFetchingRef.current = false;
    
    if (!session?.userId) {
      if (isMounted) {
        setLoading(false);
        setStatus(null);
        setIsOnboardingComplete(false);
      }
      stopPolling();
      return () => { isMounted = false; };
    }

    // Skip initialization if on manual onboarding flow
    const isOnManualOnboardingFlow = typeof window !== 'undefined' && 
      window.location.pathname.startsWith('/onboarding-test-flow');
    
    if (isOnManualOnboardingFlow) {
      console.log('🏃‍♂️ useOnboardingStatus: On onboarding flow, skipping status check');
      if (isMounted) {
        setLoading(false);
        setStatus(null); // Clear any existing status
        setIsOnboardingComplete(false);
      }
      stopPolling();
      return () => { isMounted = false; };
    }
    
    // CRITICAL: If user is already fully onboarded, don't keep checking
    const cachedData = OnboardingCache.getCached(session.userId);
    if (cachedData?.data?.status && 
        cachedData.data.status.labelingOnboardingGenerated === true &&
        cachedData.data.status.masterPromptGenerated === true) {
      console.log('🏃‍♂️ useOnboardingStatus: User fully onboarded, using cache only');
      if (isMounted) {
        setStatus(cachedData.data.status);
        setIsOnboardingComplete(true);
        setLoading(false);
        setLastFetchTime(cachedData.data.timestamp);
      }
      stopPolling();
      return () => { isMounted = false; };
    }

    // Initialize from cache immediately
    if (isMounted) {
      initializeFromCache(session.userId);
    }
    ensurePolling(session.userId);
    
    return () => {
      isMounted = false;
      
      // Cancel any ongoing requests on cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      requestIdRef.current = null;
      isFetchingRef.current = false;
      stopPolling();
    };
  }, [session?.userId, initializeFromCache, ensurePolling, stopPolling]);

  /**
   * Force refresh from server (invalidates cache completely) - USE SPARINGLY
   */
  const forceRefresh = useCallback(() => {
    if (!session?.userId) return;
    
    // Prevent force refresh if already fetching to avoid loops
    if (isFetchingRef.current) {
      console.log('🔄 useOnboardingStatus: Force refresh skipped - already fetching');
      return;
    }
    
    console.log('🔄 useOnboardingStatus: Force refresh requested');
    OnboardingCache.invalidate();
    hasInitializedRef.current = false;
    fetchOnboardingStatus(session.userId, false);
    ensurePolling(session.userId);
  }, [session?.userId, fetchOnboardingStatus, ensurePolling]);

  /**
   * Optimistically update a specific status field (with cache sync)
   */
  const updateStatus = useCallback((updates: Partial<OnboardingStatus>) => {
    const userId = session?.userId;
    const currentStatus = statusRef.current;
    if (!userId || !currentStatus) return false;
    
    const updatedStatus = { ...currentStatus, ...updates };
    statusRef.current = updatedStatus;
    
    // Optimistic UI update
    setStatus(updatedStatus);
    
    // Update cache
    const cacheSuccess = OnboardingCache.updateStatus(userId, updates);
    
    // Recalculate completion status
    const isComplete = updatedStatus.masterPromptGenerated && 
                      updatedStatus.labelingOnboardingGenerated;
    
    setIsOnboardingComplete(isComplete);
    
    console.log('🔄 useOnboardingStatus: Optimistic update applied', { 
      updates, 
      cacheSuccess, 
      newCompletionStatus: isComplete 
    });
    
    return cacheSuccess;
  }, [session?.userId]);

  // Public API
  return {
    // State
    status,
    loading,
    isOnboardingComplete,
    isRefreshing,
    lastFetchTime,
    
    // Actions
    refetch: useCallback(() => {
      if (session?.userId) {
        fetchOnboardingStatus(session.userId, false);
      }
    }, [session?.userId, fetchOnboardingStatus]),
    
    forceRefresh,
    updateStatus,
    
    // Debug info
    cacheStats: session?.userId ? OnboardingCache.getStats(session.userId) : null
  };
};
