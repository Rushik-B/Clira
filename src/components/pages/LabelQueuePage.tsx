'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { QueueItem } from '@/types';
import { useSession } from 'next-auth/react';

// Mock data for UI testing - DO NOT REMOVE. Source: @/data/mockQueueData.ts
// Usage: <LabelQueuePage useMockData={true} /> to preview modal styling
import { mockQueueItems } from '@/data/mockQueueData';

// Optimized components
import { PageHeader } from '@/components/ui/PageHeader';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { QueueBulkActions } from '@/components/ui/queue-page/QueueBulkActions';
import { QueueEmptyState } from '@/components/ui/queue-page/QueueEmptyState';
import { EmailQueueCard } from '@/components/ui/queue-page/EmailQueueCard';
import { RejectDialog } from '@/components/ui/queue-page/RejectDialog';
import { EmailViewer } from '@/components/ui/queue-page/EmailViewer';
import { Toast } from '@/components/ui/queue-page/Toast';
import { LabelQueueHeader } from '@/components/ui/label-queue/LabelQueueHeader';
import LabelQueueBreadcrumbs from '@/components/ui/label-queue/LabelQueueBreadcrumbs';
import { ArrowLeft, RefreshCw, ChevronDown, ChevronUp, Brain } from 'lucide-react';
import { MobileHeader } from '@/components/ui/MobileHeader';

// Types
import { FolderData, isWellDescribed } from '@/components/ui/folder-management/types';

// Optimized hooks
import { useQueueState } from '@/hooks/queue/useQueueState';
import { useQueueActions } from '@/hooks/queue/useQueueActions';
import { useToast } from '@/hooks/queue/useToast';
import { QueueCache } from '@/lib/cache/queueCache';
import { LabelCache } from '@/lib/cache/labelCache';
import { coalesceApiRequest } from '@/lib/cache/requestCoalescing';
import { useQueueSSE } from '@/hooks/queue/useQueueSSE';
import { useQueueViewerNavigation } from '@/hooks/queue/useQueueViewerNavigation';

// Constants
import { getFolderIconWithFallback } from '@/lib/utils/folderIconHelper';


// Helper: map API rule types to frontend condition types (from EmailMappingType enum)
function mapApiTypeToCondition(apiType: string): string {
  console.log('🔄 Mapping API type to condition:', apiType);
  switch (apiType) {
    case 'EMAIL': return 'sender';
    case 'DOMAIN': return 'domain';
    case 'SUBJECT': return 'subject';
    case 'SUBJECT_CONTAINS': return 'subject_contains';
    case 'SUBJECT_STARTS_WITH': return 'subject_starts_with';
    case 'SUBJECT_ENDS_WITH': return 'subject_ends_with';
    case 'SUBJECT_REGEX': return 'subject_regex';
    default: 
      console.warn('⚠️ Unknown API type:', apiType);
      return 'sender';
  }
}

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

interface LabelQueuePageProps {
  labelId: string;
  /** Enable mock data for UI testing. DO NOT REMOVE - used for modal styling preview */
  useMockData?: boolean;
  onBackToQueue?: () => void;
  onNavigateHome?: () => void;
}

