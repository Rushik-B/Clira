'use client';

import React from 'react';
import {
  MoreVertical,
  Star,
  RefreshCw,
  Trash2,
  Loader2,
  Crown,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/sidebar/dropdown-menu';
import { Gmail, Outlook } from '@/components/icons/icons';
import { MailboxStatusPill, type MailboxStatus } from './MailboxStatusPill';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { cn } from '@/lib/utils';

const PROVIDER_CONFIG = {
  google: {
    label: 'Gmail',
    icon: Gmail,
    iconColor: '#fca5a5',
    accent: 'rose',
  },
  microsoft: {
    label: 'Outlook',
    icon: Outlook,
    iconColor: '#7dd3fc',
    accent: 'sky',
  },
  outlook: {
    label: 'Outlook',
    icon: Outlook,
    iconColor: '#7dd3fc',
    accent: 'sky',
  },
} as const;

interface MailboxListItemProps {
  id: string;
  emailAddress: string;
  displayName?: string | null;
  provider: string;
  status: MailboxStatus;
  isPrimary: boolean;
  onSetPrimary: (id: string) => void;
  onReconnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  isUpdating?: boolean;
  isSingleMailbox?: boolean;
}

export const MailboxListItem: React.FC<MailboxListItemProps> = ({
  id,
  emailAddress,
  displayName,
  provider,
  status,
  isPrimary,
  onSetPrimary,
  onReconnect,
  onDisconnect,
  isUpdating = false,
  isSingleMailbox = false,
}) => {
  const normalizedProvider = provider?.toLowerCase() ?? '';
  const providerConfig =
    PROVIDER_CONFIG[normalizedProvider as keyof typeof PROVIDER_CONFIG];

  const Icon = providerConfig?.icon;
  const iconColor = providerConfig?.iconColor ?? '#e2e8f0';
  const providerLabel = providerConfig?.label ?? 'Email';

  const showReconnectButton = status === 'NEEDS_RECONNECT' || status === 'ERROR';

  return (
    <div
      className={cn(
        'relative group rounded-xl border p-4 transition-all duration-200',
        // Base styling
        'bg-gray-950/60 backdrop-blur-sm',
        // Primary variant with gold accent
        isPrimary
          ? 'border-amber-700/40 bg-gradient-to-br from-amber-900/15 via-transparent to-transparent ring-1 ring-amber-500/20'
          : 'border-gray-800/60 hover:border-gray-700 hover:bg-gray-900/40',
        // Updating state
        isUpdating && 'opacity-60 pointer-events-none'
      )}
    >
      {/* Primary glow effect */}
      {isPrimary && (
        <div className="absolute -inset-px rounded-xl bg-gradient-to-br from-amber-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      )}

      <div className="relative flex items-center gap-4">
        {/* Provider Icon */}
        <div
          className={cn(
            'relative flex items-center justify-center w-11 h-11 rounded-xl border bg-black/30 shrink-0',
            isPrimary ? 'border-amber-700/40' : 'border-gray-700/60'
          )}
          style={{ '--icon-color': iconColor } as React.CSSProperties}
        >
          {Icon ? (
            <Icon className="w-5 h-5" />
          ) : (
            <span className="text-xs font-bold text-gray-400">EA</span>
          )}
          {isPrimary && (
            <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Crown className="w-2.5 h-2.5 text-amber-900" />
            </div>
          )}
        </div>

        {/* Email Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white truncate">
              {displayName || emailAddress}
            </span>
            <MailboxStatusPill status={status} size="sm" />
            {isPrimary && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-amber-200 bg-gradient-to-r from-amber-700/40 to-yellow-700/30 border border-amber-500/30">
                <Star className="w-2.5 h-2.5 fill-current" />
                Primary
              </span>
            )}
          </div>
          {displayName && displayName !== emailAddress && (
            <p className="text-sm text-gray-400 truncate mt-0.5">{emailAddress}</p>
          )}
          <p className="text-xs text-gray-500 mt-1">{providerLabel}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Inline reconnect button for error states */}
          {showReconnectButton && (
            <LiquidButton
              onClick={() => onReconnect(id)}
              size="sm"
              minWidth="none"
              disabled={isUpdating}
              className={cn(
                LIQUID_BUTTON_BASE_CLASS,
                'h-8 px-3 py-1.5 text-xs font-medium',
                'bg-gradient-to-br from-amber-500/70 via-orange-500/60 to-amber-600/70',
                'text-white shadow-lg shadow-amber-900/30',
                'hover:brightness-110 hover:scale-100 transition-all'
              )}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <RefreshCw className="w-3 h-3 shrink-0" />
                Reconnect
              </span>
            </LiquidButton>
          )}

          {/* Dropdown Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'p-2 rounded-lg transition-colors cursor-pointer',
                  'text-gray-400 hover:text-white',
                  'hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/20',
                  isUpdating && 'opacity-50'
                )}
                disabled={isUpdating}
                aria-label="Mailbox actions"
              >
                {isUpdating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MoreVertical className="w-4 h-4" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 bg-gray-900/95 border-gray-800 backdrop-blur-xl"
            >
              {!isPrimary && (
                <DropdownMenuItem
                  onClick={() => onSetPrimary(id)}
                  className="cursor-pointer text-gray-200 focus:bg-white/10 focus:text-white"
                >
                  <Star className="w-4 h-4 mr-2 text-amber-400" />
                  Set as primary
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onReconnect(id)}
                className="cursor-pointer text-gray-200 focus:bg-white/10 focus:text-white"
              >
                <RefreshCw className="w-4 h-4 mr-2 text-blue-400" />
                Reconnect
              </DropdownMenuItem>
              {!isSingleMailbox && (
                <>
                  <DropdownMenuSeparator className="bg-gray-800" />
                  <DropdownMenuItem
                    onClick={() => onDisconnect(id)}
                    className="cursor-pointer text-red-400 focus:bg-red-900/30 focus:text-red-300"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Disconnect
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};
