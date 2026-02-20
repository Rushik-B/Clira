'use client';

import React from 'react';
import { Expand, X, Trash } from '@/components/icons/icons';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface AIChatHeaderProps {
  isFullscreen: boolean;
  isClearing: boolean;
  hasMessages: boolean;
  onClose: () => void;
  onClear: () => void;
  onToggleFullscreen: () => void;
}

export const AIChatHeader: React.FC<AIChatHeaderProps> = ({
  isFullscreen,
  isClearing,
  hasMessages,
  onClose,
  onClear,
  onToggleFullscreen,
}) => {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-white/5 px-5 pb-4',
        isFullscreen ? 'pt-[calc(1rem+env(safe-area-inset-top))]' : 'pt-4',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center">
          <Image
            src="/logo.png"
            alt="Clira Logo"
            width={48}
            height={48}
            className="h-full w-full object-contain scale-125"
          />
        </div>
        <div>
          <p className="text-xl font-bold text-white">Clira Exec</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          disabled={!hasMessages || isClearing}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-slate-200 transition-all duration-200 hover:border-emerald-400/30 hover:text-emerald-100 cursor-pointer',
            (!hasMessages || isClearing) && 'cursor-not-allowed opacity-50 hover:border-white/10 hover:text-slate-200',
          )}
          aria-label="Clear conversation"
          title={isClearing ? 'Clearing...' : 'Clear conversation'}
        >
          <Trash className="h-4 w-4 fill-current" />
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-slate-200 transition-all duration-200 hover:border-slate-400/40 hover:text-slate-50 cursor-pointer"
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        >
          <Expand className="h-4 w-4 text-slate-200" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-slate-200 transition-all duration-200 hover:border-rose-400/40 hover:text-rose-100 cursor-pointer"
          aria-label="Close chat"
          title="Close chat"
        >
          <X className="h-3 w-3 text-slate-200" />
        </button>
      </div>
    </div>
  );
};
