import React from 'react';
import { Gmail, Outlook } from '@/components/icons/icons';
import { cn } from '@/lib/utils';

const PROVIDER_CONFIG = {
  google: {
    label: 'Gmail',
    icon: Gmail,
    iconColor: '#fca5a5',
    surface: 'from-rose-500/20 via-amber-500/10 to-transparent',
    border: 'border-rose-300/40',
    text: 'text-rose-100',
    glow: 'shadow-rose-900/30',
  },
  microsoft: {
    label: 'Outlook',
    icon: Outlook,
    iconColor: '#7dd3fc',
    surface: 'from-sky-500/20 via-blue-500/10 to-transparent',
    border: 'border-sky-300/40',
    text: 'text-sky-100',
    glow: 'shadow-sky-900/30',
  },
  outlook: {
    label: 'Outlook',
    icon: Outlook,
    iconColor: '#7dd3fc',
    surface: 'from-sky-500/20 via-blue-500/10 to-transparent',
    border: 'border-sky-300/40',
    text: 'text-sky-100',
    glow: 'shadow-sky-900/30',
  },
} as const;

type MailboxBadgeSize = 'sm' | 'md';

interface MailboxBadgeProps {
  mailboxEmail?: string | null;
  mailboxDisplayName?: string | null;
  mailboxProvider?: string | null;
  size?: MailboxBadgeSize;
  className?: string;
}

export const MailboxBadge: React.FC<MailboxBadgeProps> = ({
  mailboxEmail,
  mailboxDisplayName,
  mailboxProvider,
  size = 'sm',
  className,
}) => {
  const normalizedProvider = mailboxProvider?.toLowerCase() ?? '';
  const providerConfig =
    PROVIDER_CONFIG[normalizedProvider as keyof typeof PROVIDER_CONFIG];

  const labelSource = mailboxDisplayName?.trim() || mailboxEmail?.trim();
  const providerLabel = providerConfig?.label || 'Inbox';
  const displayLabel = labelSource || `${providerLabel} inbox`;
  const secondaryLabel =
    mailboxDisplayName && mailboxEmail && mailboxDisplayName !== mailboxEmail
      ? mailboxEmail
      : null;

  const Icon = providerConfig?.icon;
  const iconColor = providerConfig?.iconColor ?? '#e2e8f0';
  const surface = providerConfig?.surface ?? 'from-white/10 via-white/5 to-transparent';
  const border = providerConfig?.border ?? 'border-white/10';
  const text = providerConfig?.text ?? 'text-slate-100';
  const glow = providerConfig?.glow ?? 'shadow-black/40';

  const sizeClasses =
    size === 'md'
      ? 'px-3 py-2 text-xs'
      : 'px-2.5 py-1 text-[11px]';
  const iconWrapperClasses =
    size === 'md'
      ? 'h-7 w-7'
      : 'h-6 w-6';
  const iconClasses = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';

  return (
    <div
      className={cn(
        'relative inline-flex items-center gap-2 rounded-full border bg-gradient-to-br backdrop-blur-sm shadow-lg',
        sizeClasses,
        border,
        text,
        glow,
        className
      )}
      title={[providerLabel, mailboxEmail].filter(Boolean).join(' • ')}
    >
      <span
        className={cn(
          'relative z-10 flex items-center justify-center rounded-full border bg-black/30',
          iconWrapperClasses,
          border
        )}
        style={{ '--icon-color': iconColor } as React.CSSProperties}
      >
        {Icon ? (
          <Icon
            className={iconClasses}
          />
        ) : (
          <span className="text-[10px] font-bold">EA</span>
        )}
      </span>
      <span className="relative z-10 min-w-0">
        <span className="block truncate leading-tight font-semibold">
          {displayLabel}
        </span>
        {size === 'md' && secondaryLabel && (
          <span className="block truncate text-[10px] text-white/60">
            {secondaryLabel}
          </span>
        )}
      </span>
      <span
        className={cn(
          'pointer-events-none absolute inset-0 z-0 rounded-full opacity-60',
          `bg-gradient-to-br ${surface}`
        )}
      />
    </div>
  );
};
