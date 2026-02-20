import { useEffect, useRef } from 'react';

/**
 * Optimized auto-dismiss hook with proper cleanup
 * Extracted from QueuePage for reusability and performance
 */
export function useAutoDismiss(
  isVisible: boolean, 
  onClose: () => void, 
  delayMs: number = 4000
) {
  const onCloseRef = useRef(onClose);
  const timerRef = useRef<number | null>(null);

  // Keep ref current without causing re-renders
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isVisible) {
      // Clear any existing timer when becoming invisible
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Set new timer when becoming visible
    timerRef.current = window.setTimeout(() => {
      onCloseRef.current();
      timerRef.current = null;
    }, delayMs);

    // Cleanup function
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isVisible, delayMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);
}