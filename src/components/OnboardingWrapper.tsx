'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

interface OnboardingWrapperProps {
  children: React.ReactNode;
}

export default function OnboardingWrapper({ children }: OnboardingWrapperProps) {
  const { data: session } = useSession();
  const { loading } = useOnboardingStatus();

  // Non-blocking: always render children; this wrapper now only ensures session is present
  // Optionally, we could render a tiny placeholder while session or status bootstraps
  if (!session?.user?.email && loading) {
    return <>{children}</>;
  }

  return <>{children}</>;
}