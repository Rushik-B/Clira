'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ExistingLabelSummary, GeneratedFolders } from '@/lib/services/onboarding-services/types';
import { ArrowLeft, Sparkles, Tag, ThickCheck, InfoCircle } from '@/components/icons/icons';
import { LiquidButton } from '@/components/ui/buttons/liquid-glass-button';
import { PrimaryButton } from '@/components/ui/buttons';

export type SmartFolderSuggestion = GeneratedFolders['suggestedFolders'][number] & { id: string };

type FilteringStats = {
  totalFetched: number;
  skippedForCustomLabels: number;
  processable: number;
};

interface SmartFolderSetupPageProps {
  proposals: SmartFolderSuggestion[];
  existingLabels: ExistingLabelSummary;
  autoSortingEnabled?: boolean;
  onAutoSortingChange: (value: boolean) => void;
  onSubmit: (accepted: SmartFolderSuggestion[]) => Promise<void>;
  onSkip: () => Promise<void>;
  onBack: () => void;
  isSubmitting: boolean;
  error?: string | null;
  totalAnalyzed: number;
  filteringStats: FilteringStats;
  fallbackUsed: boolean;
  onRetry?: () => void;
}

function formatNumber(value: number) {
  return value.toLocaleString();
}

type SelectionMap = Record<string, boolean>;

const LabelPill: React.FC<{ name: string; color?: string }> = ({ name, color }) => (
  <span
    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white"
    style={color ? { color, borderColor: `${color}55`, backgroundColor: `${color}15` } : undefined}
  >
    <Tag className="h-[14px] w-[14px]" /> {name}
  </span>
);

