'use client';

import { useState, useCallback } from 'react';

export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  isVisible: boolean;
}

/**
 * Event-driven toast hook without setTimeout
 * Uses animation events and transitions for proper state management
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState>({
    message: '',
    type: 'info',
    isVisible: false
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type, isVisible: true });
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, isVisible: false }));
  }, []);

  const resetToast = useCallback(() => {
    setToast({
      message: '',
      type: 'info',
      isVisible: false
    });
  }, []);

  return {
    toast,
    showToast,
    hideToast,
    resetToast
  };
}