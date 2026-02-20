'use client';

import React from 'react';
import { cn } from '@/lib/utils';

type MailboxStatus = 'CONNECTED' | 'NEEDS_RECONNECT' | 'ERROR' | 'DISABLED';

const STATUS_CONFIG: Record<
  MailboxStatus,
  {
    label: string;
    dotClass: string;
    textClass: string;
    bgClass: string;
    pulseClass?: string;
  }
> = {
  CONNECTED: {
    label: 'Connected',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-300',
    bgClass: 'bg-emerald-900/30',
    pulseClass: 'animate-pulse',
  },
  NEEDS_RECONNECT: {
    label: 'Needs reconnect',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-300',
    bgClass: 'bg-amber-900/30',
  },
  ERROR: {
    label: 'Error',
    dotClass: 'bg-red-400',
    textClass: 'text-red-300',
    bgClass: 'bg-red-900/30',
  },
  DISABLED: {
    label: 'Disabled',
    dotClass: 'bg-gray-500',
    textClass: 'text-gray-400',
    bgClass: 'bg-gray-900/30',
  },
};

interface MailboxStatusPillProps {
  status: MailboxStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export const MailboxStatusPill: React.FC<MailboxStatusPillProps> = ({
  status,
  size = 'sm',
  className,
}) => {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.DISABLED;

  const sizeClasses = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]';
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        sizeClasses,
        config.textClass,
        config.bgClass,
        className
      )}
    >
      <span
        className={cn(
          'rounded-full shrink-0',
          dotSize,
          config.dotClass,
          config.pulseClass
        )}
      />
      {config.label}
    </span>
  );
};

export type { MailboxStatus };
