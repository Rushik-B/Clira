import React, { memo, useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { 
  Trash2, 
  ArrowRight, 
  Loader2,
  X,
  Mail
} from 'lucide-react';
import { QueueItem } from '@/types';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { Button } from '@/components/ui/sidebar/button';
import { PrimaryButton } from '@/components/ui/buttons';
import { formatEmailContent } from '@/lib/queue/emailFormatting';
import { CircleCheck, Bookmark, email_envelope, Brain } from '@/components/icons/icons';
import { MailboxBadge } from '@/components/ui/mailbox/MailboxBadge';

// Optimized responsive design constants for maintainability
const MOBILE_CARD_STYLES = {
  container: 'mx-0 sm:mx-4 lg:mx-6 mb-6',
  glowEffects: 'hidden sm:block',
  cardWrapper: 'border-0 sm:border sm:border-gray-800/50 bg-transparent sm:bg-black/80 backdrop-blur-none sm:backdrop-blur-md shadow-none sm:shadow-2xl rounded-none sm:rounded-3xl',
  cardInner: 'bg-transparent sm:bg-black/70 border-0 sm:border-2 sm:border-gray-800/70 rounded-none sm:rounded-2xl backdrop-blur-none sm:backdrop-blur-sm shadow-none sm:shadow-inner border-b border-gray-700/40 sm:border-b-0 pb-8 sm:pb-6 relative'
} as const;

interface EmailQueueCardProps {
  item: QueueItem;
  onAction: (id: string, action: string, data?: { content: string; cc?: string }) => void;
  isProcessing: boolean;
  isSuccess: boolean;
  isSelected: boolean;
  sendStatus?: 'sending' | 'sent';
}

/**
 * Optimized EmailQueueCard component with React.memo and proper memoization
 * Preserves exact UI design while dramatically improving render performance
 */
export const EmailQueueCard = memo<EmailQueueCardProps>(({ 
  item,
  onAction,
  isProcessing,
  isSuccess,
  sendStatus
}) => {
  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setShowEmailPopup(false);
      }
    };

    if (showEmailPopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmailPopup]);
  // Helper function to get contrast color (white or black) based on background color
  const getContrastColor = (hexColor: string): string => {
    // Remove # if present
    const hex = hexColor.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return black for light colors, white for dark colors
    return luminance > 0.5 ? '#000000' : '#ffffff';
  };

  // Helper function to parse sender name and email from the from field
  const parseSenderInfo = (from: string) => {
    if (!from) return { name: 'Unknown Sender', email: '' };
    
    // Check if it's in format "Name <email@domain.com>"
    const nameEmailMatch = from.match(/^(.+?)\s*<(.+?)>$/);
    if (nameEmailMatch) {
      return {
        name: nameEmailMatch[1].trim(),
        email: nameEmailMatch[2].trim()
      };
    }
    
    // If it's just an email address
    const emailMatch = from.match(/^(.+@.+\..+)$/);
    if (emailMatch) {
      return {
        name: emailMatch[1].split('@')[0].replace(/[._]/g, ' '),
        email: emailMatch[1]
      };
    }
    
    // Fallback
    return {
      name: from,
      email: from
    };
  };

  // Helper to generate a compact plain-text snippet from HTML or plaintext
  const getTextSnippet = (textOrHtml: string, maxLength: number = 160): string => {
    if (!textOrHtml) return '';
    const withoutTags = textOrHtml.replace(/<[^>]*>/g, ' ');
    const normalized = withoutTags.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
  };

  // Memoize expensive computations
  const formattedDraftPreview = useMemo(
    () => item.draftPreview ? formatEmailContent(item.draftPreview) : '',
    [item.draftPreview]
  );

  const senderInfo = useMemo(
    () => parseSenderInfo(item.metadata?.from || ''),
    [item.metadata?.from]
  );

  const formattedDate = useMemo(
    () => item.metadata?.receivedAt 
      ? new Date(item.metadata.receivedAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      : 'Recently',
    [item.metadata?.receivedAt]
  );

  // Ensure label chips are unique to avoid duplicate React keys
  const uniqueLabels = useMemo(() => {
    const labels = item.metadata?.labels || [];
    const seen = new Set<string>();
    const deduped: typeof labels = [];
    for (const l of labels) {
      const k = l.id || l.gmailLabelId || `${l.name}|${l.color}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(l);
    }
    return deduped;
  }, [item.metadata?.labels]);

  // Incoming email snippet (compact)
  const incomingSnippet = useMemo(
    () => getTextSnippet(item.metadata?.body || ''),
    [item.metadata?.body]
  );


  // Determine the specific processing state
  const isGenerating = useMemo(() => 
    item.draftPreview === 'Generating reply…' && item.confidence === 0,
    [item.draftPreview, item.confidence]
  );
  
  const cardIsSending = useMemo(() => {
    if (sendStatus === 'sending') return true;
    return isProcessing && !isGenerating;
  }, [sendStatus, isProcessing, isGenerating]);

  const cardIsSuccess = useMemo(() => {
    if (sendStatus === 'sent') return true;
    return isSuccess;
  }, [sendStatus, isSuccess]);

  const cardClassName = useMemo(() => {
    if (isGenerating) {
      return 'border-amber-600/70 bg-gradient-to-br from-amber-900/15 via-orange-900/10 to-amber-800/5 shadow-xl shadow-amber-900/30 generating-glow generating-card-glow';
    }
    if (cardIsSending) {
      return 'border-blue-700 bg-blue-900/20 shadow-xl shadow-blue-900/50 processing-glow processing-card-glow';
    }
    if (cardIsSuccess) {
      return 'border-emerald-700 bg-emerald-900/20 shadow-xl shadow-emerald-900/50 success-state success-card-glow';
    }
    return 'md:hover:brightness-110 will-change-transform';
  }, [isGenerating, cardIsSending, cardIsSuccess]);

  // Memoized event handlers
  const handleCardClick = useCallback(() => {
    if (!isGenerating && !cardIsSending && !cardIsSuccess) {
      onAction(item.id, 'view');
    }
  }, [isGenerating, cardIsSending, cardIsSuccess, onAction, item.id]);

  const handleActionClick = useCallback((action: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onAction(item.id, action);
  }, [onAction, item.id]);

  const handleSenderClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowEmailPopup(!showEmailPopup);
  }, [showEmailPopup]);

  const handleEmailCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(senderInfo.email);
    setShowEmailPopup(false);
  }, [senderInfo.email]);


  return (
    <div className={`relative group transition-transform duration-300 will-change-transform isolate ${MOBILE_CARD_STYLES.container} ${
      isProcessing ? 'opacity-100 translate-x-0' : 'opacity-100 translate-x-0'
    }`} style={{ contain: 'paint' }}>
      {/* Ambient glow effects limited to active states to prevent background tint & tearing */}
      <div className={`${MOBILE_CARD_STYLES.glowEffects} absolute -inset-4 rounded-3xl blur-2xl transition-all duration-300 ${
        isGenerating
          ? 'bg-gradient-radial from-amber-500/20 via-orange-500/12 to-amber-400/6 opacity-100 generating-glow-outer animate-pulse'
          : cardIsSending
          ? 'bg-gradient-radial from-blue-500/25 via-blue-600/15 to-blue-400/8 opacity-100 processing-glow-outer'
          : cardIsSuccess
          ? 'bg-gradient-radial from-emerald-500/20 via-emerald-600/12 to-emerald-400/6 opacity-100 success-glow-outer'
          : 'hidden'
      }`}></div>
      <div className={`${MOBILE_CARD_STYLES.glowEffects} absolute -inset-2 rounded-3xl blur-xl transition-all duration-300 ${
        isGenerating
          ? 'bg-gradient-radial from-amber-400/15 via-orange-400/10 to-amber-300/4 opacity-100 generating-glow-inner animate-pulse'
          : cardIsSending
          ? 'bg-gradient-radial from-blue-400/20 via-blue-500/12 to-blue-300/6 opacity-100 processing-glow-inner'
          : cardIsSuccess
          ? 'bg-gradient-radial from-emerald-400/15 via-emerald-500/10 to-emerald-300/5 opacity-100 success-glow-inner'
          : 'hidden'
      }`}></div>
      
      {/* Processing and success glow overlays - Desktop only */}
      {isGenerating && (
        <div className={`${MOBILE_CARD_STYLES.glowEffects} absolute -inset-6 bg-gradient-radial from-amber-400/12 via-orange-400/8 to-transparent rounded-3xl blur-3xl animate-pulse generating-glow-pulse`}></div>
      )}
      {cardIsSending && (
        <div className={`${MOBILE_CARD_STYLES.glowEffects} absolute -inset-6 bg-gradient-radial from-blue-400/15 via-blue-500/8 to-transparent rounded-3xl blur-3xl animate-pulse processing-glow-pulse`}></div>
      )}
      {cardIsSuccess && (
        <div className={`${MOBILE_CARD_STYLES.glowEffects} absolute -inset-6 bg-gradient-radial from-emerald-400/12 via-emerald-500/6 to-transparent rounded-3xl blur-3xl success-celebration-glow`}></div>
      )}
      
      <div 
        className={`relative ${MOBILE_CARD_STYLES.cardWrapper} transition-border-color duration-300 sm:group-hover:border-gray-700/60 cursor-pointer transform email-queue-card ${cardClassName}`}
        onClick={handleCardClick}
      >
        <div className="hidden sm:block rounded-none sm:rounded-3xl">
          <GlowingEffect
            blur={0}
            borderWidth={2}
            spread={60}
            glow={true}
            disabled={false}
            proximity={120}
            inactiveZone={0.01}
            movementDuration={0.3}
          />
        </div>
        
        <div className={`relative ${MOBILE_CARD_STYLES.cardInner} transition-all duration-300 sm:group-hover:bg-black/80 sm:group-hover:border-gray-700/80 p-4 sm:p-6 ${
          isGenerating ? 'opacity-75' : cardIsSending ? 'opacity-70 sm:blur-[0.5px]' : ''
        }`}>
          {/* Subtle mobile separator - enhanced */}
          <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-gray-600/50 to-transparent sm:hidden"></div>
          
          {/* Header */}
          <div className="mb-4 sm:mb-5">
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between mb-3 space-y-3 xl:space-y-0">
              <div className="flex-1 xl:pr-6">
                <h3 className="text-xl sm:text-2xl font-bold text-white group-hover:text-blue-400 transition-colors duration-200 mb-2">
                  {item.actionSummary}
                </h3>
                <p className="text-sm sm:text-base text-gray-300 leading-relaxed font-medium max-h-12 overflow-hidden">
                  {item.contextSummary}
                </p>
              </div>
              
              {/* Time Information - Higher hierarchy */}
              <div className="flex flex-wrap items-center gap-2 text-gray-300 text-sm flex-shrink-0">
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  <span className="font-bold text-gray-200">Received: {formattedDate}</span>
                </div>
                <MailboxBadge
                  mailboxEmail={item.metadata?.mailboxEmail}
                  mailboxDisplayName={item.metadata?.mailboxDisplayName}
                  mailboxProvider={item.metadata?.mailboxProvider}
                  size="sm"
                  className="border-gray-700/60 bg-black/40 text-gray-100 shadow-black/50"
                />
              </div>
            </div>
            
            {/* Sender Information - Lower hierarchy */}
            <div className="flex items-center space-x-3 text-sm flex-shrink-0">
              {email_envelope({ className: "w-6 h-6 flex-shrink-0", color: "#60a5fa" })}
              <div className="relative" ref={popupRef}>
                <button
                  onClick={handleSenderClick}
                  className="text-blue-300 font-bold bg-gray-900/60 px-3 py-2 rounded-lg border-2 border-gray-700/60 sm:hover:bg-gray-800/70 sm:hover:border-gray-600/70 transition-all duration-200 cursor-pointer shadow-lg backdrop-blur-none sm:backdrop-blur-sm whitespace-nowrap inline-block"
                >
                  <div className="font-bold text-blue-100 text-sm whitespace-nowrap truncate max-w-[300px]">
                    {senderInfo.name}
                  </div>
                </button>
                
                {/* Email Popup */}
                {showEmailPopup && (
                  <div className="absolute top-full left-0 mt-3 z-50 bg-black/95 backdrop-blur-none sm:backdrop-blur-md border-2 border-gray-700/70 rounded-xl shadow-2xl p-4 animate-in slide-in-from-top-2 duration-200 min-w-[350px] max-w-[500px]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Email Address</span>
                      <button
                        onClick={() => setShowEmailPopup(false)}
                        className="text-gray-400 sm:hover:text-white transition-colors p-1 rounded-lg sm:hover:bg-gray-700/40"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="text-sm text-blue-300 font-medium whitespace-nowrap overflow-hidden text-ellipsis flex-1 bg-gray-800/50 px-3 py-2 rounded-lg border border-gray-700/50">
                        {senderInfo.email}
                      </div>
                      <button
                        onClick={handleEmailCopy}
                        className="text-blue-400 sm:hover:text-blue-300 transition-colors p-2 rounded-lg sm:hover:bg-blue-900/30 flex-shrink-0 border border-blue-700/30"
                        title="Copy email"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Incoming email content (compact) */}
          {incomingSnippet && (
            <div className="mb-4 p-3 sm:p-3 bg-gray-900/50 border-2 border-gray-700/50 rounded-xl shadow-lg transition-colors duration-200 sm:group-hover:border-blue-700/50">
              <div className="flex items-start space-x-2">
                <Mail className="w-4 h-4 text-blue-300 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm text-gray-300">{incomingSnippet}</div>
                </div>
              </div>
            </div>
          )}


          
          
          {/* Labels */}
          {uniqueLabels.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-2.5">
              {uniqueLabels.map((label, index) => (
                <span 
                  key={`${label.id || label.gmailLabelId || `${label.name}-${label.color}`}-${index}`}
                  className="relative inline-flex items-center px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl cursor-default group animate-in fade-in-50 slide-in-from-left-2 duration-500 overflow-hidden max-w-full"
                  style={{
                    backgroundColor: label.color,
                    color: getContrastColor(label.color),
                    border: `1px solid ${label.color}80`,
                    boxShadow: `0 4px 12px ${label.color}40`,
                    animationDelay: `${index * 100}ms`
                  }}
                >
                  {/* Subtle gradient overlay */}
                  <div 
                    className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300"
                    style={{ backgroundColor: 'transparent' }}
                  />
                  <span className="relative z-10 group-hover:drop-shadow-sm transition-all duration-300 whitespace-nowrap truncate max-w-[120px] sm:max-w-[150px]">
                    {label.name}
                  </span>
                </span>
              ))}
            </div>
          )}
          
          {/* Actions */}
          <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:justify-between sm:items-center">
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs sm:text-sm font-bold transition-all duration-300 ${
                isGenerating
                  ? 'text-amber-100 bg-amber-900/40 border border-amber-700/50 shadow-lg shadow-amber-900/40 ring-1 ring-amber-400/20'
                  : cardIsSending
                  ? 'text-blue-100 bg-blue-900/40 border border-blue-700/50 shadow-lg shadow-blue-900/40 ring-1 ring-blue-400/20'
                  : cardIsSuccess
                  ? 'text-emerald-100 bg-emerald-900/40 border border-emerald-700/50 shadow-lg shadow-emerald-900/40 ring-1 ring-emerald-400/20'
                  : 'text-blue-100 bg-blue-900/40 border border-blue-700/50 shadow-lg shadow-blue-900/40 ring-1 ring-blue-400/20'
              }`}
            >
              {isGenerating ? (
                <>
                  <Brain className="w-4 h-4 text-amber-200" />
                  <span>Crafting your reply…</span>
                </>
              ) : cardIsSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending email…</span>
                </>
              ) : cardIsSuccess ? (
                <>
                  <CircleCheck className="w-4 h-4" />
                  <span>Email sent successfully!</span>
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  <span>Ready to review</span>
                </>
              )}
            </div>
            
            {/* Mobile-optimized compact button layout */}
            <div className="action-buttons" onClick={(e) => e.stopPropagation()}>
              {isGenerating || cardIsSending || cardIsSuccess ? (
                <Button
                  disabled
                  variant="secondary"
                  size="lg"
                  className={`min-w-[120px] rounded-2xl h-9 font-bold transition-all duration-300 ${
                    isGenerating 
                      ? 'text-amber-300 bg-amber-900/30 border-amber-700/40 hover:bg-amber-900/30' 
                      : cardIsSending 
                      ? 'text-blue-300 bg-blue-900/30 border-blue-700/40 hover:bg-blue-900/30'
                      : 'text-muted-foreground'
                  }`}
                  aria-label={
                    isGenerating ? 'Generating reply' : 
                    cardIsSending ? 'Sending email' : 
                    'Email sent'
                  }
                >
                  {isGenerating ? (
                    <Brain className="w-4 h-4 animate-pulse text-amber-300" />
                  ) : cardIsSending ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <CircleCheck className="w-4 h-4" />
                  )}
                  <span>
                    {isGenerating ? 'Thinking…' : 
                     cardIsSending ? 'Sending…' : 
                     'Sent!'}
                  </span>
                </Button>
              ) : (
                <div className="flex flex-col space-y-8 lg:flex-row lg:space-y-0 lg:space-x-3">
                  {/* Primary action - full width on mobile with extra bottom spacing */}
                  <PrimaryButton
                    onClick={handleActionClick('approve')}
                    disabled={isGenerating}
                    aria-label="Approve and send"
                    keyboardShortcut="⌘↵"
                    keyboardShortcutClassName="text-xs text-emerald-100 bg-emerald-900/60 px-2 py-1 rounded-lg font-semibold border border-emerald-500/50 shadow-lg shadow-emerald-900/30"
                    minWidth="md"
                    className="lg:min-w-[120px] mb-5 lg:mb-0"
                  >
                    Approve & Send
                  </PrimaryButton>
                  
                  {/* Secondary actions - centered and aligned on mobile */}
                  <div className="flex justify-center items-center space-x-1.5">
                    <PrimaryButton
                      onClick={handleActionClick('reject')}
                      disabled={isGenerating || cardIsSending || cardIsSuccess}
                      aria-label="Reject reply"
                      minWidth="sm"
                      className="!bg-red-700 hover:!bg-red-600 active:!bg-red-800 !text-white !ring-1 !ring-red-400/30 flex items-center justify-center
                                flex-1 lg:flex-initial lg:min-w-[80px]
                                text-xs lg:text-sm
                                py-1.5 lg:py-2
                                h-10"
                    >
                      <Trash2 size={12} className="lg:w-[14px] lg:h-[14px]" />
                      <span>Reject</span>
                    </PrimaryButton>
                    <PrimaryButton
                      onClick={handleActionClick('dismiss')}
                      disabled={isGenerating || cardIsSending || cardIsSuccess}
                      aria-label="Dismiss from queue"
                      minWidth="sm"
                      className="!bg-[hsl(var(--sidebar-primary))] !text-[hsl(var(--sidebar-primary-foreground))] hover:!bg-[hsl(var(--sidebar-primary))] hover:brightness-110 active:brightness-95 focus-visible:ring-[hsl(var(--sidebar-primary)/0.35)] flex flex-1 items-center justify-center
                        lg:flex-initial lg:min-w-[80px]
                        text-xs lg:text-sm
                        py-1.5 lg:py-2
                        opacity-80 hover:opacity-100
                        hover:shadow-lg hover:ring-2 hover:ring-blue-400/30
                        transition duration-200 ease-out
                        h-10"
                    >
                      <X size={12} className="lg:w-[12px] lg:h-[12px]" />
                      <span>Dismiss</span>
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for optimal re-rendering
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.actionSummary === nextProps.item.actionSummary &&
    prevProps.item.contextSummary === nextProps.item.contextSummary &&
    prevProps.item.draftPreview === nextProps.item.draftPreview &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.isProcessing === nextProps.isProcessing &&
    prevProps.isSuccess === nextProps.isSuccess &&
    prevProps.item.metadata?.from === nextProps.item.metadata?.from &&
    prevProps.item.metadata?.receivedAt === nextProps.item.metadata?.receivedAt &&
    prevProps.item.metadata?.mailboxEmail === nextProps.item.metadata?.mailboxEmail &&
    prevProps.item.metadata?.mailboxDisplayName === nextProps.item.metadata?.mailboxDisplayName &&
    prevProps.item.metadata?.mailboxProvider === nextProps.item.metadata?.mailboxProvider &&
    prevProps.item.metadata?.labels === nextProps.item.metadata?.labels
  );
});

EmailQueueCard.displayName = 'EmailQueueCard';
