'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { isDevWhatsAppPromoForced } from '@/dev/uiOverrides';

const STORAGE_KEY = 'whatsapp-promo:v1';

interface WhatsAppPromoModalState {
  isOpen: boolean;
  hasSeen: boolean;
  isReady: boolean;
  isLoading: boolean;
}

/**
 * Hook to manage the WhatsApp promotional modal state.
 *
 * Shows the promo card after onboarding is complete, unless:
 * - User has already seen it (persisted via API to DB)
 * - Dev mode is forcing it to show (NEXT_PUBLIC_DEV_WHATSAPP_PROMO=force)
 *
 * Uses localStorage as a fast cache, but the source of truth is the DB.
 */
export const useWhatsAppPromoModal = () => {
  const { data: session } = useSession();
  const { isOnboardingComplete } = useOnboardingStatus();
  const [state, setState] = useState<WhatsAppPromoModalState>({
    isOpen: false,
    hasSeen: false,
    isReady: false,
    isLoading: true,
  });

  // Check if user has seen the promo (from localStorage cache or server)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!session?.userId) return;

    const devForced = isDevWhatsAppPromoForced();

    // Quick check from localStorage cache first
    const cachedSeen = window.localStorage.getItem(STORAGE_KEY);
    const localHasSeen = cachedSeen === 'true';

    // If dev mode is forcing display, always show
    if (devForced) {
      setState({
        isOpen: true,
        hasSeen: false,
        isReady: true,
        isLoading: false,
      });
      return;
    }

    // Check server for the actual state
    const checkServerState = async () => {
      try {
        const response = await fetch('/api/user/whatsapp-promo-status');
        if (response.ok) {
          const data = await response.json();
          const serverHasSeen = data.hasSeen === true;

          // Update localStorage cache
          if (serverHasSeen) {
            window.localStorage.setItem(STORAGE_KEY, 'true');
          } else {
            window.localStorage.removeItem(STORAGE_KEY);
          }

          // Show modal if onboarding complete and hasn't seen
          const shouldShow = isOnboardingComplete && !serverHasSeen;

          setState({
            isOpen: shouldShow,
            hasSeen: serverHasSeen,
            isReady: true,
            isLoading: false,
          });
        } else {
          // On error, fall back to showing if onboarding complete
          setState({
            isOpen: isOnboardingComplete && !localHasSeen,
            hasSeen: localHasSeen,
            isReady: true,
            isLoading: false,
          });
        }
      } catch (error) {
        console.warn('Failed to check WhatsApp promo status:', error);
        setState({
          isOpen: isOnboardingComplete && !localHasSeen,
          hasSeen: localHasSeen,
          isReady: true,
          isLoading: false,
        });
      }
    };

    checkServerState();
  }, [session?.userId, isOnboardingComplete]);

  // Separate effect to handle when onboarding becomes complete after initial load
  // This ensures the modal shows up even if onboarding completes after the component mounts
  useEffect(() => {
    // Only run if we're ready and onboarding just became complete
    if (!state.isReady || !isOnboardingComplete || state.hasSeen || state.isOpen) {
      return;
    }

    // Check if we should show the modal now that onboarding is complete
    const devForced = isDevWhatsAppPromoForced();
    if (devForced) {
      setState(prev => ({ ...prev, isOpen: true }));
      return;
    }

    // If onboarding is complete and user hasn't seen the promo, show it
    if (!state.hasSeen) {
      console.log('WhatsApp promo: Onboarding complete, showing promo');
      setState(prev => ({ ...prev, isOpen: true }));
    }
  }, [isOnboardingComplete, state.isReady, state.hasSeen, state.isOpen]);

  // Mark promo as seen (persist to server + localStorage)
  const markAsSeen = useCallback(async () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    }

    setState((prev) => ({
      ...prev,
      isOpen: false,
      hasSeen: true,
    }));

    // Persist to server (fire and forget)
    try {
      await fetch('/api/user/whatsapp-promo-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seen: true }),
      });
    } catch (error) {
      console.warn('Failed to persist WhatsApp promo status:', error);
    }
  }, []);

  const handleClose = useCallback(() => {
    markAsSeen();
  }, [markAsSeen]);

  const handleConnect = useCallback(() => {
    markAsSeen();
  }, [markAsSeen]);

  return {
    isOpen: state.isOpen,
    hasSeen: state.hasSeen,
    isReady: state.isReady,
    isLoading: state.isLoading,
    close: handleClose,
    connect: handleConnect,
  };
};
