'use client';

import React, { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { AIFloatingButton } from './AIFloatingButton';
import { AIChatPopup } from './AIChatPopup';
import { useAIChatPopup } from './useAIChatPopup';
import type { AIChatMessage } from './types';

interface AIChatShellProps {
  initialMessages: AIChatMessage[];
}

export const AIChatShell: React.FC<AIChatShellProps> = ({
  initialMessages,
}) => {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const { isOpen, isFullscreen, toggle, close, toggleFullscreen } = useAIChatPopup();
  const [chatKey, setChatKey] = useState(0);

  const handleClear = useCallback(() => {
    // Increment key to force remount and clear messages
    setChatKey((prev) => prev + 1);
  }, []);

  if (status === 'loading' || !session?.userId) return null;

  // Hide AI chat during onboarding flow
  const isOnOnboardingPage = pathname?.startsWith('/onboarding-test-flow');

  if (isOnOnboardingPage) return null;

  return (
    <>
      <AIFloatingButton isOpen={isOpen} onToggle={toggle} />
      <AIChatPopup
        key={chatKey}
        isOpen={isOpen}
        isFullscreen={isFullscreen}
        onClose={close}
        onToggleFullscreen={toggleFullscreen}
        initialMessages={initialMessages}
        onClearRequest={handleClear}
      />
    </>
  );
};
