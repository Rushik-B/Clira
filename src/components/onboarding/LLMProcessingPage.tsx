"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiStepLoader as Loader } from "@/components/ui/multi-step-loader";
import { SparklesCore } from "../ui/sparkles";

interface LLMProcessingPageProps {
  onNext: (data?: any) => void;
  onBack?: () => void;
  userName?: string;
}

// Lock sparkles state by memoizing the background component
const SparklesBackground = React.memo(function SparklesBackground() {
  return (
    <div className="fixed inset-0 w-screen h-screen">
      <SparklesCore
        id="tsparticlesfullpage"
        background="transparent"
        minSize={0.6}
        maxSize={1.4}
        particleDensity={50}
        className="w-full h-full"
        particleColor="#3b82f6"
        speed={0.5}
      />
    </div>
  );
});

export const LLMProcessingPage: React.FC<LLMProcessingPageProps> = ({
  onNext,
  onBack,
  userName = "there",
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Multi-step loading messages (UI only)
  const loadingStates = useMemo(
    () => [
      { text: "Connecting to your inbox" },
      { text: "Fetching recent messages" },
      { text: "Analyzing email patterns" },
      { text: "Clustering related conversations" },
      { text: "Proposing folder structure" },
      { text: "Building label mapping" },
      { text: "Validating categorization rules" },
      { text: "Finalizing setup" },
    ],
    []
  );

  const pollProcessing = useCallback(async () => {
    const REQUEST_TIMEOUT_MS = 25000; // per-request timeout to avoid Heroku 30s H12
    const OVERALL_TIMEOUT_MS = 180000; // overall budget similar to server-side wait
    const RETRY_DELAY_MS = 1500;
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < OVERALL_TIMEOUT_MS) {
        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        const timeoutId = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch("/api/onboarding/email-categorization", {
            signal: ctrl.signal,
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            if (data?.success) {
              setTimeout(() => {
                setLoading(false);
                onNext(data.result);
              }, 800);
              return;
            }
            // Not successful yet (or timeout hint) – keep polling
          } else {
            // Non-OK (e.g., 503 from Heroku) – just retry after delay
          }
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err?.name === "AbortError") {
            // per-request timeout or unmount – treat as retry unless unmounted
          } else {
            // network or other error – retry
          }
        }

        // small pause before next attempt
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }

      // overall budget exceeded
      setError("Analysis is taking longer than expected. Please try again.");
      setLoading(false);
    } catch {
      setError("An unexpected error occurred during analysis");
      setLoading(false);
    }
  }, [onNext]);

  useEffect(() => {
    // Kick off processing slightly after mount to allow initial render
    const t = setTimeout(() => pollProcessing(), 400);
    return () => {
      clearTimeout(t);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [pollProcessing]);

  if (error) {
    return (
      <div className="dark min-h-screen bg-black p-8 relative overflow-hidden">
        <SparklesBackground />
        <div className="max-w-2xl mx-auto text-center relative z-10 flex items-center justify-center min-h-screen">
          <div className="space-y-8">
            <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-12 h-12 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-white mb-4">Processing Failed</h1>
            <p className="text-gray-300 text-lg mb-8">{error}</p>
            <div className="space-y-4">
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setTimeout(() => pollProcessing(), 300);
                }}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-semibold text-lg"
              >
                Try Again
              </button>
              {onBack && (
                <button
                  onClick={onBack}
                  className="px-8 py-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors font-semibold text-lg ml-4"
                >
                  Go Back
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-black p-8 relative overflow-hidden">
      {/* Sparkles stay mounted and unchanged across loader state updates */}
      <SparklesBackground />

      {/* Core Multi-Step Loader Overlay */}
      <Loader loadingStates={loadingStates} loading={loading} duration={4000} loop={false} />
    </div>
  );
};
