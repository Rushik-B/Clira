'use client';

import React from 'react';
import Link from 'next/link';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

export const OnboardingStatusBanner: React.FC = () => {
  const { status, loading } = useOnboardingStatus();

  // Remove polling - the useOnboardingStatus hook handles all refresh logic internally
  // This prevents duplicate polling and infinite loops

  if (loading || !status) return null;

  const automatedDone = !!status.masterPromptGenerated;

  const needsLabeling = automatedDone && !status.labelingOnboardingGenerated;

  if (needsLabeling) {
    return (
      <div className="mb-4 rounded-xl border border-purple-600/30 bg-purple-950/30 text-purple-200 px-4 py-3 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold">Personalization ready.</span> Review labels to finish setup.
        </div>
        <Link
          href="/onboarding-test-flow"
          className="text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5"
        >
          Review labels
        </Link>
      </div>
    );
  }

  if (!automatedDone) {
    return (
      <div className="mb-4 rounded-xl border border-blue-600/30 bg-blue-950/30 text-blue-200 px-4 py-3 text-sm">
        <span className="font-semibold">Personalization in progress…</span> You can use the app while we finish setting things up.
      </div>
    );
  }

  return null;
};
