'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ai-chat-open';

export const useAIChatPopup = () => {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (error) {
      console.warn('AI chat: failed to read open state from storage.', error);
      return false;
    }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setIsFullscreen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (!next) setIsFullscreen(false);
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(isOpen));
    } catch (error) {
      console.warn('AI chat: failed to persist open state.', error);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key !== '0') return;
      event.preventDefault();
      toggle();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggle]);

  return {
    isOpen,
    isFullscreen,
    open,
    close,
    toggle,
    toggleFullscreen,
  };
};
