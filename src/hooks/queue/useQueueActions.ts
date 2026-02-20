'use client';

import { useCallback } from 'react';
import { useSession } from 'next-auth/react';
import type { QueueItem } from '@/types';

interface UseQueueActionsProps {
  queueItems: QueueItem[];
  setItemProcessing: (id: string, isProcessing: boolean) => void;
  setItemSuccess: (id: string, isSuccess: boolean) => void;
  removeQueueItem: (id: string) => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  invalidateCache: () => void;
}

/**
 * Queue actions hook with simple state management
 * No more caching complexity
 */
export function useQueueActions({
  queueItems,
  setItemProcessing,
  setItemSuccess,
  removeQueueItem,
  showToast,
  invalidateCache
}: UseQueueActionsProps) {
  const { data: session } = useSession();
  const userId = session?.userId;

  const handleApprove = useCallback(async (itemId: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item?.metadata?.emailId || !userId) {
      showToast('Error: Email not found', 'error');
      return;
    }

    try {
      setItemProcessing(itemId, true);
      showToast('Sending email...', 'info');

      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'approve', 
          emailId: item.metadata.emailId 
        }),
        signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setItemProcessing(itemId, false);
      setItemSuccess(itemId, true);
      showToast(`✅ Email sent successfully to ${item.metadata.from}!`, 'success');
      
      // Remove from UI after success animation
      setTimeout(() => {
        removeQueueItem(itemId);
      }, 1500);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Request was cancelled, no need to show error
      }
      
      setItemProcessing(itemId, false);
      showToast('Failed to send email. Please try again.', 'error');
      console.error('Error approving item:', error);
    }
  }, [queueItems, setItemProcessing, setItemSuccess, removeQueueItem, showToast, userId]);

  const handleReject = useCallback(async (itemId: string, feedback: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item?.metadata?.emailId || !userId) {
      showToast('Error: Email not found', 'error');
      return;
    }

    try {
      showToast('Submitting feedback...', 'info');
      
      // Remove from UI immediately
      removeQueueItem(itemId);

      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'reject', 
          emailId: item.metadata.emailId,
          feedback: feedback.trim(),
          metadata: {
            rejectionReason: feedback.trim(),
            originalDraft: item.fullDraft || item.draftPreview,
            emailSubject: item.metadata.subject,
            emailSender: item.metadata.from,
            confidenceScore: item.metadata.confidenceScore,
            rejectedAt: new Date().toISOString()
          }
        }),
        signal
      });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.error || `HTTP ${response.status}`);
      }

      showToast(`✅ Feedback submitted! Response rejected for ${item.metadata.from}`, 'success');

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Request was cancelled
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to submit feedback: ${errorMessage}`, 'error');
      console.error('Error rejecting item:', error);
    }
  }, [queueItems, removeQueueItem, showToast, userId]);

  const handleEdit = useCallback(async (itemId: string, draftContent: string, ccRecipients?: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item?.metadata?.emailId || !userId) {
      showToast('Error: Email not found', 'error');
      return;
    }

    try {
      setItemProcessing(itemId, true);
      showToast('Sending edited email...', 'info');

      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'edit', 
          emailId: item.metadata.emailId,
          draftContent,
          ccRecipients 
        }),
        signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setItemProcessing(itemId, false);
      setItemSuccess(itemId, true);
      showToast(`✅ Edited email sent successfully to ${item.metadata.from}!`, 'success');
      
      // Remove from UI after success animation
      setTimeout(() => {
        removeQueueItem(itemId);
      }, 1500);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Request was cancelled
      }
      
      setItemProcessing(itemId, false);
      showToast('Failed to send edited email. Please try again.', 'error');
      console.error('Error sending edited email:', error);
    }
  }, [queueItems, setItemProcessing, setItemSuccess, removeQueueItem, showToast, userId]);

  const handleBulkAction = useCallback((actionType: 'approve' | 'reject', selectedItems: Set<string>) => {
    if (!userId) return () => {};
    
    const controller = new AbortController();
    
    selectedItems.forEach(itemId => {
      if (actionType === 'approve') {
        handleApprove(itemId, controller.signal);
      } else if (actionType === 'reject') {
        handleReject(itemId, 'Bulk rejection.', controller.signal);
      }
    });

    return () => controller.abort(); // Return cleanup function
  }, [handleApprove, handleReject, userId]);

  const handleDismiss = useCallback(async (itemId: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item?.metadata?.emailId || !userId) {
      showToast('Error: Email not found', 'error');
      return;
    }

    try {
      // Remove from UI immediately with a subtle notification
      removeQueueItem(itemId);
      const senderName = item.metadata.from?.split('@')[0] || 'sender';
      showToast(`📤 Dismissed email from ${senderName}`, 'info');

      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'dismiss', 
          emailId: item.metadata.emailId,
          metadata: {
            originalDraft: item.fullDraft || item.draftPreview,
            emailSubject: item.metadata.subject,
            emailSender: item.metadata.from,
            confidenceScore: item.metadata.confidenceScore,
            dismissedAt: new Date().toISOString()
          }
        }),
        signal
      });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.error || `HTTP ${response.status}`);
      }

      // Success is silent since the item already disappeared - more elegant UX

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Request was cancelled
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to dismiss email: ${errorMessage}`, 'error');
      console.error('Error dismissing item:', error);
    }
  }, [queueItems, removeQueueItem, showToast, userId]);

  return {
    handleApprove,
    handleReject,
    handleEdit,
    handleDismiss,
    handleBulkAction
  };
}