import { useCallback, useEffect, useRef } from 'react';

/**
 * Optimized deferred removal hook with better memory management
 * Extracted from QueuePage for reusability and performance
 */
export function useDeferredRemoval(
  delayMs: number,
  removeFromSuccess: (itemId: string) => void,
  removeFromQueue: (itemId: string) => void
) {
  const timersRef = useRef<Map<string, number>>(new Map());
  const removeFromSuccessRef = useRef(removeFromSuccess);
  const removeFromQueueRef = useRef(removeFromQueue);

  // Keep refs current without causing re-renders
  useEffect(() => {
    removeFromSuccessRef.current = removeFromSuccess;
  }, [removeFromSuccess]);

  useEffect(() => {
    removeFromQueueRef.current = removeFromQueue;
  }, [removeFromQueue]);

  const schedule = useCallback((itemId: string) => {
    // Clear existing timer for this item
    const existing = timersRef.current.get(itemId);
    if (existing) {
      window.clearTimeout(existing);
    }

    // Set new timer
    const timerId = window.setTimeout(() => {
      removeFromSuccessRef.current(itemId);
      removeFromQueueRef.current(itemId);
      timersRef.current.delete(itemId);
    }, delayMs);

    timersRef.current.set(itemId, timerId);
  }, [delayMs]);

  const cancel = useCallback((itemId: string) => {
    const timer = timersRef.current.get(itemId);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(itemId);
    }
  }, []);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { schedule, cancel };
}