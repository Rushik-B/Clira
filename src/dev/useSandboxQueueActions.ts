"use client";

import { useCallback } from 'react';
import type { QueueItem } from '@/types';

type ToastType = 'success' | 'error' | 'info';

interface UseSandboxQueueActionsProps {
  queueItems: QueueItem[];
  setItemProcessing: (id: string, isProcessing: boolean) => void;
  setItemSuccess: (id: string, isSuccess: boolean) => void;
  removeQueueItem: (id: string) => void;
  showToast: (message: string, type: ToastType) => void;
}

/**
 * Small utility to simulate network delays with proper cleanup.
 */
function simulateDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => resolve(), ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

/**
 * Dev-only sandbox actions that mirror useQueueActions but avoid network calls.
 * Keeps UI behavior identical: processing state, success animation, and toasts.
 */
export function useSandboxQueueActions({
  queueItems,
  setItemProcessing,
  setItemSuccess,
  removeQueueItem,
  showToast,
}: UseSandboxQueueActionsProps) {
  const handleApprove = useCallback(async (itemId: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item) {
      showToast('Error: Email not found', 'error');
      return;
    }

    try {
      setItemProcessing(itemId, true);
      showToast('Sending email...', 'info');
      await simulateDelay(900, signal);
      setItemProcessing(itemId, false);
      setItemSuccess(itemId, true);
      const recipient = item.metadata?.from || 'recipient';
      showToast(`✅ Email sent successfully to ${recipient}!`, 'success');

      // Remove from UI after success animation - match real implementation timing
      setTimeout(() => {
        removeQueueItem(itemId);
      }, 1500);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setItemProcessing(itemId, false);
      showToast('Failed to send email. Please try again.', 'error');
    }
  }, [queueItems, setItemProcessing, setItemSuccess, removeQueueItem, showToast]);

  const handleReject = useCallback(async (itemId: string, feedback: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item) {
      showToast('Error: Email not found', 'error');
      return;
    }

    try {
      showToast('Submitting feedback...', 'info');
      await simulateDelay(500, signal);
      removeQueueItem(itemId);
      const sender = item.metadata?.from || 'sender';
      showToast(`✅ Feedback submitted! Response rejected for ${sender}`, 'success');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast('Failed to submit feedback', 'error');
    }
  }, [queueItems, removeQueueItem, showToast]);

  const handleEdit = useCallback(async (itemId: string, draftContent: string, ccRecipients?: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item) {
      showToast('Error: Email not found', 'error');
      return;
    }

    try {
      setItemProcessing(itemId, true);
      showToast('Sending edited email...', 'info');
      await simulateDelay(900, signal);
      setItemProcessing(itemId, false);
      setItemSuccess(itemId, true);
      const recipient = item.metadata?.from || 'recipient';
      showToast(`✅ Edited email sent successfully to ${recipient}!`, 'success');

      // Remove from UI after success animation - match real implementation timing
      setTimeout(() => {
        removeQueueItem(itemId);
      }, 1500);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setItemProcessing(itemId, false);
      showToast('Failed to send edited email. Please try again.', 'error');
    }
  }, [queueItems, setItemProcessing, setItemSuccess, removeQueueItem, showToast]);

  const handleDismiss = useCallback(async (itemId: string, signal?: AbortSignal) => {
    const item = queueItems.find(q => q.id === itemId);
    if (!item) {
      showToast('Error: Email not found', 'error');
      return;
    }
    try {
      removeQueueItem(itemId);
      const senderName = item.metadata?.from?.split('@')[0] || 'sender';
      showToast(`📤 Dismissed email from ${senderName}`, 'info');
    } catch {
      showToast('Failed to dismiss email', 'error');
    }
  }, [queueItems, removeQueueItem, showToast]);

  const handleBulkAction = useCallback((actionType: 'approve' | 'reject', selectedItems: Set<string>) => {
    const controller = new AbortController();
    selectedItems.forEach(itemId => {
      if (actionType === 'approve') {
        handleApprove(itemId, controller.signal);
      } else {
        handleReject(itemId, 'Bulk rejection.', controller.signal);
      }
    });
    return () => controller.abort();
  }, [handleApprove, handleReject]);

  return {
    handleApprove,
    handleReject,
    handleEdit,
    handleDismiss,
    handleBulkAction,
  };
}


