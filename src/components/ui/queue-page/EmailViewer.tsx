import React, { useEffect, memo, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, ChevronDown, ArrowLeft, ArrowRight, Loader2, Check } from 'lucide-react';
import { EditCheck } from '@/components/icons/icons';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { QueueItem } from '@/types';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { formatEmailContentEnhanced, formatIncomingEmailContent } from '@/lib/queue/emailFormatting';
import { MailboxBadge } from '@/components/ui/mailbox/MailboxBadge';
import {
  MessageSquare as MessageSquareIcon,
  ArrowCircle as RotateIcon,
  email_envelope
} from '@/components/icons/icons';
import {
  MODAL_SURFACE_CLASS,
  SECTION_SURFACE_CLASS,
  TINTED_SECTION_SURFACE_CLASS,
  INFO_VALUE_SURFACE_CLASS,
  SUBJECT_VALUE_SURFACE_CLASS,
  TINTED_VALUE_SURFACE_CLASS,
  HEADER_BADGE_SURFACE_CLASS,
  DESKTOP_CONTENT_SURFACE_CLASS,
  TINTED_DESKTOP_CONTENT_SURFACE_CLASS
} from './queueModalStyles';
import { useModalScrollLock, useScrollIndicators } from './useQueueModal';
import { QueueViewerNavigation } from '@/lib/queue/navigation/types';

 

interface EmailViewerProps {
  item: QueueItem;
  onClose: () => void;
  onAction: (id: string, action: string, data?: { content: string; cc?: string }) => void;
  navigation?: QueueViewerNavigation;
  mode?: 'view' | 'edit';
  sendStatus?: 'sending' | 'sent';
}

// Keyboard navigation uses plain arrow keys inside the modal

const isEditableElement = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  if (target.isContentEditable) {
    return true;
  }
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

/**
 * Optimized EmailViewer component - extracted from QueuePage
 * Preserves exact UI design and functionality while improving performance
 */
