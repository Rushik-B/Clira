'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { QueueItem } from '@/types';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import queueBackground from '../../../public/ui-images/queue-background.webp';


// Mock data for UI testing - DO NOT REMOVE. Source: @/data/mockQueueData.ts
// Usage: <QueuePage useMockData={true} /> to preview modal styling
import { mockQueueItems } from '@/data/mockQueueData';

// Optimized components
import { PageHeader } from '@/components/ui/PageHeader';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { RefreshCw } from 'lucide-react';
import { QueueBulkActions } from '@/components/ui/queue-page/QueueBulkActions';
import { QueueEmptyState } from '@/components/ui/queue-page/QueueEmptyState';
import { EmailQueueCard } from '@/components/ui/queue-page/EmailQueueCard';
import { RejectDialog } from '@/components/ui/queue-page/RejectDialog';
import { EmailViewer } from '@/components/ui/queue-page/EmailViewer';
import { Toast } from '@/components/ui/queue-page/Toast';
import { QueueFilters } from '@/components/ui/queue-page/QueueFilters';
import { QueueIntroDialog } from '@/components/ui/queue-intro';
import { queueIntroSteps } from '@/components/ui/queue-intro/steps';
import { WhatsAppPromoDialog } from '@/components/ui/whatsapp-promo';
// Dev overrides
import { isDevQueueHarnessEnabled, isDevFullQueueSandboxEnabled } from '@/dev/uiOverrides';
import { EmailQueueCardDevHarness } from '@/dev/EmailQueueCardDevHarness';
import { FullQueueSandbox } from '@/dev/FullQueueSandbox';

// Optimized hooks
import { useQueueState } from '@/hooks/queue/useQueueState';
import { useQueueActions } from '@/hooks/queue/useQueueActions';
import { useToast } from '@/hooks/queue/useToast';
import { useQueueSSE } from '@/hooks/queue/useQueueSSE';
import { useQueueIntroModal } from '@/hooks/queue/useQueueIntroModal';
import { useWhatsAppPromoModal } from '@/hooks/queue/useWhatsAppPromoModal';
import { useQueueViewerNavigation } from '@/hooks/queue/useQueueViewerNavigation';
import { useQueueFilters } from '@/hooks/queue/useQueueFilters';
import { QueueCache } from '@/lib/cache/queueCache';
import { getQueueSubtitle } from '@/lib/utils/timeOfDayCopy';

// Constants
const MAIN_QUEUE_CACHE_LABEL_ID = '__main_queue__';

