'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { GreetingPage } from '@/components/onboarding/GreetingPage';
import { PhoneInputPage } from '@/components/onboarding/PhoneInputPage';
import { SmartFolderSetupPage, SmartFolderSuggestion } from '@/components/onboarding/SmartFolderSetupPage';
import { MultiStepLoader } from '@/components/ui/multi-step-loader';
import { FastOnboardingJobPayload, FastOnboardingProposal, ExistingLabelSummary } from '@/lib/services/onboarding-services/types';
import { buildFallbackFastOnboardingProposal } from '@/lib/services/onboarding-services/utils/folderFallbacks';

const loaderSteps = [
  { text: 'Connecting to your inbox…' },
  { text: 'Fetching your labels…' },
  { text: 'Scanning recent emails…' },
  { text: 'Analyzing senders…' },
  { text: 'Finding topics and patterns…' },
  { text: 'Grouping by projects and clients…' },
  { text: 'Detecting newsletters and promos…' },
  { text: 'Spotting action items…' },
  { text: 'Drafting smart folders…' },
  { text: 'Checking conflicts with existing labels…' },
  { text: 'Finalizing suggestions…' },
  { text: 'Preparing setup…' },
];

const STEP_DURATION_MS = 2500; // ~2.5s per step
const TOTAL_LOADING_MS = loaderSteps.length * STEP_DURATION_MS; // ~30s total
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_DURATION_MS = 3 * 60 * 1000; // allow up to 3 minutes for background processing

const emptyLabels: ExistingLabelSummary = {
  databaseLabels: [],
  gmailLabels: [],
  combinedLabels: [],
  totalCount: 0,
};

const emptyProposal: FastOnboardingProposal = {
  suggestions: [],
  existingLabels: emptyLabels,
  filteringStats: {
    totalFetched: 0,
    skippedForCustomLabels: 0,
    processable: 0,
  },
  totalAnalyzed: 0,
  fallbackUsed: false,
};

type Stage = 'greeting' | 'phone' | 'loading' | 'setup';

const buildProposalKey = (suggestions: SmartFolderSuggestion[]) =>
  suggestions.length === 0 ? 'empty-proposal' : suggestions.map(item => item.id).join('|');

