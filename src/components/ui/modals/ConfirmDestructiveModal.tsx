'use client';

import React from 'react';
import { Trash2, X } from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { cn } from '@/lib/utils';

const TONE_MAP = {
  red: {
    outerGlow: 'from-red-500/10 via-red-400/15 to-red-500/10',
    innerGlow: 'from-red-400/12 via-red-500/18 to-red-400/12',
    iconBg: 'bg-red-500/20',
    iconColor: 'text-red-400',
    accentText: 'text-red-200',
    confirmBg: 'bg-red-600/20 hover:bg-red-600/30 border-red-600/50 text-red-200',
  },
  amber: {
    outerGlow: 'from-amber-500/10 via-amber-400/15 to-amber-500/10',
    innerGlow: 'from-amber-400/12 via-amber-500/18 to-amber-400/12',
    iconBg: 'bg-amber-500/20',
    iconColor: 'text-amber-300',
    accentText: 'text-amber-200',
    confirmBg: 'bg-amber-600/20 hover:bg-amber-600/30 border-amber-500/50 text-amber-100',
  },
  purple: {
    outerGlow: 'from-purple-500/10 via-purple-400/15 to-purple-500/10',
    innerGlow: 'from-purple-400/12 via-purple-500/18 to-purple-400/12',
    iconBg: 'bg-purple-500/20',
    iconColor: 'text-purple-300',
    accentText: 'text-purple-200',
    confirmBg: 'bg-purple-600/20 hover:bg-purple-600/30 border-purple-500/50 text-purple-100',
  },
} as const;

export interface ConfirmDestructiveModalProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  icon?: React.ReactNode;
  tone?: keyof typeof TONE_MAP;
  error?: string | null;
}

export const ConfirmDestructiveModal: React.FC<ConfirmDestructiveModalProps> = ({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  loading = false,
  icon,
  tone = 'red',
  error,
}) => {
  if (!open) {
    return null;
  }

  const toneStyles = TONE_MAP[tone] ?? TONE_MAP.red;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md">
        <div
          className={cn(
            'absolute -inset-6 rounded-3xl blur-3xl bg-gradient-to-r opacity-90',
            toneStyles.outerGlow,
          )}
        />
        <div
          className={cn(
            'absolute -inset-0.5 rounded-3xl blur-2xl bg-gradient-to-r opacity-80',
            toneStyles.innerGlow,
          )}
        />

        <div className="relative rounded-2xl border border-gray-800/40 bg-gray-900/95 shadow-2xl">
          <GlowingEffect
            blur={0}
            borderWidth={2}
            spread={60}
            glow
            disabled={false}
            proximity={80}
            inactiveZone={0.02}
            movementDuration={1.4}
          />

          <div className="flex items-center justify-between border-b border-gray-800/50 p-5">
            <div className="flex items-center gap-3">
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', toneStyles.iconBg)}>
                {icon ?? <Trash2 className={cn('h-5 w-5', toneStyles.iconColor)} />}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">{title}</h3>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-50"
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          <div className="space-y-3 px-5 py-6 text-sm text-gray-300">
            {typeof description === 'string' ? <p>{description}</p> : description}
            {error && (
              <div className="rounded-lg border border-red-700/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-800/50 bg-gray-900/60 px-5 py-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-lg border border-gray-700/60 bg-gray-800/70 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={cn(
                'inline-flex items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                toneStyles.confirmBg,
              )}
            >
              {loading ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                  {confirmLabel}
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

