import React, { useState, useCallback, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X, Loader2 } from 'lucide-react';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { MODAL_SURFACE_CLASS, SECTION_SURFACE_CLASS } from './queueModalStyles';

interface RejectDialogProps {
  itemId: string;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
  onFeedbackChange: (feedback: string) => void;
  initialFeedback?: string;
}

/**
 * Optimized RejectDialog component - extracted from QueuePage
 * Preserves exact UI design while improving performance with memoization
 */
export const RejectDialog = memo<RejectDialogProps>(({ 
  itemId, 
  onClose, 
  onSubmit, 
  onFeedbackChange,
  initialFeedback = '' 
}) => {
  const [feedback, setFeedback] = useState(initialFeedback);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFeedback(initialFeedback);
  }, [itemId, initialFeedback]);

  const handleFeedbackChange = useCallback((value: string) => {
    setFeedback(value);
    onFeedbackChange(value);
  }, [onFeedbackChange]);

  const handleSubmit = useCallback(async () => {
    if (!feedback.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      const trimmedFeedback = feedback.trim();
      onFeedbackChange(trimmedFeedback);
      await onSubmit(trimmedFeedback);
    } finally {
      setIsSubmitting(false);
    }
  }, [feedback, onSubmit, onFeedbackChange, isSubmitting]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleSubmit, onClose]);

  // Lock all scrolling except within modal content
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    
    // Prevent all scroll events globally, but allow within modal content with overscroll protection
    const preventScroll = (e: WheelEvent | TouchEvent) => {
      // Check if the event is happening inside the scrollable modal content
      const target = e.target as Element;
      const scrollableContent = target.closest('.modal-scrollable-content') as HTMLElement;
      
      // If not in scrollable content, prevent the scroll
      if (!scrollableContent) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // If in scrollable content, check for overscroll and prevent it
      if (e instanceof WheelEvent) {
        const { scrollTop, scrollHeight, clientHeight } = scrollableContent;
        const isScrollingUp = e.deltaY < 0;
        const isScrollingDown = e.deltaY > 0;
        
        // Prevent overscroll at the top
        if (isScrollingUp && scrollTop === 0) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        
        // Prevent overscroll at the bottom
        if (isScrollingDown && scrollTop + clientHeight >= scrollHeight) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };
    
    // Add global scroll prevention with passive: false to allow preventDefault
    document.addEventListener('wheel', preventScroll, { passive: false });
    document.addEventListener('touchmove', preventScroll, { passive: false });
    
    return () => {
      document.body.style.overflow = originalStyle;
      document.removeEventListener('wheel', preventScroll);
      document.removeEventListener('touchmove', preventScroll);
    };
  }, []);

  useEffect(() => {
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [onClose]);

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-0 sm:p-6 transition-all duration-200 ease-out overflow-hidden"
      style={{ overscrollBehavior: 'none' }}
      onClick={onClose}
    >
      <div className="relative group w-full max-w-2xl transition-all duration-200 ease-out transform">
        <div className="hidden sm:block absolute -inset-12 bg-transparent rounded-[40px]"></div>
        <div className="hidden sm:block absolute -inset-8 bg-transparent rounded-[40px]"></div>

        <div
          className={`relative ${MODAL_SURFACE_CLASS} p-6 sm:p-8 transition-all duration-200 ease-out will-change-transform`}
          onClick={(e) => e.stopPropagation()}
        >
          <GlowingEffect
            blur={0}
            borderWidth={2}
            spread={70}
            glow={true}
            disabled={false}
            proximity={130}
            inactiveZone={0.01}
            movementDuration={0.3}
          />
          
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-2xl font-bold text-white mb-2 flex items-center">
                <Trash2 size={20} className="mr-3 text-red-300" />
                Reject Response
              </h3>
              <p className="text-gray-300/80">Help improve our AI by providing feedback on why this response should be rejected.</p>
            </div>
            <LiquidButton
              onClick={onClose}
              size="sm"
              minWidth="none"
              className={`${LIQUID_BUTTON_BASE_CLASS} group ml-2 flex-shrink-0 h-10 w-10 p-0 text-slate-200 transition-transform duration-200 hover:scale-105`}
              type="button"
              aria-label="Close reject dialog"
            >
              <X className="size-4 text-gray-400 transition-colors group-hover:text-gray-200" />
            </LiquidButton>
          </div>
          
          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mb-8"></div>
          
          <div className="mb-8">
            <label htmlFor="feedback-textarea" className="block text-sm font-medium text-gray-300 mb-3">
              Feedback Details
            </label>
            <textarea
              id="feedback-textarea"
              value={feedback}
              onChange={(e) => handleFeedbackChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Too formal, missing context, inappropriate tone, doesn't match my style..."
              className={`${SECTION_SURFACE_CLASS} w-full h-32 p-4 text-sm text-white placeholder-gray-400/80 focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400/40 resize-none transition-all duration-200`}
              autoFocus
              maxLength={1000}
            />
            <div className="mt-3 flex justify-between text-xs text-gray-500">
              <span className="hidden sm:flex items-center text-blue-200 bg-white/[0.08] px-2 py-1 rounded border border-white/10 backdrop-blur-sm">Press <span className="mx-1 bg-white/10 px-1 py-0.5 rounded font-medium border border-white/15">⌘↵</span> to submit</span>
              <span className="sm:hidden">Tap to submit</span>
              <span className="text-gray-400">{feedback.length}/1000</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-4">
            <LiquidButton
              onClick={onClose}
              type="button"
              minWidth="md"
              responsive
              variant="default"
              size="lg"
              className={LIQUID_BUTTON_BASE_CLASS}
            >
              Cancel
            </LiquidButton>
            <PrimaryButton
              onClick={handleSubmit}
              disabled={!feedback.trim() || isSubmitting}
              type="button"
              minWidth="lg"
              keyboardShortcut="⌘↵"
              keyboardShortcutClassName="text-xs text-red-100 bg-red-900/60 px-2 py-1 rounded-lg font-semibold border border-red-500/50 shadow-lg shadow-red-900/30"
              className="!bg-red-700 hover:!bg-red-600 active:!bg-red-800 !text-white !ring-1 !ring-red-400/30"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Reject Response
                </>
              )}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );

  // Render modal using portal to document.body for proper positioning
  return typeof window !== 'undefined' 
    ? createPortal(modalContent, document.body)
    : null;
});

RejectDialog.displayName = 'RejectDialog';
