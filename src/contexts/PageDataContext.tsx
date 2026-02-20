'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface PageData {
  queueItems?: any[];
  historyItems?: any[];
  voiceRulesData?: any;
  metricsData?: any;
  settingsData?: any;
  foldersData?: any;
  lastFetch: number;
}

interface PageLoadingState {
  queue: boolean;
  history: boolean;
  voice: boolean;
  metrics: boolean;
  settings: boolean;
  folders: boolean;
  feedback: boolean;
}

interface PageDataContextType {
  pageData: Record<string, PageData>;
  loadingStates: PageLoadingState;
  setPageLoading: (page: keyof PageLoadingState, loading: boolean) => void;
  cachePageData: <T>(page: string, data: T, ttl?: number) => void;
  getCachedData: <T>(page: string, maxAge?: number) => T | null;
  clearPageCache: (page?: string) => void;
}

const PageDataContext = createContext<PageDataContextType | null>(null);

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const PAGE_TTL = {
  queue: 2 * 60 * 1000,     // 2 minutes - frequently changing
  history: 10 * 60 * 1000,  // 10 minutes - less frequently changing
  voice: 30 * 60 * 1000,    // 30 minutes - rarely changes
  metrics: 5 * 60 * 1000,   // 5 minutes - moderate changes
  settings: 30 * 60 * 1000, // 30 minutes - rarely changes
  folders: 10 * 60 * 1000,  // 10 minutes - moderate changes
};

export const PageDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [pageData, setPageData] = useState<Record<string, PageData>>({});
  const [loadingStates, setLoadingStates] = useState<PageLoadingState>({
    queue: false,
    history: false,
    voice: false,
    metrics: false,
    settings: false,
    folders: false,
    feedback: false,
  });

  const setPageLoading = useCallback((page: keyof PageLoadingState, loading: boolean) => {
    setLoadingStates(prev => ({ ...prev, [page]: loading }));
  }, []);

  const cachePageData = useCallback(<T,>(page: string, data: T, ttl?: number) => {
    const expiryTime = Date.now() + (ttl || PAGE_TTL[page as keyof typeof PAGE_TTL] || DEFAULT_TTL);
    setPageData(prev => ({
      ...prev,
      [page]: {
        ...data,
        lastFetch: Date.now(),
        expiry: expiryTime
      }
    }));
  }, []);

  const getCachedData = useCallback(<T,>(page: string, maxAge?: number): T | null => {
    const cached = pageData[page];
    if (!cached) return null;

    const age = Date.now() - cached.lastFetch;
    const maxAgeLimit = maxAge || PAGE_TTL[page as keyof typeof PAGE_TTL] || DEFAULT_TTL;
    
    if (age > maxAgeLimit) {
      // Data is stale
      return null;
    }

    return cached as T;
  }, [pageData]);

  const clearPageCache = useCallback((page?: string) => {
    if (page) {
      setPageData(prev => {
        const updated = { ...prev };
        delete updated[page];
        return updated;
      });
    } else {
      setPageData({});
    }
  }, []);

  const value = {
    pageData,
    loadingStates,
    setPageLoading,
    cachePageData,
    getCachedData,
    clearPageCache,
  };

  return <PageDataContext.Provider value={value}>{children}</PageDataContext.Provider>;
};

export const usePageData = () => {
  const context = useContext(PageDataContext);
  if (!context) {
    throw new Error('usePageData must be used within a PageDataProvider');
  }
  return context;
};