export default function OnboardingFlow() {
  const { status } = useSession();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>('greeting');
  const [proposal, setProposal] = useState<FastOnboardingProposal>(emptyProposal);
  const [autoSortingEnabled, setAutoSortingEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadingStartTimeRef = useRef<number | null>(null);
  const proposalReadyRef = useRef<boolean>(false);

  const createFallbackProposal = useCallback(
    (labels?: ExistingLabelSummary): FastOnboardingProposal => {
      const fallback = buildFallbackFastOnboardingProposal(labels ?? emptyLabels);
      const timestamp = Date.now().toString(36);
      return {
        ...fallback,
        suggestions: fallback.suggestions.map((folder, index) => ({
          ...folder,
          id: `${folder.id}-${timestamp}-${index}`,
        })),
      };
    },
    []
  );

  // Abortable delay helper to avoid setTimeout races
  const waitWithAbort = useCallback((ms: number, signal?: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }, []);

  const runProposalGeneration = useCallback(async (signal?: AbortSignal) => {
    setError(null);

    const normalizePayload = (data: any): FastOnboardingJobPayload => ({
      proposal: (data?.proposal ?? emptyProposal) as FastOnboardingProposal,
      autoSortingEnabled: data?.autoSortingEnabled ?? true,
      generatedAt: data?.generatedAt ?? new Date().toISOString(),
    });

    const pollJobUntilReady = async (jobId: string): Promise<FastOnboardingJobPayload> => {
      const startedAt = Date.now();
      while (true) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const res = await fetch(`/api/onboarding/folders/generate-fast?jobId=${encodeURIComponent(jobId)}`, {
          method: 'GET',
          cache: 'no-store',
          signal,
        });

        let body: any = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }

        if (res.status >= 400 && res.status !== 202) {
          throw new Error(body?.error ?? `Folder generation failed (job ${jobId})`);
        }

        if (body?.success === false) {
          throw new Error(body?.error ?? `Folder generation failed (job ${jobId})`);
        }

        if (body?.success && body?.ready && body?.data?.proposal) {
          return normalizePayload(body.data);
        }

        if (Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
          throw new Error('Timed out waiting for folder suggestions');
        }

        await waitWithAbort(POLL_INTERVAL_MS, signal);
      }
    };

    const fetchPayload = async (): Promise<FastOnboardingJobPayload> => {
      const response = await fetch('/api/onboarding/folders/generate-fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed with status ${response.status}`);
      }

      if (data?.success && data?.data?.proposal) {
        return normalizePayload(data.data);
      }

      if (data?.jobId) {
        return pollJobUntilReady(data.jobId as string);
      }

      throw new Error(data?.error ?? 'Failed to generate folder suggestions');
    };

    try {
      const payload = await fetchPayload();
      if (signal?.aborted) return;
      setProposal(payload.proposal);
      setAutoSortingEnabled(payload.autoSortingEnabled);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') {
        return;
      }
      console.error('[FAST ONBOARDING] generate-fast failed', err);
      setProposal(prev => createFallbackProposal(prev.existingLabels));
      setAutoSortingEnabled(false);
      setError(err instanceof Error ? err.message : 'Failed to generate folder suggestions');
    }
  }, [createFallbackProposal, waitWithAbort]);

  const handleGreetingNext = useCallback(async () => {
    // cancel any previous in-flight work
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const ac = new AbortController();
    abortControllerRef.current = ac;

    // Record start time and start background processing
    loadingStartTimeRef.current = Date.now();
    proposalReadyRef.current = false;

    // Start proposal generation in background (don't await)
    runProposalGeneration(ac.signal).then(() => {
      proposalReadyRef.current = true;
    }).catch((err) => {
      if ((err as any)?.name !== 'AbortError') {
        proposalReadyRef.current = true; // Even on error, mark as "ready" (fallback will be used)
      }
    });

    // Navigate to phone input page immediately
    setStage('phone');
  }, [runProposalGeneration]);

  const handlePhoneNext = useCallback(async (_phoneNumber: string | null) => {
    const ac = abortControllerRef.current;
    const startTime = loadingStartTimeRef.current;

    // Calculate remaining time for the loader animation
    const elapsedMs = startTime ? Date.now() - startTime : 0;
    const remainingMs = Math.max(0, TOTAL_LOADING_MS - elapsedMs);

    // Show loading screen
    setStage('loading');

    try {
      // Wait for the remaining animation time (user already spent time on phone input)
      if (remainingMs > 0) {
        await waitWithAbort(remainingMs, ac?.signal);
      }

      // Ensure proposal generation is complete
      // (it should be by now, but wait a bit more if needed)
      let waitedForProposal = 0;
      const maxProposalWait = 30000; // 30s max additional wait
      while (!proposalReadyRef.current && waitedForProposal < maxProposalWait) {
        await waitWithAbort(500, ac?.signal);
        waitedForProposal += 500;
      }

      if (!ac?.signal.aborted) {
        setStage('setup');
      }
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      if (!ac?.signal.aborted) {
        setStage('setup');
      }
    }
  }, [waitWithAbort]);

  const handlePhoneSkip = useCallback(async () => {
    // Same as handlePhoneNext, just without saving a phone number
    await handlePhoneNext(null);
  }, [handlePhoneNext]);

  const handlePhoneBack = useCallback(() => {
    // Cancel background work and go back to greeting
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    loadingStartTimeRef.current = null;
    proposalReadyRef.current = false;
    setStage('greeting');
  }, []);

  const handleRetry = useCallback(async () => {
    // cancel any previous in-flight work
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const ac = new AbortController();
    abortControllerRef.current = ac;
    setStage('loading');
    try {
      await Promise.all([
        runProposalGeneration(ac.signal),
        waitWithAbort(TOTAL_LOADING_MS, ac.signal),
      ]);
      if (!ac.signal.aborted) {
        setStage('setup');
      }
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      if (!ac.signal.aborted) {
        setStage('setup');
      }
    }
  }, [runProposalGeneration, waitWithAbort]);

  const handleSubmit = useCallback(
    async (acceptedFolders: SmartFolderSuggestion[]) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const response = await fetch('/api/onboarding/folders/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            acceptedFolders,
            autoSortingEnabled,
          }),
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (!data?.success) {
          throw new Error(data?.error ?? 'Failed to save folders');
        }

        router.replace('/');
      } catch (err) {
        console.error('[FAST ONBOARDING] accept failed', err);
        setError(err instanceof Error ? err.message : 'Failed to save folders');
      } finally {
        setIsSubmitting(false);
      }
    },
    [autoSortingEnabled, router]
  );

  const handleSkip = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/onboarding/folders/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptedFolders: [],
          autoSortingEnabled,
          skip: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data?.success) {
        throw new Error(data?.error ?? 'Failed to skip onboarding');
      }

      router.replace('/');
    } catch (err) {
      console.error('[FAST ONBOARDING] skip failed', err);
      setError(err instanceof Error ? err.message : 'Failed to skip onboarding');
    } finally {
      setIsSubmitting(false);
    }
  }, [autoSortingEnabled, router]);

  const proposalKey = useMemo(() => buildProposalKey(proposal.suggestions), [proposal.suggestions]);

  // Abort any in-flight work on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  if (status === 'loading') {
    return <div className="min-h-screen bg-black" />;
  }

  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-black">
        <MultiStepLoader loading loadingStates={loaderSteps} duration={STEP_DURATION_MS} loop={false} />
      </div>
    );
  }

  if (stage === 'greeting') {
    return <GreetingPage onNext={handleGreetingNext} />;
  }

  if (stage === 'phone') {
    return (
      <PhoneInputPage
        onNext={handlePhoneNext}
        onBack={handlePhoneBack}
        onSkip={handlePhoneSkip}
      />
    );
  }

  return (
    <SmartFolderSetupPage
      key={proposalKey}
      proposals={proposal.suggestions}
      existingLabels={proposal.existingLabels ?? emptyLabels}
      autoSortingEnabled={autoSortingEnabled}
      onAutoSortingChange={setAutoSortingEnabled}
      onSubmit={handleSubmit}
      onSkip={handleSkip}
      onBack={() => setStage('greeting')}
      isSubmitting={isSubmitting}
      error={error}
      totalAnalyzed={proposal.totalAnalyzed}
      filteringStats={proposal.filteringStats}
      fallbackUsed={proposal.fallbackUsed}
      onRetry={handleRetry}
    />
  );
}
