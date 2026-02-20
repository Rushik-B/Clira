'use client';

import React from 'react';
import Image from 'next/image';
import { LiquidButton } from '@/components/ui/buttons';
import { cn } from '@/lib/utils';

interface AIFloatingButtonProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const AIFloatingButton: React.FC<AIFloatingButtonProps> = ({ isOpen, onToggle }) => {
  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[70] transition-all duration-300',
        isOpen ? 'pointer-events-none opacity-0 scale-95' : 'opacity-100 scale-100',
      )}
    >
      <div className="relative group">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400/20 via-transparent to-sky-400/20 blur-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
        <LiquidButton
          onClick={onToggle}
          size="icon"
          minWidth="none"
          hdrHover
          hdrGlow={{
            srgb: {
              primary: "rgba(16, 185, 129, 0.82)",
              secondary: "rgba(56, 189, 248, 0.72)",
            },
            p3: {
              primary: "color(display-p3 0.0 1.0 0.60 / 0.88)",
              secondary: "color(display-p3 0.0 0.78 1.0 / 0.82)",
            },
          }}
          className="h-16 w-16 !rounded-full border border-white/10 bg-slate-950/70 text-emerald-100 backdrop-blur-xl transition-all duration-300 hover:text-emerald-50 hover:border-emerald-300/40 cursor-pointer"
          aria-label="Toggle AI assistant"
          type="button"
        >
          <Image
            src="/logo.png"
            alt="Clira Logo"
            width={48}
            height={48}
            className="object-contain scale-110"
          />
        </LiquidButton>
        <div className="pointer-events-none absolute bottom-full right-0 mb-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-sm font-bold text-white whitespace-nowrap opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
          Clira Exec
        </div>
      </div>
    </div>
  );
};