export const LabelQueuePage: React.FC<LabelQueuePageProps> = ({
  labelId,
  useMockData = false,
  onBackToQueue,
  onNavigateHome
}) => {
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
  
  // Simple state for queue data
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [labelData, setLabelData] = useState<FolderData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRulesLoading, setIsRulesLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simple loading state
  const shouldShowLoading = useMemo(() =>
    isLoading,
    [isLoading]
  );

  // Track and guard against stale async updates across rapid label switches
  const requestSeqRef = React.useRef(0);
  const latestLabelRef = React.useRef(labelId);
  const inFlightRef = React.useRef(false);
  const controllerRef = React.useRef<AbortController | null>(null);
  useEffect(() => {
    latestLabelRef.current = labelId;
  }, [labelId]);

  // Fetch queue data function - now with caching and request coalescing
  const fetchQueueData = useCallback(async (opts?: { background?: boolean }) => {
    const requestId = ++requestSeqRef.current;
    if (!session?.userId || !labelId) {
      if (requestId === requestSeqRef.current && !opts?.background) setIsLoading(false);
      return;
    }

    try {
      // Abort any in-flight request to avoid overlapping updates
      if (inFlightRef.current && controllerRef.current) {
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      inFlightRef.current = true;

      if (requestId === requestSeqRef.current && !opts?.background) {
        setIsLoading(true);
        setIsRulesLoading(true);
      }
      setIsError(false);
      setError(null);

      // Check cache first for instant loading
      const { data: cachedData, isFresh } = QueueCache.getCached(session.userId, labelId);
      
      if (cachedData && isFresh) {
        // Use cached data immediately for instant UI
        console.log(`🚀 QueueCache: Using fresh cached data for ${cachedData.labelInfo.name}`);
        if (requestId === requestSeqRef.current && latestLabelRef.current === labelId) {
          // Set cached queue items and processing state
          const cachedItems = cachedData.queueItems as QueueItem[];
          setQueueItems(cachedItems);
          
          // Update processing state from cached metadata
          const processingIds = new Set<string>(
            cachedItems.filter(i => (i as any)?.metadata?.isProcessing === true).map(i => i.id)
          );
          setProcessingItems(processingIds);
        }
        
        // Convert to FolderData format
        const labelInfo = cachedData.labelInfo;
        const baseLabelData = {
          id: labelInfo.id,
          name: labelInfo.name,
          description: labelInfo.metaPrompt || `Emails related to ${labelInfo.name}`,
          instruction: labelInfo.metaPrompt || `Emails related to ${labelInfo.name}`,
          color: labelInfo.color,
          icon: getFolderIconWithFallback(labelInfo.name, labelInfo.metaPrompt || `Emails related to ${labelInfo.name}`),
          emailCount: labelInfo.emailCount || 0,
          isSystemDefault: labelInfo.isSystemDefault || false,
          hardRules: [], // Will be populated from API response with rules
          examples: [],
          confidence: 100
        };
        
        if (requestId === requestSeqRef.current && latestLabelRef.current === labelId) {
          setLabelData(baseLabelData);
          setIsLoading(false);
          // Keep rulesLoading true so the rules section shows spinner while we fetch
        }
      }

      // Fetch fresh data with request coalescing to prevent duplicate calls
      const data = await coalesceApiRequest(
        session.userId,
        `queue-${labelId}`,
        async () => {
          const response = await fetch(`/api/queue/${labelId}`, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        }
      );

      if (data.success && data.queueItems) {
        if (requestId === requestSeqRef.current && latestLabelRef.current === labelId) {
          // Set fresh queue items and processing state
          const freshItems = data.queueItems as QueueItem[];
          setQueueItems(freshItems);
          
          // Update processing state from fresh metadata
          const processingIds = new Set<string>(
            freshItems.filter(i => (i as any)?.metadata?.isProcessing === true).map(i => i.id)
          );
          setProcessingItems(processingIds);
        }
        
        // Cache the fresh data for future use
        QueueCache.setCached(session.userId, labelId, data.queueItems, data.labelInfo);
        
        // Convert labelInfo to FolderData format 
        if (data.labelInfo) {
          const labelInfo = data.labelInfo;
          const hardRules = Array.isArray(data.rules)
            ? data.rules.map((r: any) => ({
                id: r.id,
                condition: mapApiTypeToCondition(r.type),
                value: r.value,
                action: 'move_to_folder',
                targetFolderId: labelInfo.id
              }))
            : [];

          const baseLabelData = {
            id: labelInfo.id,
            name: labelInfo.name,
            description: labelInfo.metaPrompt || `Emails related to ${labelInfo.name}`,
            instruction: labelInfo.metaPrompt || `Emails related to ${labelInfo.name}`,
            color: labelInfo.color,
            icon: getFolderIconWithFallback(labelInfo.name, labelInfo.metaPrompt || `Emails related to ${labelInfo.name}`),
            emailCount: labelInfo.emailCount || 0,
            isSystemDefault: labelInfo.isSystemDefault || false,
            hardRules,
            examples: [],
            confidence: 100
          };
          
          if (requestId === requestSeqRef.current && latestLabelRef.current === labelId) {
            setLabelData(baseLabelData);
          }
        }
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setIsError(true);
        setError(err instanceof Error ? err.message : 'Failed to fetch queue data');
        console.error('Failed to fetch label queue data:', err);
      }
    } finally {
      if (requestId === requestSeqRef.current && latestLabelRef.current === labelId) {
        inFlightRef.current = false;
        if (!opts?.background) {
          setIsLoading(false);
          setIsRulesLoading(false);
        }
      }
    }
  }, [session?.userId, labelId, setProcessingItems]);

  // Periodic refresh every 60s, gated by visibility and in-flight state
  useEffect(() => {
    if (useMockData) return;
    const refreshInterval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (inFlightRef.current) return;
      console.log('📧 Periodic refresh (60s) for label queue');
      fetchQueueData({ background: true });
    }, 60000);
    return () => clearInterval(refreshInterval);
  }, [fetchQueueData, useMockData, session?.userId, labelId]);

  // Live updates via SSE scoped to this label
  useQueueSSE({
    labelId,
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

  // Load data on mount
  useEffect(() => {
    if (useMockData) {
      // Load mock data for UI testing - DO NOT REMOVE this branch
      setIsLoading(false);
      setIsRulesLoading(false);
      setQueueItems(mockQueueItems);
      setLabelData({
        id: 'mock-label-id',
        name: 'Mock Label Queue',
        description: 'This is a mock folder for development and testing.',
        instruction: 'Rules for this mock folder.',
        color: '#a855f7', // purple-500
        icon: '🧪',
        emailCount: mockQueueItems.length,
        isSystemDefault: false,
        hardRules: [
          { id: 'mock-rule-1', condition: 'sender', value: 'github.com', action: 'move_to_folder', targetFolderId: 'mock-label-id' },
          { id: 'mock-rule-2', condition: 'subject_contains', value: 'Update', action: 'move_to_folder', targetFolderId: 'mock-label-id' },
        ],
        examples: [],
        confidence: 100,
      });
    } else {
      // Prehydrate header immediately from caches while queue loads
      try {
        if (session?.userId) {
          const { data: cached } = QueueCache.getCached(session.userId, labelId);
          if (cached?.labelInfo) {
            const li = cached.labelInfo;
            setLabelData({
              id: li.id,
              name: li.name,
              description: li.metaPrompt || `Emails related to ${li.name}`,
              instruction: li.metaPrompt || `Emails related to ${li.name}`,
              color: li.color,
              icon: getFolderIconWithFallback(li.name, li.metaPrompt || `Emails related to ${li.name}`),
              emailCount: li.emailCount || 0,
              isSystemDefault: li.isSystemDefault || false,
              hardRules: [],
              examples: [],
              confidence: 100,
            });
          } else {
            const { data: labelList } = LabelCache.getCached(session.userId);
            const meta = labelList?.labels?.find(l => l.id === labelId);
            if (meta) {
              setLabelData({
                id: meta.id,
                name: meta.name,
                description: `Emails related to ${meta.name}`,
                instruction: `Emails related to ${meta.name}`,
                color: meta.color,
                icon: getFolderIconWithFallback(meta.name, `Emails related to ${meta.name}`),
                emailCount: meta.emailCount || 0,
                isSystemDefault: false,
                hardRules: [],
                examples: [],
                confidence: 100,
              });
            }
          }
        }
      } catch {}

      fetchQueueData();
    }
  }, [fetchQueueData, useMockData, session?.userId, labelId]);

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
      fetchQueueData();
    }
  });

  // Memoized filtered items
  const filteredItems = useMemo(() =>
    queueItems,
    [queueItems]
  );

  const viewerNavigation = useQueueViewerNavigation({
    items: filteredItems,
    activeItem: queueState.showEmailViewer,
    setActiveItem: setShowEmailViewer
  });

  const openViewer = useCallback((itemId: string, nextMode: 'view' | 'edit') => {
    const item = filteredItems.find(q => q.id === itemId);
    if (!item) {
      return;
    }
    setEmailViewerMode(nextMode);
    setShowEmailViewer(item);
  }, [filteredItems, setEmailViewerMode, setShowEmailViewer]);


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
      queueActions.handleApprove(itemId);
    } else if (actionType === 'reject') {
      setShowRejectDialog(itemId);
    } else if (actionType === 'edit') {
      if (data) {
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

  const FolderIcon = ({ className }: { className?: string }) => {
    if (!labelData || !labelData.icon) {
      return null; // Don't show any icon if no labelData or no icon
    }
    // Display the custom emoji icon, scaling it appropriately for the PageHeader container
    // The PageHeader container is 12x12 to 16x16, so we use text-2xl for good proportions
    return <span className={`text-2xl sm:text-3xl lg:text-4xl leading-none ${className || ''}`}>{labelData.icon}</span>;
  };

  // Mobile-only: collapse/expand folder settings (incl. Folder Instructions) for better UX
  const [isMobileFolderOpen, setIsMobileFolderOpen] = useState(false);
  const isMobileWellDescribed = labelData ? isWellDescribed(labelData) : true;

  const activeRejectId = queueState.showRejectDialog;
  const activeRejectFeedback = queueState.rejectFeedback;

  return (
    <div className="min-h-[100dvh] sm:min-h-screen flex flex-col bg-black relative overflow-hidden">
      {/* Mobile Header - Fixed */}
      <MobileHeader title={labelData?.name || 'Label Queue'}>
        <LiquidButton
          onClick={() => {
            console.log('📧 Manual refresh triggered');
            fetchQueueData();
          }}
          minWidth="none"
          size="icon"
          className="h-8 w-8 rounded-full text-sky-100"
          disabled={isLoading}
          aria-label="Refresh label queue"
          variant="default"
        >
          <RefreshCw className={`${isLoading ? 'animate-spin' : ''}`} size={14} />
        </LiquidButton>
      </MobileHeader>
      {/* Ambient page glow effects - hide on mobile to avoid bottom blue bar */}
      <div className="hidden sm:block fixed inset-0 pointer-events-none">
        {/* Top gradient glow */}
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-96 h-96 bg-gradient-radial from-blue-500/8 via-blue-600/4 to-transparent rounded-full blur-3xl"></div>
        
        {/* Side accent glows */}
        <div className="absolute top-1/4 left-0 w-64 h-64 bg-gradient-radial from-cyan-500/6 via-cyan-600/3 to-transparent rounded-full blur-2xl"></div>
        <div className="absolute top-3/4 right-0 w-64 h-64 bg-gradient-radial from-blue-400/6 via-blue-500/3 to-transparent rounded-full blur-2xl"></div>
        
        {/* Bottom center glow */}
        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-80 h-80 bg-gradient-radial from-blue-600/5 via-blue-700/2 to-transparent rounded-full blur-3xl"></div>
        
        {/* Subtle corner accents */}
        <div className="absolute top-0 right-1/4 w-48 h-48 bg-gradient-radial from-indigo-500/4 via-indigo-600/2 to-transparent rounded-full blur-xl"></div>
        <div className="absolute bottom-1/4 left-1/4 w-48 h-48 bg-gradient-radial from-cyan-400/4 via-cyan-500/2 to-transparent rounded-full blur-xl"></div>
      </div>
      
      <div className="flex-1 space-y-8 w-full max-w-none p-8 pt-24 sm:pt-8 relative z-10">
        {/* Breadcrumb Navigation */}
        {labelData && (
          <LabelQueueBreadcrumbs 
            folder={labelData}
            onNavigateHome={onNavigateHome}
            onNavigateToQueue={onBackToQueue}
            className="mb-6"
          />
        )}

        {/* Header with Quick Switcher */}
        {labelData ? (
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <PageHeader
              title={labelData.name}
              subtitle={`Review emails and manage settings for the "${labelData.name}" folder.`}
              icon={FolderIcon}
              iconColor=""
            />
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <LiquidButton
                onClick={() => {
                  console.log('📧 Manual refresh triggered');
                  fetchQueueData();
                }}
                minWidth="md"
                responsive
                variant="default"
                size="lg"
                className={LIQUID_BUTTON_BASE_CLASS}
                disabled={isLoading}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                  {isLoading ? 'Refreshing...' : 'Refresh'}
                </span>
              </LiquidButton>
              <LiquidButton
                onClick={onBackToQueue || (() => window.history.back())}
                minWidth="md"
                responsive
                variant="default"
                size="lg"
                className={LIQUID_BUTTON_BASE_CLASS}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <ArrowLeft size={16} />
                  Back to All Queues
                </span>
              </LiquidButton>
            </div>
          </div>
        ) : (
          <div className="animate-pulse">
            <div className="h-10 bg-gray-700 rounded-lg w-1/2 mb-2"></div>
            <div className="h-4 bg-gray-700 rounded-lg w-3/4"></div>
          </div>
        )}

        {/* Folder Settings Panel */}
        {/* Mobile: compact, collapsible summary with lazy-mounted details */}
        {labelData ? (
        <div className="sm:hidden px-1">
          {/* Summary header */}
          <button
            type="button"
            onClick={() => setIsMobileFolderOpen((v) => !v)}
            aria-expanded={isMobileFolderOpen}
            aria-controls="mobile-folder-settings"
            className="w-full text-left"
          >
            <div className="relative group">
              <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-blue-400/20 group-hover:via-blue-300/25 group-hover:to-blue-400/20"></div>
              <div className="relative bg-black/80 border-2 border-gray-800/50 rounded-2xl p-3 sm:p-4 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-gray-700/60">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 overflow-hidden">
                    {/* Header row with icon, title, and status badge */}
                    <div className="flex items-start gap-2 mb-2">
                      <Brain className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm sm:text-base font-semibold text-white truncate">
                          Folder Instructions
                        </h3>
                      </div>
                    </div>
                    
                    {/* Status badge on its own row for better mobile layout */}
                    {labelData && (
                      <div className="flex items-start gap-2 mb-3">
                        <div className="w-4 flex-shrink-0"></div> {/* Spacer to align with icon above */}
                        <span
                          className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-md border ${
                            isMobileWellDescribed
                              ? 'bg-emerald-900/30 text-emerald-300 border-emerald-800/40'
                              : 'bg-amber-900/30 text-amber-300 border-amber-800/40'
                          }`}
                        >
                          {isMobileWellDescribed ? 'Smart Sorting Active' : 'Basic Sorting'}
                        </span>
                      </div>
                    )}
                    
                    {/* Description text with proper overflow handling */}
                    <div className="flex items-start gap-2">
                      <div className="w-4 flex-shrink-0"></div> {/* Spacer to align with icon above */}
                      <p className="text-xs sm:text-sm text-gray-200/90 font-medium leading-relaxed line-clamp-2 break-words">
                        {(labelData?.instruction || labelData?.description || (labelData ? `Emails related to ${labelData.name}` : ''))}
                      </p>
                    </div>
                  </div>
                  
                  {/* Chevron icon */}
                  <div className="flex-shrink-0 self-start pt-1 text-gray-300">
                    {isMobileFolderOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>
              </div>
            </div>
          </button>

          {/* Collapsible content - mount only when open to avoid heavy renders */}
          <div
            id="mobile-folder-settings"
            className={`transition-[max-height] duration-300 overflow-hidden ${isMobileFolderOpen ? 'max-h-[5000px] mt-4' : 'max-h-0'}`}
          >
            <div className="px-1">
              <LabelQueueHeader
                folder={labelData}
                queueCount={filteredItems.length}
                isLoading={false}
                rulesLoading={isRulesLoading}
              />
            </div>
          </div>
        </div>
        ) : (
          <div className="sm:hidden px-1">
            <LabelQueueHeader 
              folder={labelData}
              queueCount={filteredItems.length}
              isLoading={false}
              rulesLoading={isRulesLoading}
            />
          </div>
        )}

        {/* Desktop/Wide: unchanged layout */}
        <div className="hidden sm:block">
          <LabelQueueHeader 
            folder={labelData}
            queueCount={filteredItems.length}
            isLoading={false}
            rulesLoading={isRulesLoading}
          />
        </div>

        {/* Bulk Actions - Desktop only (hidden on mobile since no checkboxes) */}
        <div className="hidden sm:block">
          <QueueBulkActions 
            selectedCount={queueState.selectedCount}
            onBulkApprove={handleBulkApprove}
            onBulkReject={handleBulkReject}
          />
        </div>

        {/* Email List */}
        {shouldShowLoading ? (
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
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <QueueEmptyState />
        )}

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
        />
      )}
    </div>
  );
};
