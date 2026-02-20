"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmailQueueCard } from '@/components/ui/queue-page/EmailQueueCard';
import { QueueItem } from '@/types';
import { mockQueueItems } from '@/data/mockQueueData';
import { PageHeader } from '@/components/ui/PageHeader';
import { useQueueState } from '@/hooks/queue/useQueueState';
import { useToast } from '@/hooks/queue/useToast';
import { Toast } from '@/components/ui/queue-page/Toast';
import { RejectDialog } from '@/components/ui/queue-page/RejectDialog';
import { EmailViewer } from '@/components/ui/queue-page/EmailViewer';
import { QueueEmptyState } from '@/components/ui/queue-page/QueueEmptyState';
import { useSandboxQueueActions } from '@/dev/useSandboxQueueActions';
import { getQueueSubtitle } from '@/lib/utils/timeOfDayCopy';

// Small utility hook to encapsulate one-shot delays with cleanup
function useDelay(callback: () => void, ms: number) {
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) callback();
    }, ms);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [callback, ms]);
}

/**
 * Dev harness to render a single EmailQueueCard permanently in the
 * "Generating reply" state for local UI work. No network calls.
 */
export function EmailQueueCardDevHarness() {
  const base: QueueItem = mockQueueItems[0];
  const initialItem: QueueItem = useMemo(() => ({
    ...base,
    id: 'dev-generating-card',
    draftPreview: 'Generating reply…',
    confidence: 0,
    status: 'needs-attention',
    metadata: {
      ...base.metadata,
      receivedAt: new Date().toISOString(),
    },
  }), [base]);

  const [queueItems, setQueueItems] = useState<QueueItem[]>(() => [
    initialItem,
    ...mockQueueItems.filter(i => i.id !== base.id)
  ]);
  const queueState = useQueueState();
  const {
    setShowRejectDialog,
    setRejectFeedback,
    clearRejectFeedback,
    setShowEmailViewer,
    setEmailViewerMode
  } = queueState;
  const { toast, showToast, hideToast, resetToast } = useToast();

  const queueActions = useSandboxQueueActions({
    queueItems,
    setItemProcessing: queueState.setItemProcessing,
    setItemSuccess: queueState.setItemSuccess,
    removeQueueItem: (itemId: string) => setQueueItems(prev => prev.filter(i => i.id !== itemId)),
    showToast,
  });

  const openViewer = useCallback((itemId: string, nextMode: 'view' | 'edit') => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item) {
      return;
    }
    setEmailViewerMode(nextMode);
    setShowEmailViewer(item);
  }, [queueItems, setEmailViewerMode, setShowEmailViewer]);

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

  // Simulate generation finishing after ~10s on page load
  const finishGeneration = useCallback(() => {
    setQueueItems(prev => prev.map(item => {
      if (item.id !== initialItem.id) return item;
      // Transition the generating card into its fully generated state
      return {
        ...base,
        id: initialItem.id,
        metadata: {
          ...base.metadata,
          receivedAt: new Date().toISOString(),
        },
      } as QueueItem;
    }));
    showToast('✨ Reply generated and ready for review.', 'info');
  }, [base, initialItem.id, showToast]);

  useDelay(finishGeneration, 10000);

  const activeRejectId = queueState.showRejectDialog;
  const activeRejectFeedback = queueState.rejectFeedback;

  return (
    <div className="min-h-[100dvh] sm:min-h-screen flex flex-col bg-black relative overflow-hidden">
      {/* Ambient page glow effects - Desktop only for realistic preview */}
      <div className="hidden sm:block fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-96 h-96 bg-gradient-radial from-blue-500/8 via-blue-600/4 to-transparent rounded-full blur-3xl"></div>
        <div className="absolute top-1/4 left-0 w-64 h-64 bg-gradient-radial from-cyan-500/6 via-cyan-600/3 to-transparent rounded-full blur-2xl"></div>
        <div className="absolute top-3/4 right-0 w-64 h-64 bg-gradient-radial from-blue-400/6 via-blue-500/3 to-transparent rounded-full blur-2xl"></div>
      </div>

      <div className="flex-1 space-y-8 w-full max-w-none p-8 pt-24 sm:pt-8 relative z-10">
        <PageHeader
          title=""
          subtitle={getQueueSubtitle()}
          showGreeting={true}
        />

        {queueItems.length > 0 ? (
          <div className="space-y-0 sm:space-y-4 lg:space-y-6 -mx-8 sm:mx-0 sm:-mx-2">
            {queueItems.map(item => (
              <div key={item.id} className="sm:flex sm:items-start sm:space-x-3 lg:space-x-4 sm:px-2">
                <div className="flex-1 w-full min-w-0">
                  <EmailQueueCard
                    item={item}
                    onAction={handleAction}
                    isProcessing={queueState.processingItems.has(item.id)}
                    isSuccess={queueState.successItems.has(item.id)}
                    isSelected={false}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <QueueEmptyState />
        )}
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
        />
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
  );
}
