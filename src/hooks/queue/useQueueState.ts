import { useState, useCallback, useMemo } from 'react';
import { QueueItem } from '@/types';

/**
 * Optimized queue state management hook
 * Centralizes all queue-related state with memoized selectors
 */
export function useQueueState() {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRejectDialog, setShowRejectDialog] = useState<string | null>(null);
  const [rejectDrafts, setRejectDrafts] = useState<Map<string, string>>(new Map());
  const [showEmailViewer, setShowEmailViewer] = useState<QueueItem | null>(null);
  const [emailViewerMode, setEmailViewerMode] = useState<'view' | 'edit'>('view');
  const [processingItems, setProcessingItems] = useState<Set<string>>(new Set());
  const [successItems, setSuccessItems] = useState<Set<string>>(new Set());

  // Memoized selectors for derived state
  const selectedCount = useMemo(() => selectedItems.size, [selectedItems]);
  const hasSelectedItems = useMemo(() => selectedItems.size > 0, [selectedItems]);
  
  // Optimized item selection toggle
  const toggleSelectItem = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  // Optimized processing state handlers
  const setItemProcessing = useCallback((itemId: string, isProcessing: boolean) => {
    setProcessingItems(prev => {
      const newSet = new Set(prev);
      if (isProcessing) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }
      return newSet;
    });
  }, []);

  const setItemSuccess = useCallback((itemId: string, isSuccess: boolean) => {
    setSuccessItems(prev => {
      const newSet = new Set(prev);
      if (isSuccess) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }
      return newSet;
    });
  }, []);

  // Optimized queue item removal
  const removeQueueItem = useCallback((itemId: string) => {
    setQueueItems(prev => prev.filter(item => item.id !== itemId));
    setRejectDrafts(prev => {
      if (!prev.has(itemId)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  // Clear all selections
  const clearSelections = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const getRejectFeedback = useCallback((itemId: string | null) => {
    if (!itemId) {
      return '';
    }
    return rejectDrafts.get(itemId) ?? '';
  }, [rejectDrafts]);

  const setRejectFeedback = useCallback((itemId: string, feedback: string) => {
    setRejectDrafts(prev => {
      if (!feedback) {
        if (!prev.has(itemId)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      }

      const existing = prev.get(itemId);
      if (existing === feedback) {
        return prev;
      }

      const next = new Map(prev);
      next.set(itemId, feedback);
      return next;
    });
  }, []);

  const clearRejectFeedback = useCallback((itemId: string) => {
    setRejectDrafts(prev => {
      if (!prev.has(itemId)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const rejectFeedback = getRejectFeedback(showRejectDialog);

  return {
    // State
    selectedItems,
    queueItems,
    loading,
    showRejectDialog,
    rejectFeedback,
    showEmailViewer,
    emailViewerMode,
    processingItems,
    successItems,
    
    // Derived state
    selectedCount,
    hasSelectedItems,
    
    // Actions
    setSelectedItems,
    setQueueItems,
    setLoading,
    setShowRejectDialog,
    setRejectFeedback,
    clearRejectFeedback,
    getRejectFeedback,
    setShowEmailViewer,
    setEmailViewerMode,
    setProcessingItems,
    setSuccessItems,
    toggleSelectItem,
    setItemProcessing,
    setItemSuccess,
    removeQueueItem,
    clearSelections
  };
}