// Loading skeleton component that matches EmailQueueCard structure
const LoadingSkeleton = () => (
  <div className="space-y-6">
    {/* Loading message - redesigned to look much better */}
    <div className="flex items-center justify-center space-x-3 py-4">
      <div className="flex items-center space-x-2">
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
      </div>
      <span className="text-sm font-medium text-gray-300">Loading emails</span>
      <div className="flex items-center space-x-2">
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }}></div>
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.8s' }}></div>
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>
    </div>
    
    {/* Skeleton cards */}
    <div className="space-y-0 sm:space-y-4 lg:space-y-6 -mx-8 sm:mx-0 sm:-mx-2">
      {[1, 2, 3].map((index) => (
        <div key={index} className="sm:flex sm:items-start sm:space-x-3 lg:space-x-4 sm:px-2">
          {/* Desktop skeleton checkbox - only shown on sm+ screens */}
          <div className="hidden sm:block relative mt-6 lg:mt-8 flex-shrink-0">
            <div className="w-5 h-5 bg-gray-700 rounded-md animate-pulse"></div>
          </div>
          <div className="flex-1 w-full min-w-0">
            <div className="relative group transition-transform duration-300 will-change-transform mx-0 sm:mx-4 lg:mx-6 mb-6">
              {/* Skeleton ambient glow effects - Desktop only */}
              <div className="hidden sm:block absolute -inset-4 rounded-3xl blur-2xl bg-gradient-radial from-blue-500/8 via-blue-600/4 to-transparent opacity-60"></div>
              <div className="hidden sm:block absolute -inset-2 rounded-3xl blur-xl bg-gradient-radial from-blue-400/6 via-blue-500/3 to-transparent opacity-50"></div>
              
              <div className="relative border-0 sm:border sm:border-gray-800/50 bg-transparent sm:bg-black/80 backdrop-blur-none sm:backdrop-blur-md shadow-none sm:shadow-2xl rounded-none sm:rounded-3xl">
                <div className="relative bg-transparent sm:bg-black/70 border-0 sm:border-2 sm:border-gray-800/70 rounded-none sm:rounded-2xl backdrop-blur-none sm:backdrop-blur-sm shadow-none sm:shadow-inner p-4 sm:p-6 border-b border-gray-800/30 sm:border-b-0 pb-8 sm:pb-6">
                  
                  {/* Header skeleton */}
                  <div className="mb-3 sm:mb-4">
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between mb-2 space-y-2 xl:space-y-0">
                      <div className="h-6 sm:h-7 bg-gray-700 rounded-lg w-3/4 animate-pulse"></div>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 space-y-1 sm:space-y-0">
                        <div className="h-4 bg-gray-700 rounded-md w-32 animate-pulse"></div>
                        <div className="h-4 bg-gray-700 rounded-md w-20 animate-pulse"></div>
                      </div>
                    </div>
                    <div className="h-4 bg-gray-700 rounded-lg w-full animate-pulse"></div>
                  </div>
                  
                  {/* Email Reply Preview skeleton */}
                  <div className="mb-4 p-3 sm:p-4 bg-gradient-to-r from-gray-800/60 to-blue-900/10 border-2 border-gray-700/50 rounded-xl">
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-700 rounded w-full animate-pulse"></div>
                      <div className="h-3 bg-gray-700 rounded w-5/6 animate-pulse"></div>
                      <div className="h-3 bg-gray-700 rounded w-4/5 animate-pulse"></div>
                      <div className="h-3 bg-gray-700 rounded w-3/4 animate-pulse"></div>
                    </div>
                  </div>
                  
                  {/* Labels skeleton */}
                  <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-2.5">
                    <div className="h-6 bg-gray-700 rounded-lg w-16 animate-pulse"></div>
                    <div className="h-6 bg-gray-700 rounded-lg w-20 animate-pulse"></div>
                    <div className="h-6 bg-gray-700 rounded-lg w-14 animate-pulse"></div>
                  </div>
                  
                  {/* Actions skeleton */}
                  <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:justify-between sm:items-center">
                    <div className="h-4 bg-gray-700 rounded w-24 animate-pulse"></div>
                    <div className="flex flex-col space-y-2 lg:flex-row lg:space-y-0 lg:space-x-3">
                      <div className="h-9 bg-gray-700 rounded-2xl w-32 animate-pulse"></div>
                      <div className="h-9 bg-gray-700 rounded-2xl w-20 animate-pulse"></div>
                      <div className="h-9 bg-gray-700 rounded-2xl w-20 animate-pulse"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

interface QueuePageProps {
  /** Enable mock data for UI testing. DO NOT REMOVE - used for modal styling preview */
  useMockData?: boolean;
}

const QueuePageImpl: React.FC<QueuePageProps> = ({ useMockData = false }) => {
  // Basic state management
  const queueState = useQueueState();
  const {
    setShowRejectDialog,
    setRejectFeedback,
    clearRejectFeedback,
    setShowEmailViewer,
    setEmailViewerMode,
    clearSelections,
    selectedItems,
    setProcessingItems
  } = queueState;
  const { toast, showToast, hideToast, resetToast } = useToast();
  const { data: session } = useSession();
  const queueIntro = useQueueIntroModal();
  const { devMode, isReady: isQueueIntroReady, reopen: reopenQueueIntro } = queueIntro;
  const canShowHowToUse = devMode !== 'off';

  // WhatsApp promo modal - shows after queue intro is dismissed
  const whatsAppPromo = useWhatsAppPromoModal();
  // Only show WhatsApp promo when queue intro is not open
  const shouldShowWhatsAppPromo = whatsAppPromo.isReady && whatsAppPromo.isOpen && !queueIntro.isOpen;

  // Simple state for queue data
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSentId, setLastSentId] = useState<string | null>(null);
  const [mailboxFilter, setMailboxFilter] = useState('all');

  // Guard against stale updates and concurrent requests
  const requestSeqRef = React.useRef(0);
  const inFlightRef = React.useRef(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  // Fetch queue data function with pagination + lightweight retry for transient errors
  const fetchQueueData = useCallback(async (opts?: { background?: boolean; offset?: number; append?: boolean; disableCache?: boolean }) => {
    const requestId = ++requestSeqRef.current;
    const offset = opts?.offset ?? 0;
    const append = opts?.append ?? false;
    const disableCache = opts?.disableCache ?? false;

    if (!session?.userId) {
      if (!opts?.background) setIsLoading(false);
      return;
    }

    try {
      let usedFreshCache = false;

      // For the first page, try to hydrate from client cache for instant UI
      if (!disableCache && offset === 0 && !append && typeof window !== 'undefined') {
        try {
          const { data: cachedData, isFresh } = QueueCache.getCached(session.userId, MAIN_QUEUE_CACHE_LABEL_ID);
          if (cachedData && isFresh && requestId === requestSeqRef.current) {
            const cachedItems = cachedData.queueItems as QueueItem[];
            setQueueItems(cachedItems);

            const processingIds = new Set<string>(
              cachedItems
                .filter(i => (i as any)?.metadata?.isProcessing === true)
                .map(i => i.id)
            );
            setProcessingItems(processingIds);

            setIsLoading(false);
            setIsError(false);
            setError(null);
            usedFreshCache = true;
          }
        } catch (cacheError) {
          console.warn('QueuePage: Failed to read main queue cache', cacheError);
        }
      }

      // Cancel any in-flight request to avoid overlapping updates
      if (inFlightRef.current && controllerRef.current && !append) {
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      inFlightRef.current = true;

      // Only show full-loading state when we don't have a fresh cache
      if (!opts?.background && !append && !usedFreshCache) {
        setIsLoading(true);
        setIsError(false);
        setError(null);
      }
      
      const url = `/api/queue?limit=10&offset=${offset}`;

      // Lightweight retry loop for transient queue errors (e.g., Heroku 503 during cold start)
      const MAX_ATTEMPTS = 2;
      const RETRY_DELAY_MS = 1500;

      const fetchWithRetry = async (): Promise<any> => {
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
              const error = new Error(`HTTP ${response.status}`);
              (error as any).status = response.status;
              lastError = error;

              const status = response.status;
              const isTransient = status === 503 || status === 502 || status === 504;
              if (isTransient && attempt < MAX_ATTEMPTS) {
                console.warn(
                  `QueuePage: transient HTTP ${status} from /api/queue (attempt ${attempt}/${MAX_ATTEMPTS}), retrying…`
                );
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue;
              }

              throw error;
            }

            return await response.json();
          } catch (err: any) {
            if (err?.name === 'AbortError') {
              // Surface aborts to outer catch so we don't keep retrying after navigation/unmount
              throw err;
            }

            lastError = err;

            const statusFromError: number | undefined =
              (err as any)?.status ||
              (typeof err?.message === 'string' && /^HTTP (\d+)/.test(err.message)
                ? Number.parseInt(err.message.match(/^HTTP (\d+)/)![1], 10)
                : undefined);

            const isTransient = statusFromError === 503 || statusFromError === 502 || statusFromError === 504;
            if (isTransient && attempt < MAX_ATTEMPTS) {
              console.warn(
                `QueuePage: transient fetch error from /api/queue (attempt ${attempt}/${MAX_ATTEMPTS}), retrying…`,
                err
              );
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
              continue;
            }

            throw err;
          }
        }

        throw lastError ?? new Error('Failed to fetch queue data');
      };

      const data = await fetchWithRetry();
      if (data.success && data.queueItems) {
        if (requestId === requestSeqRef.current) {
          // Set queue items and processing state from server data
          const serverItems = data.queueItems as QueueItem[];

          if (append) {
            // Append to existing items (avoid duplicates by ID)
            setQueueItems(prev => {
              const existingIds = new Set(prev.map(i => i.id));
              const newItems = serverItems.filter(i => !existingIds.has(i.id));
              return [...prev, ...newItems];
            });
          } else {
            setQueueItems(serverItems);
          }
          
          // Update processing state based on server metadata
          const processingIds = new Set<string>(
            serverItems.filter(i => (i as any)?.metadata?.isProcessing === true).map(i => i.id)
          );
          setProcessingItems(processingIds);
          
          // If there's more data, fetch it in the background
          if (data.pagination?.hasMore && offset === 0 && !append) {
            // Schedule background fetches for remaining pages
            const nextOffset = data.pagination.nextOffset;
            if (nextOffset !== null) {
              setTimeout(() => {
                fetchQueueData({ background: true, offset: nextOffset, append: true });
              }, 500); // Small delay to let the first page render
            }
          } else if (data.pagination?.hasMore && append) {
            // Continue fetching next page
            const nextOffset = data.pagination.nextOffset;
            if (nextOffset !== null) {
              setTimeout(() => {
                fetchQueueData({ background: true, offset: nextOffset, append: true });
              }, 300);
            }
          }
        }
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Ignore aborted requests
        return;
      }
      if (!opts?.background && !append) {
        setIsError(true);
        setError(err instanceof Error ? err.message : 'Failed to fetch queue data');
      }
      console.error('Failed to fetch queue data:', err);
    } finally {
      if (requestId === requestSeqRef.current) {
        inFlightRef.current = false;
        if (!opts?.background && !append) setIsLoading(false);
      }
    }
  }, [session?.userId, setProcessingItems]);

  // Periodic refresh (once per minute), gated by visibility and in-flight state
  useEffect(() => {
    if (useMockData) return;

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (inFlightRef.current) return;
      console.log('📧 Periodic refresh (60s) for main queue');
      fetchQueueData({ background: true });
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchQueueData, useMockData]);

  // Live updates via SSE (disabled when using mock data)
  useQueueSSE({
    enabled: !!session?.userId && !useMockData,
    onStart: (evt) => {
      if (useMockData) return;
      const item: QueueItem = {
        id: evt.emailId,
        actionSummary: `Reply to: ${evt.subject}`,
        contextSummary: evt.snippet && evt.snippet.trim().length > 0 ? evt.snippet : `From: ${evt.from}`,
        status: 'needs-attention',
        confidence: 0,
        draftPreview: 'Generating reply…',
        fullDraft: '',
        metadata: {
          emailId: evt.emailId,
          from: evt.from,
          subject: evt.subject,
          body: undefined,
          receivedAt: evt.receivedAt,
          labels: evt.labelId ? [{ id: evt.labelId, name: evt.labelName || 'Folder', color: evt.labelColor || '#6B7280', gmailLabelId: evt.gmailLabelId }] : [],
        },
      };
      setQueueItems((prev) => (prev.some((q) => q.id === item.id) ? prev : [item, ...prev]));
      queueState.setItemProcessing(item.id, true);
    },
    onReady: (evt) => {
      if (useMockData) return;
      queueState.setItemProcessing(evt.emailId, false);
      setQueueItems((prev) => prev.filter((q) => q.id !== evt.emailId));
      fetchQueueData({ background: true });
    },
    onFail: (evt) => {
      if (useMockData) return;
      queueState.setItemProcessing(evt.emailId, false);
      setQueueItems((prev) => prev.filter((q) => q.id !== evt.emailId));
    },
  });

  // Keep a short-lived client cache of the main queue so returning to
  // this page can render instantly while a fresh fetch runs in the background.
  useEffect(() => {
    if (!session?.userId) return;
    if (typeof window === 'undefined') return;
    if (isLoading) return;

    try {
      const labelInfo = {
        id: MAIN_QUEUE_CACHE_LABEL_ID,
        name: 'Inbox',
        color: '#0ea5e9',
        metaPrompt: 'All emails in your Clira queue',
        gmailLabelId: undefined,
        isSystemDefault: true,
        emailCount: queueItems.length,
        icon: '📥',
        queueCount: queueItems.length,
      };
      QueueCache.setCached(session.userId, MAIN_QUEUE_CACHE_LABEL_ID, queueItems, labelInfo);
    } catch (cacheError) {
      console.warn('QueuePage: Failed to write main queue cache', cacheError);
    }
  }, [session?.userId, queueItems, isLoading]);

  // Load data on mount
  useEffect(() => {
    if (useMockData) {
      // Load mock data for UI testing - DO NOT REMOVE this branch
      setIsLoading(false);
      setQueueItems(mockQueueItems);
    } else {
      fetchQueueData();
    }
  }, [fetchQueueData, useMockData]);

  // Queue actions
  const queueActions = useQueueActions({
    queueItems: queueItems,
    setItemProcessing: queueState.setItemProcessing,
    setItemSuccess: queueState.setItemSuccess,
    removeQueueItem: (itemId: string) => {
      // Remove from local state immediately
      setQueueItems(prev => prev.filter(item => item.id !== itemId));
    },
    showToast,
    invalidateCache: () => {
      // Simple refetch instead of cache invalidation
      fetchQueueData({ disableCache: true });
    }
  });

  const {
    filteredItems,
    mailboxOptions,
    isMailboxFilterActive,
  } = useQueueFilters({ items: queueItems, mailboxFilter });
  const isFilterActive = isMailboxFilterActive;

  const viewerNavigation = useQueueViewerNavigation({
    items: filteredItems,
    activeItem: queueState.showEmailViewer,
    setActiveItem: setShowEmailViewer
  });

  const viewerSendStatus = useMemo(() => {
    if (!lastSentId) return undefined as undefined | 'sending' | 'sent';
    if (queueState.successItems.has(lastSentId)) return 'sent' as const;
    if (queueState.processingItems.has(lastSentId)) return 'sending' as const;
    return undefined;
  }, [lastSentId, queueState.processingItems, queueState.successItems]);
  const isQueueEmpty = !isLoading && filteredItems.length === 0 && !isFilterActive;

  useEffect(() => {
    if (viewerSendStatus === 'sent') {
      const t = setTimeout(() => setLastSentId(null), 1600);
      return () => clearTimeout(t);
    }
  }, [viewerSendStatus]);

  const openViewer = useCallback((itemId: string, nextMode: 'view' | 'edit') => {
    const item = filteredItems.find(q => q.id === itemId);
    if (!item) {
      return;
    }
    setEmailViewerMode(nextMode);
    setShowEmailViewer(item);
  }, [filteredItems, setEmailViewerMode, setShowEmailViewer]);

  const handleRefreshClick = useCallback(() => {
    console.log('📧 Manual refresh triggered for main queue');
    fetchQueueData({ disableCache: true });
  }, [fetchQueueData]);
    
  // Handle data fetching errors
  useEffect(() => {
    if (isError && error) {
      showToast(`Failed to load emails: ${error}`, 'error');
    }
  }, [isError, error, showToast]);

  // Action handlers
  const handleAction = useCallback((
    itemId: string,
    actionType: string,
    data?: { content: string; cc?: string }
  ) => {
    console.log(`Action: ${actionType} on item: ${itemId}`);

    if (actionType === 'approve') {
      setLastSentId(itemId);
      queueActions.handleApprove(itemId);
    } else if (actionType === 'reject') {
      setShowRejectDialog(itemId);
    } else if (actionType === 'edit') {
      if (data) {
        setLastSentId(itemId);
        queueActions.handleEdit(itemId, data.content, data.cc);
        return;
      }
      openViewer(itemId, 'edit');
    } else if (actionType === 'view') {
      openViewer(itemId, 'edit');
    } else if (actionType === 'dismiss') {
      queueActions.handleDismiss(itemId);
    }
  }, [queueActions, openViewer, setShowRejectDialog]);

  const handleReject = useCallback((itemId: string, feedback: string) => {
    queueActions.handleReject(itemId, feedback);
    setShowRejectDialog(null);
    clearRejectFeedback(itemId);
  }, [queueActions, clearRejectFeedback, setShowRejectDialog]);

  const handleBulkApprove = useCallback(() => {
    const cleanup = queueActions.handleBulkAction('approve', selectedItems);
    clearSelections();
    return cleanup;
  }, [queueActions, clearSelections, selectedItems]);

  const handleBulkReject = useCallback(() => {
    const cleanup = queueActions.handleBulkAction('reject', selectedItems);
    clearSelections();
    return cleanup;
  }, [queueActions, clearSelections, selectedItems]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenIntro = () => {
      reopenQueueIntro();
    };

    window.addEventListener('queue-intro:open', handleOpenIntro);
    return () => {
      window.removeEventListener('queue-intro:open', handleOpenIntro);
    };
  }, [reopenQueueIntro]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isQueueIntroReady) return;

    window.dispatchEvent(
      new CustomEvent('queue-intro:availability', {
        detail: { available: canShowHowToUse },
      })
    );
  }, [canShowHowToUse, isQueueIntroReady]);

  const activeRejectId = queueState.showRejectDialog;
  const activeRejectFeedback = queueState.rejectFeedback;

  return (
    <div className="min-h-[100dvh] sm:min-h-screen flex flex-col bg-black relative overflow-hidden">
      {/* Mobile Header - Fixed at top, only visible on mobile */}
      <MobileHeader title="Email Queue">
        <LiquidButton
          onClick={handleRefreshClick}
          size="icon"
          minWidth="none"
          hdrHover
          className="h-8 w-8 rounded-full text-sky-100 hover:scale-100"
          disabled={isLoading}
          aria-label="Refresh queue"
          variant="default"
          type="button"
        >
          <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
        </LiquidButton>
      </MobileHeader>

      {/* Ambient page glows removed for black background and performance */}
      {isQueueEmpty && (
        <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
          <Image
            alt=""
            src={queueBackground}
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            style={{ objectFit: 'cover', objectPosition: 'center' }}
            quality={85}
          />
        </div>
      )}
      
      <div
        className={`flex-1 w-full max-w-none p-8 pt-24 sm:pt-8 relative z-10 flex flex-col ${
          isQueueEmpty ? '' : 'space-y-8'
        }`}
      >
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <PageHeader
            title=""
            subtitle={getQueueSubtitle()}
            showGreeting={true}
          />
          <div className="hidden sm:flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <LiquidButton
                onClick={() => queueIntro.reopen()}
                minWidth="md"
                responsive
                variant="default"
                size="lg"
                hdrHover
                className={`${LIQUID_BUTTON_BASE_CLASS} hover:scale-100`}
                type="button"
              >
                How to use
              </LiquidButton>
            
            <LiquidButton
              onClick={handleRefreshClick}
              size="lg"
              responsive
              variant="default"
              hdrHover
              className={`${LIQUID_BUTTON_BASE_CLASS} hover:scale-100`}
              disabled={isLoading}
              type="button"
            >
              <span className="flex items-center gap-2">
                <RefreshCw
                  className={`${isLoading ? 'animate-spin' : ''}`}
                  size={16}
                />
                {isLoading ? 'Refreshing...' : 'Refresh'}
              </span>
            </LiquidButton>
          </div>
        </div>

        {!isQueueEmpty && (
          <>
            {/* Filters */}
            <QueueFilters
              mailboxFilter={mailboxFilter}
              onMailboxFilterChange={setMailboxFilter}
              mailboxOptions={mailboxOptions}
              filteredCount={filteredItems.length}
              totalCount={queueItems.length}
            />

            {/* Bulk Actions - Desktop only (hidden on mobile since no checkboxes) */}
            <div className="hidden sm:block">
              <QueueBulkActions 
                selectedCount={queueState.selectedCount}
                onBulkApprove={handleBulkApprove}
                onBulkReject={handleBulkReject}
              />
            </div>

            {/* Email List */}
            {isLoading ? (
              <LoadingSkeleton />
            ) : filteredItems.length > 0 ? (
              <div className="space-y-0 sm:space-y-4 lg:space-y-6 -mx-8 sm:mx-0 sm:-mx-2">
                {filteredItems.map(item => (
                  <div key={item.id} className="sm:flex sm:items-start sm:space-x-3 lg:space-x-4 sm:px-2">
                    {/* Desktop checkbox - only shown on sm+ screens */}
                    <div className="hidden sm:block relative mt-6 lg:mt-8 flex-shrink-0">
                      <input 
                        type="checkbox" 
                        className="peer w-5 h-5 text-blue-500 bg-gray-900 border-2 border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer hover:border-gray-500 transition-all duration-200 checked:bg-blue-600 checked:border-blue-600"
                        checked={queueState.selectedItems.has(item.id)}
                        onChange={() => queueState.toggleSelectItem(item.id)}
                        aria-label={`Select email from ${item.metadata?.from}`}
                      />
                      <div className="absolute inset-0 pointer-events-none peer-checked:opacity-100 opacity-0 transition-opacity duration-200">
                        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Mobile and Desktop card container */}
                    <div className="flex-1 w-full min-w-0">
                      <EmailQueueCard 
                        item={item} 
                        onAction={handleAction}
                        isProcessing={queueState.processingItems.has(item.id)}
                        isSuccess={queueState.successItems.has(item.id)}
                        isSelected={queueState.selectedItems.has(item.id)}
                        sendStatus={lastSentId === item.id ? viewerSendStatus : undefined}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : isFilterActive ? (
              <div className="rounded-2xl border border-gray-800/60 bg-black/60 px-5 py-6 text-center">
                <p className="text-sm text-gray-200">No emails match this inbox.</p>
                <button
                  type="button"
                  onClick={() => {
                    setMailboxFilter('all');
                  }}
                  className="mt-3 text-xs text-blue-300 hover:text-blue-200 transition-colors cursor-pointer"
                >
                  Clear filter
                </button>
              </div>
            ) : null}
          </>
        )}
        {isQueueEmpty && <QueueEmptyState />}

        {/* Toast Notifications */}
        <Toast 
          message={toast.message}
          type={toast.type}
          isVisible={toast.isVisible}
          onClose={hideToast}
          onAnimationEnd={resetToast}
        />
      </div>
      
      {/* Modals - Outside scrollable container for proper positioning */}
      {activeRejectId && (
        <RejectDialog 
          itemId={activeRejectId}
          onClose={() => {
            setShowRejectDialog(null);
          }} 
          onSubmit={(feedback) => handleReject(activeRejectId, feedback)}
          onFeedbackChange={(value) => setRejectFeedback(activeRejectId, value)}
          initialFeedback={activeRejectFeedback}
        />
      )}
      
      {queueState.showEmailViewer && (
        <EmailViewer
          item={queueState.showEmailViewer}
          onClose={() => {
            setShowEmailViewer(null);
            setEmailViewerMode('view');
          }}
          onAction={handleAction}
          navigation={viewerNavigation}
          mode={queueState.emailViewerMode}
          sendStatus={lastSentId === queueState.showEmailViewer.id ? viewerSendStatus : undefined}
        />
      )}

      {queueIntro.isReady && (
        <QueueIntroDialog
          isOpen={queueIntro.isOpen}
          steps={queueIntroSteps}
          onClose={queueIntro.close}
          onComplete={queueIntro.complete}
        />
      )}

      {shouldShowWhatsAppPromo && (
        <WhatsAppPromoDialog
          isOpen={shouldShowWhatsAppPromo}
          onClose={whatsAppPromo.close}
          onConnect={whatsAppPromo.connect}
        />
      )}
    </div>
  );
};

export const QueuePage: React.FC<QueuePageProps> = ({ useMockData = false }) => {
  // Dev harness wrapper to keep hooks order safe
  if (isDevQueueHarnessEnabled()) {
    return <EmailQueueCardDevHarness />;
  }
  if (isDevFullQueueSandboxEnabled()) {
    return <FullQueueSandbox />;
  }
  return <QueuePageImpl useMockData={useMockData} />;
};
