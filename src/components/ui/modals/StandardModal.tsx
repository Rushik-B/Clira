'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { MODAL_SURFACE_CLASS } from '@/components/ui/queue-page/queueModalStyles';
import { useModalScrollLock, useScrollIndicators } from '@/components/ui/queue-page/useQueueModal';

type Size = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const maxWidthBySize: Record<Size, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-7xl'
};

interface StandardModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  size?: Size;
  footer?: React.ReactNode;
  children: React.ReactNode;
  closeAriaLabel?: string;
}

/**
 * StandardModal
 * Unified modal shell inspired by EmailViewer.tsx with proper spacing and scroll behavior.
 */
export const StandardModal: React.FC<StandardModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  size = 'lg',
  footer,
  children,
  closeAriaLabel = 'Close dialog'
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const { scrollProgress, isScrollable, isNearTop, isNearBottom } = useScrollIndicators<HTMLDivElement>(scrollContainerRef, [isOpen]);

  useModalScrollLock('.modal-scrollable-content');

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const containerClasses = useMemo(() => {
    const width = maxWidthBySize[size] ?? maxWidthBySize.lg;
    return `relative group w-full ${width}`;
  }, [size]);

  if (!isOpen) return null;

  const content = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-0 sm:p-6 transition-all duration-200 ease-out overflow-hidden"
      style={{ overscrollBehavior: 'none' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="standard-modal-title"
    >
      <div className={containerClasses}>
        <div className="hidden sm:block absolute -inset-12 bg-transparent rounded-[40px]"></div>
        <div className="hidden sm:block absolute -inset-8 bg-transparent rounded-[40px]"></div>

        <div
          className={`relative ${MODAL_SURFACE_CLASS} p-4 sm:p-8 transition-all duration-200 ease-out transform`}
          onClick={(e) => e.stopPropagation()}
        >
          <GlowingEffect
            blur={0}
            borderWidth={2}
            spread={80}
            glow={true}
            disabled={false}
            proximity={150}
            inactiveZone={0.01}
            movementDuration={0.3}
          />

          {/* Header */}
          <div className="flex items-center justify-between mb-6 sm:mb-8">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              {icon && (
                <div className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/90 shrink-0">
                  {icon}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 id="standard-modal-title" className="text-xl sm:text-2xl font-bold text-white truncate">
                  {title}
                </h3>
                {subtitle && (
                  <p className="mt-1 text-sm text-gray-300/90">{subtitle}</p>
                )}
              </div>
            </div>
            <LiquidButton
              onClick={onClose}
              size="sm"
              minWidth="none"
              className={`${LIQUID_BUTTON_BASE_CLASS} group ml-2 flex-shrink-0 h-10 w-10 p-0 text-slate-200 transition-transform duration-200 hover:scale-105`}
              type="button"
              aria-label={closeAriaLabel}
            >
              <X className="size-4 text-gray-400 transition-colors group-hover:text-gray-200" />
            </LiquidButton>
          </div>

          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mb-6 sm:mb-8"></div>

          {/* Scrollable Content */}
          <div ref={scrollContainerRef} className="modal-scrollable-content flex-1 overflow-y-auto">
            {/* Mobile-only sticky scroll progress bar */}
            {isScrollable && (
              <div className="sticky top-0 z-20 sm:hidden">
                <div className="h-1 w-full bg-white/10 backdrop-blur-sm">
                  <div
                    aria-label="Scroll progress"
                    className="h-full rounded-full bg-gradient-to-r from-white/60 via-white/80 to-white/60 shadow-[0_0_10px_rgba(255,255,255,0.25)] transition-[width] duration-150 ease-out"
                    style={{ width: `${Math.round(scrollProgress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Subtle mobile scroll affordances */}
            {isScrollable && (
              <>
                <div className={`pointer-events-none absolute inset-x-0 top-0 h-12 sm:hidden z-10 transition-opacity duration-200 ${isNearTop ? 'opacity-0' : 'opacity-100'}`}>
                  <div className="h-full bg-gradient-to-b from-black/40 to-transparent" />
                </div>
                <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-20 sm:hidden z-10 transition-opacity duration-200 ${isNearBottom ? 'opacity-0' : 'opacity-100'}`}>
                  <div className="h-full bg-gradient-to-t from-black/50 to-transparent" />
                </div>
              </>
            )}

            <div className="px-1 sm:px-0">
              {children}
            </div>
          </div>

          {/* Footer */}
          {footer && (
            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:justify-end sm:items-center gap-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(content, document.body) : null;
};

export default StandardModal;