export const EmailViewer = memo<EmailViewerProps>(({ 
  item,
  onClose,
  onAction,
  navigation,
  mode = 'view',
  sendStatus
}) => {
  // Mobile-only scroll tracking for the main scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>;
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const { scrollProgress, isScrollable, isNearTop, isNearBottom } = useScrollIndicators<HTMLDivElement>(scrollRef, [item, mode]);

  const [isEditing, setIsEditing] = useState(mode === 'edit');
  const [emailContent, setEmailContent] = useState(item.fullDraft || item.draftPreview || '');
  const [subject, setSubject] = useState(item.metadata?.subject ? `Re: ${item.metadata.subject}` : '');
  const [cc, setCc] = useState('');
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);

  // Lock all scrolling except within modal content
  useModalScrollLock('.overflow-y-auto, textarea');

  useEffect(() => {
    setEmailContent(item.fullDraft || item.draftPreview || '');
    setSubject(item.metadata?.subject ? `Re: ${item.metadata.subject}` : '');
    setCc('');
    // Reset local waiting state when switching to a different item
    // so we don't keep the sending overlay stuck
    // (actual sending state is driven by sendStatus prop)
    setIsWaiting(false);
  }, [item.fullDraft, item.draftPreview, item.metadata?.subject, item.id]);

  useEffect(() => {
    setIsEditing(mode === 'edit');
  }, [mode, item.id]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    const length = editor.value.length;
    editor.setSelectionRange(length, length);
  }, [isEditing]);

  // Memoized handlers
  const handleApprove = useCallback(() => {
    if (isWaiting) return;
    if (isEditing) {
      const trimmedContent = emailContent.trim();
      if (!trimmedContent) {
        return;
      }
      const trimmedCc = cc.trim();
      onAction(item.id, 'edit', {
        content: trimmedContent,
        cc: trimmedCc ? trimmedCc : undefined
      });
      setIsWaiting(true);
      return;
    }
    onAction(item.id, 'approve');
    setIsWaiting(true);
  }, [isWaiting, isEditing, emailContent, cc, onAction, item.id]);

  const handleReject = useCallback(() => {
    // Trigger reject flow (opens RejectDialog via parent handler)
    onAction(item.id, 'reject');

    // If navigation is available, advance to next item to preserve review flow
    if (navigation?.hasNext) {
      navigation.goToNext();
      return;
    }

    // Otherwise close the viewer when there is no next item
    onClose();
  }, [onAction, item.id, navigation, onClose]);

  const handleDismiss = useCallback(() => {
    // Trigger dismiss flow
    onAction(item.id, 'dismiss');

    // If navigation is available, advance to next item to preserve review flow
    if (navigation?.hasNext) {
      navigation.goToNext();
      return;
    }

    // Otherwise close the viewer when there is no next item
    onClose();
  }, [onAction, item.id, navigation, onClose]);

  // Keyboard shortcut handlers
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const eventTarget = event.target as Node | null;
      const viewerElement = viewerContainerRef.current;
      const isWithinViewer = !!(viewerElement && eventTarget && viewerElement.contains(eventTarget));
      const shouldHandleShortcuts = !eventTarget || eventTarget === document.body || eventTarget === document.documentElement || isWithinViewer;

      if (event.key === 'Escape') {
        if (!shouldHandleShortcuts) {
          return;
        }
        event.preventDefault();
        onClose();
        return;
      }

      const isMetaConfirm = (event.metaKey || event.ctrlKey) && event.key === 'Enter';
      if (isMetaConfirm) {
        if (!shouldHandleShortcuts) {
          return;
        }
        event.preventDefault();
        handleApprove();
        return;
      }

      // Reject reply with `r` key when not typing in an input/editor
      const targetIsEditable = isEditableElement(event.target);
      if (!targetIsEditable && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault();
        handleReject();
        return;
      }

      // Dismiss reply with `d` key when not typing in an input/editor
      if (!targetIsEditable && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        handleDismiss();
        return;
      }

      if (!navigation) {
        return;
      }

      if (targetIsEditable) {
        return;
      }

      const isNextKey = event.key === 'ArrowRight';
      if (isNextKey && navigation.hasNext) {
        event.preventDefault();
        navigation.goToNext();
        return;
      }

      const isPreviousKey = event.key === 'ArrowLeft';
      if (isPreviousKey && navigation.hasPrevious) {
        event.preventDefault();
        navigation.goToPrevious();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigation, onClose, handleApprove, handleReject, handleDismiss]);

  // Navigate only when we see a successful send for the current item while waiting
  useEffect(() => {
    if (!isWaiting) return;
    if (sendStatus === 'sent') {
      // Delay navigation to show "Sent" indicator for 1.2 seconds
      const timeoutId = setTimeout(() => {
        if (navigation?.hasNext) {
          navigation.goToNext();
        } else {
          onClose();
        }
        setIsWaiting(false);
      }, 1200);

      return () => clearTimeout(timeoutId);
    }
  }, [isWaiting, sendStatus, navigation, onClose]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
  }, [item.id, scrollRef]);

  const renderNavigationControls = (variant: 'desktop' | 'mobile') => {
    if (!navigation) {
      return null;
    }

    const { hasNext, hasPrevious, goToNext, goToPrevious, position } = navigation;
    const isMobile = variant === 'mobile';
    const containerClass =
      variant === 'desktop'
        ? 'hidden sm:flex items-center gap-2 mr-3'
        : 'sm:hidden flex flex-col items-center gap-2 mb-4';
    const buttonsWrapperClass =
      variant === 'desktop'
        ? 'flex items-center gap-2'
        : 'flex items-center justify-center gap-3';
    const buttonClass = isMobile
      ? `${LIQUID_BUTTON_BASE_CLASS} h-9 px-3 text-[13px] hover:scale-100 [&>div.z-10]:flex [&>div.z-10]:justify-center [&>div.z-10]:items-center`
      : `${LIQUID_BUTTON_BASE_CLASS} h-10 px-4 text-xs sm:text-sm hover:scale-100 [&>div.z-10]:flex [&>div.z-10]:justify-center [&>div.z-10]:items-center`;
    const responsive = isMobile;

    const labelContainerClass =
      variant === 'desktop'
        ? 'flex flex-col items-end gap-1 text-right'
        : 'flex flex-col items-center gap-1';
    const labelPrimaryClass =
      variant === 'desktop'
        ? 'text-xs font-semibold text-gray-200'
        : 'text-sm font-semibold text-gray-100';
    const labelSecondaryClass =
      variant === 'desktop'
        ? 'text-[11px] text-gray-500'
        : 'text-[11px] text-gray-400';

    const shortcutHint = (
      <div className="rounded-lg border border-sky-100/20 bg-black/40 px-2.5 py-1 text-[11px] text-sky-100/90">
        Shortcuts: ← / →
      </div>
    );

    return (
      <div className={containerClass}>
        <div className={buttonsWrapperClass}>
          <LiquidButton
            onClick={goToPrevious}
            disabled={!hasPrevious}
            size="sm"
            minWidth="none"
            responsive={responsive}
            hdrHover
            className={buttonClass}
            type="button"
            aria-label="View previous email"
          >
            <span className="inline-flex items-center justify-center gap-2 text-center">
              <ArrowLeft className="size-4 shrink-0" />
              <span className={responsive ? 'text-sm font-semibold' : 'hidden lg:inline'}>Previous</span>
            </span>
          </LiquidButton>

          {/* Desktop keeps hint inline; mobile shows it below */}
          {variant === 'desktop' && (
            <div className="hidden sm:flex items-center">{shortcutHint}</div>
          )}

          <LiquidButton
            onClick={goToNext}
            disabled={!hasNext}
            size="sm"
            minWidth="none"
            responsive={responsive}
            hdrHover
            className={buttonClass}
            type="button"
            aria-label="View next email"
          >
            <span className="inline-flex items-center justify-center gap-2 text-center">
              <span className={responsive ? 'text-sm font-semibold' : 'hidden lg:inline'}>Next</span>
              <ArrowRight className="size-4 shrink-0" />
            </span>
          </LiquidButton>
        </div>

        {variant === 'mobile' && (
          <div className="sm:hidden flex justify-center mt-1">{shortcutHint}</div>
        )}

        {position && position.total > 0 && (
          <div className={labelContainerClass}>
            <span className={labelPrimaryClass}>
              Email {position.index + 1} of {position.total}
            </span>
          </div>
        )}
      </div>
    );
  };


  const incomingEmailHtml = useMemo(() => {
    const raw = item.metadata?.body;
    if (!raw) {
      return 'Email content not available';
    }
    return formatIncomingEmailContent(raw);
  }, [item.metadata?.body]);

  const aiReplyHtml = useMemo(() => {
    const reply = emailContent || item.fullDraft || item.draftPreview;
    if (!reply) {
      return 'No draft available';
    }
    return formatEmailContentEnhanced(reply);
  }, [emailContent, item.fullDraft, item.draftPreview]);

  const modalContent = (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-0 sm:p-6 transition-all duration-200 ease-out overflow-hidden" // Change for more transparency!
      style={{ overscrollBehavior: 'none' }}
      onClick={onClose}
    >
      <div className="relative group w-full h-full sm:max-w-7xl sm:h-[95vh] transition-all duration-200 ease-out transform">
        {/* Enhanced glow for modal - desktop only */}
            <div className="hidden sm:block absolute -inset-12 bg-transparent rounded-3xl"></div>
            <div className="hidden sm:block absolute -inset-8 bg-transparent rounded-3xl"></div>
            <div className="hidden sm:block absolute -inset-6 bg-transparent rounded-3xl"></div>
        
        <div 
          ref={viewerContainerRef}
          className={`relative flex flex-col h-full ${MODAL_SURFACE_CLASS} p-4 sm:p-8 transition-all duration-200 ease-out transform`}
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
          
          {/* Header - Fixed height */}
          <div className="flex items-center justify-between mb-8 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-1 flex items-center">
                <MessageSquareIcon className="w-5 h-5 mr-3 text-gray-200 flex-shrink-0" />
                Email Review & AI Response
              </h3>
              <p className="text-sm text-gray-400 truncate">Review the incoming email and AI-generated reply</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MailboxBadge
                  mailboxEmail={item.metadata?.mailboxEmail}
                  mailboxDisplayName={item.metadata?.mailboxDisplayName}
                  mailboxProvider={item.metadata?.mailboxProvider}
                  size="sm"
                  className="border-white/12 bg-white/[0.08] text-slate-100 shadow-black/50"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {sendStatus && (
                <div
                  className={
                    sendStatus === 'sending'
                      ? 'inline-flex items-center gap-2 rounded-full border border-sky-400/50 bg-sky-900/60 px-3 py-1.5 text-xs sm:text-sm font-bold text-sky-100 shadow-lg shadow-sky-900/40 ring-1 ring-sky-400/20'
                      : 'inline-flex items-center gap-2 rounded-full border border-emerald-500/60 bg-emerald-900/60 px-3 py-1.5 text-xs sm:text-sm font-bold text-emerald-100 shadow-lg shadow-emerald-900/40 ring-1 ring-emerald-500/20'
                  }
                >
                  {sendStatus === 'sending' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Sent
                    </>
                  )}
                </div>
              )}
              {renderNavigationControls('desktop')}
              <LiquidButton
                onClick={onClose}
                size="sm"
                minWidth="none"
                hdrHover
                className={`${LIQUID_BUTTON_BASE_CLASS} group ml-2 flex-shrink-0 h-10 w-10 p-0 text-slate-200 transition-transform duration-200 hover:scale-100 [&>div.z-10]:flex [&>div.z-10]:justify-center [&>div.z-10]:items-center`}
                aria-label="Close email viewer"
                type="button"
              >
                <X className="size-4 text-gray-400 transition-colors group-hover:text-gray-200" />
              </LiquidButton>
            </div>
          </div>

          {renderNavigationControls('mobile')}

          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mb-8 flex-shrink-0"></div>
          
          {/* Scrollable content */}
          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto modal-scrollable-content flex flex-col relative"
            style={{ overscrollBehavior: 'contain' }}
          >
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

            {/* Subtle mobile scroll affordances: fades + chevron */}
            {isScrollable && (
              <>
                {/* Top fade appears when not at top */}
                <div
                  className={`pointer-events-none absolute inset-x-0 top-0 h-12 sm:hidden z-10 transition-opacity duration-200 ${
                    isNearTop ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  <div className="h-full bg-gradient-to-b from-black/40 to-transparent" />
                </div>
                {/* Bottom fade appears when not at bottom */}
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-0 h-20 sm:hidden z-10 transition-opacity duration-200 ${
                    isNearBottom ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  <div className="h-full bg-gradient-to-t from-black/50 to-transparent" />
                </div>
                {/* Bottom-center chevron hint only near top */}
                {isNearTop && (
                  <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 sm:hidden z-20">
                    <div className="relative rounded-full border border-white/15 bg-black/60 backdrop-blur-md px-3 py-1.5 shadow-lg shadow-black/30">
                      <span className="absolute inset-0 rounded-full bg-white/20 animate-ping" />
                      <ChevronDown className="relative w-5 h-5 text-gray-200/90 motion-safe:animate-bounce" />
                    </div>
                  </div>
                )}
              </>
            )}
            {/* Mobile-optimized layout: stack vertically on mobile, side-by-side on desktop */}
            <div className="flex flex-col lg:grid lg:grid-cols-2 gap-6 flex-1 min-h-0">
              {/* Original Email */}
              <div className="relative flex flex-col lg:min-h-0">
                <div className={`relative flex flex-col h-full ${SECTION_SURFACE_CLASS}`}>
                {/* Email Header */}
                <div className="p-4 border-b-0 sm:border-b sm:border-white/10 flex-shrink-0">
                  <div className="flex items-start justify-between mb-4">
                    <h4 className="text-base font-bold text-sky-300 flex items-center">
                      {email_envelope({ className: "w-4 h-4 mr-2 flex-shrink-0", color: "#7dd3fc" })}
                      Incoming Email
                    </h4>
                    <div className={HEADER_BADGE_SURFACE_CLASS}>
                      {item.metadata?.receivedAt ? new Date(item.metadata.receivedAt).toLocaleString() : 'Recently'}
                    </div>
                  </div>
                  
                  <div className="mb-3">
                    <div className="text-xs text-sky-200 mb-1 font-medium">From</div>
                    <div className={`${INFO_VALUE_SURFACE_CLASS} text-sm font-semibold text-white/95 break-all ring-1 ring-inset ring-sky-400/10` }>
                      {item.metadata?.from || 'Unknown sender'}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-sky-200 mb-1 font-medium">Subject</div>
                    <div className={`${SUBJECT_VALUE_SURFACE_CLASS} text-sm font-medium text-sky-100 break-words`}>
                      {item.metadata?.subject || 'No subject'}
                    </div>
                  </div>
                </div>
                
                {/* Email Content - Mobile: scrollable container, Desktop: full height with scroll */}
                <div className="flex-1 overflow-hidden flex flex-col p-0 sm:p-4">
                  {/* Mobile: Let outer container handle scroll to avoid nested scrolling */}
                  <div className="block sm:hidden">
                    <div
                      className="text-base text-gray-100 font-medium leading-relaxed break-words whitespace-pre-wrap antialiased px-4 pb-6"
                      dangerouslySetInnerHTML={{ __html: incomingEmailHtml }}
                    />
                  </div>
                  {/* Desktop: Full height with scroll */}
                  <div className={DESKTOP_CONTENT_SURFACE_CLASS}>
                    <div
                      className="text-sm sm:text-base text-gray-100 font-medium leading-relaxed break-words whitespace-pre-wrap antialiased"
                      dangerouslySetInnerHTML={{ __html: incomingEmailHtml }}
                    />
                  </div>
                </div>
                </div>
              </div>

              {/* AI Generated Response */}
              <div className="relative flex flex-col lg:min-h-0">
                <div className={`relative flex flex-col h-full ${TINTED_SECTION_SURFACE_CLASS}`}>
                  {/* AI Header */}
                  <div className="p-4 border-b-0 sm:border-b sm:border-emerald-400/20 flex-shrink-0">
                    <div className="mb-4">
                      <h4 className="text-base font-bold text-emerald-300 flex items-center">
                        <EditCheck className="w-4 h-4 mr-2 flex-shrink-0 text-emerald-300" />
                        AI Generated Reply
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-emerald-200 mb-1 font-medium">To</div>
                        <div className={`${TINTED_VALUE_SURFACE_CLASS} text-sm font-medium text-white break-all`}>
                          {item.metadata?.from || 'Unknown recipient'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-emerald-200 mb-1 font-medium">CC</div>
                        {isEditing ? (
                          <input
                            type="text"
                            value={cc}
                            onChange={(event) => setCc(event.target.value)}
                            placeholder="Add recipients to CC (comma-separated)"
                            disabled={isWaiting || sendStatus === 'sending'}
                            className="w-full px-3 py-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400/40 text-white placeholder-gray-400 text-sm font-medium transition-all duration-200 disabled:opacity-60"
                          />
                        ) : (
                          <div className={`${TINTED_VALUE_SURFACE_CLASS} text-sm font-medium text-emerald-100/80 break-all`}>
                            {cc.trim() ? cc : 'None'}
                          </div>
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <div className="text-xs text-emerald-200 mb-1 font-medium">Subject</div>
                        {isEditing ? (
                          <input
                            type="text"
                            value={subject}
                            onChange={(event) => setSubject(event.target.value)}
                            disabled={isWaiting || sendStatus === 'sending'}
                            className="w-full px-3 py-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400/40 text-white placeholder-gray-400 text-sm font-medium transition-all duration-200 disabled:opacity-60"
                          />
                        ) : (
                          <div className={`${TINTED_VALUE_SURFACE_CLASS} text-sm font-semibold text-white break-words`}>
                            {subject.trim() ? subject : 'No subject'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* AI Content - Mobile: scrollable container, Desktop: full height with scroll */}
                  <div className="flex-1 overflow-hidden flex flex-col p-0 sm:p-4">
                    {isEditing ? (
                      <div className="flex-1 flex flex-col">
                        <textarea
                          ref={editorRef}
                          value={emailContent}
                          onChange={(event) => setEmailContent(event.target.value)}
                          placeholder="Write your email reply here..."
                          disabled={isWaiting || sendStatus === 'sending'}
                          className="w-full h-full min-h-[16rem] p-3 rounded-lg border border-emerald-400/20 bg-emerald-500/5 focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400/40 resize-none text-sm sm:text-base font-medium text-gray-100 placeholder-gray-400 transition-all duration-200 disabled:opacity-60"
                        />
                        <div className="mt-3 flex items-center justify-end text-xs text-gray-300">
                          <span className="inline-flex items-center gap-1.5 text-emerald-100 bg-emerald-900/60 px-3 py-1.5 rounded-lg border border-emerald-500/50 font-semibold shadow-lg shadow-emerald-900/30">
                            ⌘↵ to send edited reply
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="block sm:hidden">
                          <div
                            className="text-base text-gray-100 font-medium leading-relaxed break-words antialiased px-4 pb-6"
                            dangerouslySetInnerHTML={{
                              __html: aiReplyHtml
                            }}
                          />
                        </div>
                        <div className={TINTED_DESKTOP_CONTENT_SURFACE_CLASS}>
                          <div
                            className="text-sm sm:text-base text-gray-100 font-medium leading-relaxed break-words antialiased"
                            dangerouslySetInnerHTML={{
                              __html: aiReplyHtml
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Action Buttons - Mobile-optimized layout */}
          <div className="mt-8 flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-4 sm:space-y-0 flex-shrink-0">
            <div className="text-sm text-gray-400 text-center sm:text-left">
              <div className="mb-2">Review both emails and choose your action</div>
              <div className="hidden sm:flex items-center justify-center rounded-lg border border-emerald-500/50 bg-emerald-900/60 px-3 py-1.5 text-xs text-emerald-100 sm:justify-start backdrop-blur-sm font-semibold shadow-lg shadow-emerald-900/30">
                <RotateIcon className="w-3 h-3 mr-1.5 text-emerald-200" />
                ⌘↵ to approve & send
              </div>
            </div>
            {/* Mobile: Stack buttons vertically, Desktop: Horizontal row */}
            <div className="flex flex-col space-y-3 sm:space-y-0 sm:flex-row sm:space-x-3 sm:justify-end w-full sm:w-auto">
              <div className="flex flex-col sm:hidden space-y-3">
                <PrimaryButton
                  onClick={handleApprove}
                  keyboardShortcut="⌘↵"
                  keyboardShortcutClassName="text-xs text-emerald-100 bg-emerald-900/60 px-2 py-1 rounded-lg font-semibold border border-emerald-500/50 shadow-lg shadow-emerald-900/30"
                  className="w-full"
                  disabled={isWaiting || sendStatus === 'sending'}
                >
                  {isWaiting || sendStatus === 'sending' ? 'Sending...' : 'Approve & Send'}
                </PrimaryButton>
                <PrimaryButton
                  onClick={handleReject}
                  keyboardShortcut="r"
                  keyboardShortcutClassName="text-xs text-red-100 bg-red-900/60 px-2 py-1 rounded-lg font-bold border border-red-500/50 shadow-lg shadow-red-900/30"
                  className="!bg-red-700 hover:!bg-red-600 active:!bg-red-800 !text-white !ring-1 !ring-red-400/30 w-full"
                >
                  <Trash2 size={16} />
                  Reject
                </PrimaryButton>
              <PrimaryButton
                onClick={handleDismiss}
                keyboardShortcut="d"
                keyboardShortcutClassName="text-xs text-blue-100 bg-blue-900/60 px-2 py-1 rounded-lg font-semibold border border-blue-500/50 shadow-lg shadow-blue-900/30"
                className="!bg-blue-700 hover:!bg-blue-600 active:!bg-blue-800 !text-white !ring-1 !ring-blue-400/30 w-full"
              >
                <X size={16} />
                Dismiss
              </PrimaryButton>
                <LiquidButton
                  onClick={onClose}
                  responsive
                  variant="default"
                  size="lg"
                  hdrHover
                  className={`${LIQUID_BUTTON_BASE_CLASS} w-full hover:scale-100 [&>div.z-10]:flex [&>div.z-10]:justify-center [&>div.z-10]:items-center`}
                  type="button"
                >
                  Close
                </LiquidButton>
              </div>
              {/* Desktop layout - unchanged */}
              <div className="hidden sm:flex sm:flex-row sm:space-x-3">
                <LiquidButton
                  onClick={onClose}
                  minWidth="md"
                  responsive
                  variant="default"
                  size="lg"
                  hdrHover
                  className={`${LIQUID_BUTTON_BASE_CLASS} hover:scale-100 [&>div.z-10]:flex [&>div.z-10]:justify-center [&>div.z-10]:items-center`}
                  type="button"
                >
                  Close
                </LiquidButton>
                <PrimaryButton
                  onClick={handleReject}
                  minWidth="lg"
                  keyboardShortcut="r"
                  keyboardShortcutClassName="text-xs text-red-100 bg-red-900/60 px-2 py-1 rounded-lg font-bold border border-red-500/50 shadow-lg shadow-red-900/30"
                  className="!bg-red-700 hover:!bg-red-600 active:!bg-red-800 !text-white !ring-1 !ring-red-400/30"
                >
                  <Trash2 size={16} />
                  Reject Reply
                </PrimaryButton>
                <PrimaryButton
                  onClick={handleDismiss}
                  minWidth="lg"
                  keyboardShortcut="d"
                  keyboardShortcutClassName="text-xs text-blue-100 bg-blue-900/60 px-2 py-1 rounded-lg font-semibold border border-blue-500/50 shadow-lg shadow-blue-900/30"
                  className="!bg-blue-700 hover:!bg-blue-600 active:!bg-blue-800 !text-white !ring-1 !ring-blue-400/30"
                >
                  <X size={16} />
                  Dismiss
                </PrimaryButton>
                <PrimaryButton
                  onClick={handleApprove}
                  keyboardShortcut="⌘↵"
                  keyboardShortcutClassName="text-xs text-emerald-100 bg-emerald-900/60 px-2 py-1 rounded-lg font-semibold border border-emerald-500/50 shadow-lg shadow-emerald-900/30"
                  minWidth="lg"
                  disabled={isWaiting || sendStatus === 'sending'}
                >
                  {isWaiting || sendStatus === 'sending' ? 'Sending...' : 'Approve & Send'}
                </PrimaryButton>
              </div>
            </div>
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

EmailViewer.displayName = 'EmailViewer';
