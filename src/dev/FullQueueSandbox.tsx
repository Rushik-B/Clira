"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { RefreshCw } from 'lucide-react';
import { QueueStats } from '@/components/ui/queue-page/QueueStats';
import { QueueBulkActions } from '@/components/ui/queue-page/QueueBulkActions';
import { QueueEmptyState } from '@/components/ui/queue-page/QueueEmptyState';
import { EmailQueueCard } from '@/components/ui/queue-page/EmailQueueCard';
import { RejectDialog } from '@/components/ui/queue-page/RejectDialog';
import { EmailViewer } from '@/components/ui/queue-page/EmailViewer';
import { Toast } from '@/components/ui/queue-page/Toast';
import { QueueFilters } from '@/components/ui/queue-page/QueueFilters';
import { mockQueueItems } from '@/data/mockQueueData';
import { useQueueState } from '@/hooks/queue/useQueueState';
import { useToast } from '@/hooks/queue/useToast';
import { useQueueFilters } from '@/hooks/queue/useQueueFilters';
import { useSandboxQueueActions } from '@/dev/useSandboxQueueActions';
import { getQueueSubtitle } from '@/lib/utils/timeOfDayCopy';

export function FullQueueSandbox() {
  const queueState = useQueueState();
  const {
    setShowRejectDialog,
    setRejectFeedback,
    clearRejectFeedback,
    setShowEmailViewer,
    setEmailViewerMode,
    clearSelections,
    selectedItems
  } = queueState;
  const { toast, showToast, hideToast, resetToast } = useToast();
  const [mailboxFilter, setMailboxFilter] = useState('all');

  // Load mock data once
  useEffect(() => {
    queueState.setLoading(false);
    queueState.setQueueItems(mockQueueItems);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const queueActions = useSandboxQueueActions({
    queueItems: queueState.queueItems,
    setItemProcessing: queueState.setItemProcessing,
    setItemSuccess: queueState.setItemSuccess,
    removeQueueItem: queueState.removeQueueItem,
    showToast,
  });

  const {
    filteredItems,
    mailboxOptions,
    isMailboxFilterActive,
  } = useQueueFilters({
    items: queueState.queueItems,
    mailboxFilter,
  });
  const isFilterActive = isMailboxFilterActive;

  const openViewer = useCallback((itemId: string, nextMode: 'view' | 'edit') => {
    const item = queueState.queueItems.find(q => q.id === itemId);
    if (!item) {
      return;
    }
    setEmailViewerMode(nextMode);
    setShowEmailViewer(item);
  }, [queueState.queueItems, setEmailViewerMode, setShowEmailViewer]);

  const handleAction = useCallback((
    itemId: string,
    actionType: string,
    data?: { content: string; cc?: string }
  ) => {
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

  const activeRejectId = queueState.showRejectDialog;
  const activeRejectFeedback = queueState.rejectFeedback;
  
  // Derive send status for the currently open viewer from sandbox processing/success state
  const viewerSendStatus: 'sending' | 'sent' | undefined = queueState.showEmailViewer
    ? (queueState.processingItems.has(queueState.showEmailViewer.id)
        ? 'sending'
        : (queueState.successItems.has(queueState.showEmailViewer.id)
            ? 'sent'
            : undefined))
    : undefined;

  // Provide navigation for EmailViewer so it advances to next item and stays open
  const viewerNavigation = useMemo(() => {
    if (!queueState.showEmailViewer || filteredItems.length === 0) return undefined;

    // Find current item index more robustly
    const currentItem = queueState.showEmailViewer;
    const currentIndex = filteredItems.findIndex(q => q.id === currentItem.id);

    // If current item not found in queue, the item might have been removed
    // In this case, we can't reliably determine navigation, so return undefined
    if (currentIndex === -1 || !currentItem) {
      return undefined;
    }

    // Recalculate current index in case queue has changed
    const currentIdx = filteredItems.findIndex(q => q.id === currentItem.id);
    const hasPrevious = currentIdx > 0;
    const hasNext = currentIdx >= 0 && currentIdx < filteredItems.length - 1;

    const goToNext = () => {
      if (hasNext && currentIdx + 1 < filteredItems.length) {
        const nextItem = filteredItems[currentIdx + 1];
        if (nextItem) {
          setEmailViewerMode('view');
          setShowEmailViewer(nextItem);
        }
      }
    };

    const goToPrevious = () => {
      if (hasPrevious && currentIdx - 1 >= 0) {
        const prevItem = filteredItems[currentIdx - 1];
        if (prevItem) {
          setEmailViewerMode('view');
          setShowEmailViewer(prevItem);
        }
      }
    };

    return {
      goToNext,
      goToPrevious,
      hasNext,
      hasPrevious,
      position: currentIdx >= 0 ? { index: currentIdx, total: filteredItems.length } : undefined,
    };
  }, [queueState.showEmailViewer, filteredItems, setEmailViewerMode, setShowEmailViewer]);

  return (
    <div className="min-h-[100dvh] sm:min-h-screen flex flex-col bg-black relative overflow-hidden">
      {/* Mobile Header actions would go here if needed */}

      <div className="flex-1 space-y-8 w-full max-w-none p-8 pt-24 sm:pt-8 relative z-10">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <PageHeader
            title=""
            subtitle={getQueueSubtitle()}
            showGreeting={true}
          />
          <div className="hidden sm:flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <LiquidButton
              onClick={() => {
                queueState.setQueueItems(mockQueueItems);
                showToast('Refreshed mock queue', 'info');
              }}
              minWidth="md"
              responsive
              variant="default"
              size="lg"
              className={LIQUID_BUTTON_BASE_CLASS}
            >
              <span className="flex items-center gap-2">
                <RefreshCw size={16} />
                Refresh
              </span>
            </LiquidButton>
          </div>
        </div>

        {/* Stats Bar */}
        <QueueStats itemCount={filteredItems.length} />

        {/* Filters */}
        <QueueFilters
          mailboxFilter={mailboxFilter}
          onMailboxFilterChange={setMailboxFilter}
          mailboxOptions={mailboxOptions}
          filteredCount={filteredItems.length}
          totalCount={queueState.queueItems.length}
        />

        {/* Bulk Actions - Desktop */}
        <div className="hidden sm:block">
          <QueueBulkActions 
            selectedCount={queueState.selectedCount}
            onBulkApprove={handleBulkApprove}
            onBulkReject={handleBulkReject}
          />
        </div>

        {/* Email List */}
        {queueState.loading ? (
          <div />
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
        ) : (
          <QueueEmptyState />
        )}

        {/* Toast */}
        <Toast 
          message={toast.message}
          type={toast.type}
          isVisible={toast.isVisible}
          onClose={hideToast}
          onAnimationEnd={resetToast}
        />
      </div>

      {/* Modals */}
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
          mode={queueState.emailViewerMode}
          navigation={viewerNavigation}
          sendStatus={viewerSendStatus}
        />
      )}
    </div>
  );
}
