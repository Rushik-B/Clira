'use client';

import { useCallback, useEffect, useState } from 'react';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { getDevQueueIntroMode } from '@/dev/uiOverrides';

const STORAGE_KEY = 'queue-intro:v1';

export type QueueIntroDevMode = ReturnType<typeof getDevQueueIntroMode>;

interface QueueIntroModalState {
  isOpen: boolean;
  hasSeen: boolean;
  devMode: QueueIntroDevMode;
  isReady: boolean;
}

export const useQueueIntroModal = () => {
  const { isOnboardingComplete } = useOnboardingStatus();
  const [state, setState] = useState<QueueIntroModalState>({
    isOpen: false,
    hasSeen: false,
    devMode: 'off',
    isReady: false,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const devMode = getDevQueueIntroMode();
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    const hasSeen = storedValue === 'true';
    const shouldShow = devMode !== 'off'
      ? true
      : Boolean(isOnboardingComplete && !hasSeen);

    setState({
      isOpen: shouldShow,
      hasSeen,
      devMode,
      isReady: true,
    });
  }, [isOnboardingComplete]);

  const persistSeen = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    }
  }, []);

  const handleClose = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      hasSeen: true,
    }));
    persistSeen();
  }, [persistSeen]);

  const handleComplete = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      hasSeen: true,
    }));
    persistSeen();
  }, [persistSeen]);

  const reopen = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
    }));
  }, []);

  return {
    isOpen: state.isOpen,
    hasSeen: state.hasSeen,
    isReady: state.isReady,
    devMode: state.devMode,
    close: handleClose,
    complete: handleComplete,
    reopen,
  };
};