export const SmartFolderSetupPage: React.FC<SmartFolderSetupPageProps> = ({
  proposals,
  existingLabels,
  autoSortingEnabled = true, // Default to true
  onAutoSortingChange,
  onSubmit,
  onSkip,
  onBack,
  isSubmitting,
  error,
  totalAnalyzed,
  filteringStats,
  fallbackUsed,
  onRetry,
}) => {
  const initialSelection: SelectionMap = useMemo(() => {
    const map: SelectionMap = {};
    for (const s of proposals) map[s.id] = true;
    return map;
  }, [proposals]);

  const [selected, setSelected] = useState<SelectionMap>(initialSelection);
  const [aiVisible, setAiVisible] = useState(false);
  const [disableWarningOpen, setDisableWarningOpen] = useState(false);
  const autoSortInitializedRef = useRef(false);

  useEffect(() => {
    setAiVisible(true);
  }, []);

  useEffect(() => {
    if (autoSortInitializedRef.current) {
      return;
    }
    autoSortInitializedRef.current = true;
    if (!autoSortingEnabled) {
      onAutoSortingChange(true);
    }
  }, [autoSortingEnabled, onAutoSortingChange]);

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const currentLabels = useMemo(() => existingLabels.combinedLabels.map((l) => l.name), [existingLabels]);
  const handleToggle = (id: string) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const handleSelectAll = () => setSelected(Object.fromEntries(proposals.map((p) => [p.id, true])));
  const handleClearAll = () => setSelected(Object.fromEntries(proposals.map((p) => [p.id, false])));

  const handleSubmit = async () => {
    await onSubmit(proposals.filter((p) => selected[p.id]));
  };

  const handleAutoSortSwitchClick = () => {
    if (autoSortingEnabled) {
      // Warn before disabling
      setDisableWarningOpen(true);
    } else {
      onAutoSortingChange(true);
    }
  };

  const confirmDisableAutoSort = () => {
    onAutoSortingChange(false);
    setDisableWarningOpen(false);
  };

  const cancelDisableAutoSort = () => {
    setDisableWarningOpen(false);
  };

  return (
    <>
    <div className="min-h-screen bg-[#05060A] text-white overflow-x-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-12">

        <div className="space-y-6">
          {/* Title and Description */}
          <div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-100 to-blue-200 tracking-tight leading-tight drop-shadow-[0_0_8px_rgba(59,130,246,0.3)] break-words">Choose your labels</h1>
            <p className="mt-2 text-slate-300 max-w-2xl text-[15px] sm:text-base break-words">
              Clira analyzed your inbox and drafted helpful label suggestions to keep things tidy. Pick what fits your workflow; you can adjust these anytime.
            </p>
            {error && (
              <div className="mt-3 text-sm text-red-300 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
                {error} {onRetry && (<button className="underline ml-2" onClick={onRetry}>Try again</button>)}
              </div>
            )}
          </div>

          {/* Auto-sort Toggle - Better mobile layout */}
          <div className="flex justify-center sm:justify-end">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 w-full sm:w-auto">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium break-words">Auto-sort new emails</p>
                <p className="text-[11px] text-slate-400 break-words">{autoSortingEnabled ? 'Enabled' : 'Disabled'}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoSortingEnabled}
                onClick={handleAutoSortSwitchClick}
                className={`relative h-7 w-14 rounded-full transition flex-shrink-0 ${autoSortingEnabled ? 'bg-emerald-500/80' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow transition ${autoSortingEnabled ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Existing Labels Section */}
        {currentLabels.length > 0 && (
          <div className="mt-8 rounded-2xl border border-white/12 bg-white/[0.04]">
            <div className="flex items-center gap-2 p-4 border-b border-white/10">
              <Tag className="h-4 w-4 text-slate-400" />
              <span className="text-sm sm:text-base font-medium text-slate-200">Your existing labels</span>
            </div>
            <div className="divide-y divide-white/5">
              {currentLabels.map((name) => (
                <div key={`curr-${name}`} className="flex items-center gap-3 p-4">
                  <LabelPill name={name} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clira Suggested Labels Section (hidden when auto-sort is off) */}
        {autoSortingEnabled && (
          <div className="mt-6 rounded-2xl border border-white/12 bg-white/[0.06]">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-white/10">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Sparkles className="h-4 w-4 text-slate-200 flex-shrink-0" />
                <span className="text-sm sm:text-base font-medium text-slate-100 break-words">Clira-suggested labels</span>
              </div>
              {proposals.length > 0 && (
                <div className="flex items-center gap-3 text-xs flex-shrink-0">
                  <button 
                    onClick={handleSelectAll} 
                    className="text-slate-200 hover:text-white transition-colors duration-200 hover:underline whitespace-nowrap"
                  >
                    Select all
                  </button>
                  <span className="text-slate-600">·</span>
                  <button 
                    onClick={handleClearAll} 
                    className="text-slate-200 hover:text-white transition-colors duration-200 hover:underline whitespace-nowrap"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            <div className="divide-y divide-white/5">
              {proposals.length === 0 ? (
                <div className="p-6 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                      <Sparkles className="h-5 w-5 text-slate-200" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-300">No suggestions available yet</p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                        {onRetry && (
                          <>
                            <button className="underline hover:text-slate-300 transition-colors" onClick={onRetry}>
                              Try again
                            </button>
                            <span>or</span>
                          </>
                        )}
                        <button className="underline hover:text-slate-300 transition-colors" onClick={onSkip}>
                          skip for now
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                proposals.map((s, idx) => (
                  <label
                    key={s.id}
                    className={`group flex items-start gap-4 p-4 hover:bg-white/[0.04] cursor-pointer transition-all duration-200 ${
                      selected[s.id] ? 'bg-white/[0.04] ring-1 ring-white/15' : ''
                    } ${aiVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
                    style={{ transitionDelay: aiVisible ? `${Math.min(idx, 6) * 40}ms` : undefined }}
                  >
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={!!selected[s.id]}
                        onChange={() => handleToggle(s.id)}
                        className="mt-1 h-4 w-4 accent-emerald-500 rounded border-white/20 focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-0"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <LabelPill name={s.name} color={s.color} />
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0">
                          <Sparkles className="h-3 w-3 text-slate-300/60" />
                        </div>
                      </div>
                      {s.description && (
                        <p className="text-sm text-slate-300/80 leading-relaxed pl-1 break-words">
                          {s.description}
                        </p>
                      )}
                    </div>
                    {selected[s.id] && (
                      <div className="flex-shrink-0">
                        <ThickCheck className="h-4 w-4 text-emerald-400" />
                      </div>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        {/* Fixed bottom section with buttons */}
        <div className="mt-8 pt-6 border-t border-white/10 px-2 sm:px-0">
          <div className="text-sm text-slate-300 flex items-center gap-2 mb-4">
            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${selectedCount > 0 ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            <span className="break-words">{selectedCount > 0 ? `${selectedCount} label${selectedCount === 1 ? '' : 's'} selected` : 'Select labels to continue, or skip for now'}</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <LiquidButton
              onClick={onSkip}
              disabled={isSubmitting}
              minWidth="sm"
              variant="default"
              size="lg"
              className="rounded-2xl px-5 text-sm font-semibold text-sky-100 w-full sm:w-auto"
              type="button"
            >
              Skip
            </LiquidButton>
            <PrimaryButton
              onClick={handleSubmit}
              disabled={isSubmitting || selectedCount === 0}
              aria-label="Continue with selected labels"
              minWidth="sm"
              className="rounded-2xl w-full sm:w-auto"
            >
              {isSubmitting ? 'Setting up…' : (
                <>
                  Continue
                </>
              )}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>

    {/* Disable Auto-sort Warning Dialog */}
    <Dialog.Root open={disableWarningOpen} onOpenChange={(open) => (!open ? setDisableWarningOpen(false) : null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-[1000] flex items-center justify-center px-4 py-12">
          <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0B0C12] text-white shadow-2xl">
            <Dialog.Title className="px-6 pt-5 text-lg font-semibold">Turn off auto-sort?</Dialog.Title>
            <Dialog.Description className="px-6 pt-2 text-sm text-slate-300">
              Auto-sort routes new emails into your smart labels as they arrive. Turning this off means you will miss:
            </Dialog.Description>
            <ul className="px-8 mt-3 text-sm text-slate-300 list-disc space-y-1">
              <li>Automatic routing of newsletters, notifications, and promos</li>
              <li>Real-time sorting of new emails into smart folders</li>
              <li>Faster triage with action-oriented suggestions</li>
            </ul>
            <div className="px-6 py-5 flex flex-col sm:flex-row gap-3 sm:gap-4 sm:justify-end border-t border-white/10 mt-5">
              <button
                type="button"
                onClick={cancelDisableAutoSort}
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 transition"
              >
                Keep auto-sort on
              </button>
              <button
                type="button"
                onClick={confirmDisableAutoSort}
                className="inline-flex items-center justify-center rounded-xl bg-rose-600/90 hover:bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition"
              >
                Disable auto-sort
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  );
};
