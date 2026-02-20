'use client';

import React, { useState, useCallback } from 'react';
import { Inbox, RefreshCw, AlertCircle, Mail } from 'lucide-react';
import { Gmail, Outlook } from '@/components/icons/icons';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { SettingsShell, SettingsSectionCard } from './SettingsShell';
import { MailboxListItem } from '@/components/ui/mailbox/MailboxListItem';
import { DisconnectMailboxModal } from '@/components/ui/mailbox/DisconnectMailboxModal';
import { useMailboxes, type Mailbox } from '@/hooks/useMailboxes';
import { cn } from '@/lib/utils';

// Skeleton loader for mailbox cards
const MailboxSkeleton: React.FC = () => (
  <div className="rounded-xl border border-gray-800/60 bg-gray-950/60 p-4 animate-pulse">
    <div className="flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-gray-800/60" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-48 rounded bg-gray-800/60" />
        <div className="h-3 w-32 rounded bg-gray-800/40" />
      </div>
      <div className="w-8 h-8 rounded-lg bg-gray-800/40" />
    </div>
  </div>
);

// Empty state component
const EmptyState: React.FC<{ onConnect: () => void }> = ({ onConnect }) => (
  <div className="text-center py-12 px-6">
    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-800/60 to-gray-900/60 border border-gray-700/40 flex items-center justify-center">
      <Mail className="w-8 h-8 text-gray-500" />
    </div>
    <h3 className="text-lg font-semibold text-white mb-2">No inboxes connected</h3>
    <p className="text-sm text-gray-400 mb-6 max-w-sm mx-auto">
      Connect your first Gmail account to start managing your emails with Clira.
    </p>
    <LiquidButton
      onClick={onConnect}
      size="lg"
      minWidth="lg"
      className={cn(
        LIQUID_BUTTON_BASE_CLASS,
        'bg-gradient-to-br from-sky-500/80 via-blue-500/70 to-indigo-500/80',
        'text-white shadow-[0_18px_36px_rgba(14,116,144,0.35)]',
        'hover:brightness-110'
      )}
    >
      <span className="inline-flex items-center justify-center gap-2">
        <span className="shrink-0 [--icon-color:currentColor]">
          <Gmail className="w-4 h-4" />
        </span>
        Connect Gmail
      </span>
    </LiquidButton>
  </div>
);

// Error state component
const ErrorState: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="text-center py-8 px-6">
    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-red-900/30 border border-red-800/40 flex items-center justify-center">
      <AlertCircle className="w-6 h-6 text-red-400" />
    </div>
    <p className="text-sm text-red-300 mb-4">{message}</p>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors cursor-pointer"
    >
      <RefreshCw className="w-4 h-4" />
      Try again
    </button>
  </div>
);

export const MailboxConnectionsPage: React.FC = () => {
  const {
    mailboxes,
    isLoading,
    error,
    refetch,
    setMailboxAsPrimary,
    disconnectMailbox,
    updatingId,
  } = useMailboxes();

  // Disconnect modal state
  const [disconnectTarget, setDisconnectTarget] = useState<Mailbox | null>(null);

  // Navigate to OAuth flow
  const handleConnect = useCallback(() => {
    window.location.href = '/api/mailbox/connect/start';
  }, []);

  const handleConnectGmail = useCallback(() => {
    window.location.href = '/api/mailbox/connect/start?provider=google';
  }, []);

  const handleConnectOutlook = useCallback(() => {
    // Outlook OAuth not implemented yet - no-op for now
  }, []);

  // Handle reconnect (same as connect - re-auth flow)
  const handleReconnect = useCallback((id: string) => {
    // Find the mailbox to reconnect
    const mailbox = mailboxes.find((m) => m.id === id);
    if (mailbox?.provider === 'google') {
      window.location.href = '/api/mailbox/connect/start';
    }
    // Future: handle other providers
  }, [mailboxes]);

  // Handle set primary
  const handleSetPrimary = useCallback(
    async (id: string) => {
      try {
        await setMailboxAsPrimary(id);
      } catch {
        // Error is handled in hook, shown via error state
      }
    },
    [setMailboxAsPrimary]
  );

  // Open disconnect confirmation modal
  const handleDisconnectClick = useCallback((id: string) => {
    const mailbox = mailboxes.find((m) => m.id === id);
    if (mailbox) {
      setDisconnectTarget(mailbox);
    }
  }, [mailboxes]);

  // Confirm disconnect
  const handleDisconnectConfirm = useCallback(async () => {
    if (!disconnectTarget) return;
    await disconnectMailbox(disconnectTarget.id);
  }, [disconnectTarget, disconnectMailbox]);

  // Close disconnect modal
  const handleDisconnectClose = useCallback(() => {
    setDisconnectTarget(null);
  }, []);

  const isSingleMailbox = mailboxes.length === 1;

  return (
    <>
      <SettingsShell
        title="Inboxes"
        subtitle="Manage email accounts synced with Clira"
        icon={Inbox}
        iconColor="text-sky-400"
      >
        {/* Connected Inboxes Section */}
        <SettingsSectionCard
          title="Your Inboxes"
          description="All connected email accounts"
          icon={<Inbox className="w-5 h-5" />}
        >
          {isLoading ? (
            // Loading skeleton
            <div className="space-y-3">
              <MailboxSkeleton />
              <MailboxSkeleton />
            </div>
          ) : error ? (
            // Error state
            <ErrorState message={error} onRetry={refetch} />
          ) : mailboxes.length === 0 ? (
            // Empty state
            <EmptyState onConnect={handleConnect} />
          ) : (
            // Mailbox list
            <div className="space-y-3">
              {mailboxes.map((mailbox) => (
                <MailboxListItem
                  key={mailbox.id}
                  id={mailbox.id}
                  emailAddress={mailbox.emailAddress}
                  displayName={mailbox.displayName}
                  provider={mailbox.provider}
                  status={mailbox.status}
                  isPrimary={mailbox.isPrimary}
                  onSetPrimary={handleSetPrimary}
                  onReconnect={handleReconnect}
                  onDisconnect={handleDisconnectClick}
                  isUpdating={updatingId === mailbox.id}
                  isSingleMailbox={isSingleMailbox}
                />
              ))}
            </div>
          )}
        </SettingsSectionCard>

        {/* Add Another Inbox Section */}
        <SettingsSectionCard
          title="Add another inbox"
          description="Connect Gmail or Outlook to unify your queue"
          icon={
            <span className="inline-flex [--icon-color:currentColor]">
              <Gmail className="w-5 h-5" />
            </span>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-300 leading-relaxed">
              New inboxes show up immediately with their own badge in the queue and
              review view, so you always know exactly where each email lives.
            </p>

            <div className="flex flex-wrap gap-3">
              {/* Connect Gmail */}
              <LiquidButton
                onClick={handleConnectGmail}
                size="lg"
                minWidth="lg"
                className={cn(
                  LIQUID_BUTTON_BASE_CLASS,
                  'bg-gradient-to-br from-sky-500/80 via-blue-500/70 to-indigo-500/80',
                  'text-white shadow-[0_18px_36px_rgba(14,116,144,0.35)]',
                  'hover:brightness-110 hover:scale-100',
                  'transition-[filter,box-shadow] duration-200',
                  'hover:shadow-[0_0_24px_rgba(14,116,144,0.5)]'
                )}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="shrink-0 [--icon-color:currentColor]">
                    <Gmail className="w-4 h-4" />
                  </span>
                  Connect Gmail
                </span>
              </LiquidButton>

              {/* Connect Outlook - coming soon */}
              <LiquidButton
                onClick={handleConnectOutlook}
                size="lg"
                minWidth="lg"
                disabled
                className={cn(
                  LIQUID_BUTTON_BASE_CLASS,
                  'bg-gradient-to-br from-sky-500/80 via-blue-500/70 to-indigo-500/80',
                  'text-white shadow-[0_18px_36px_rgba(14,116,144,0.35)]',
                  'opacity-60 cursor-not-allowed'
                )}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <span
                    className="shrink-0 [--icon-color:currentColor]"
                    style={{ '--icon-color': '#7dd3fc' } as React.CSSProperties}
                  >
                    <Outlook className="w-4 h-4" />
                  </span>
                  Connect Outlook
                </span>
              </LiquidButton>
            </div>

            <p className="text-xs text-gray-500">
              You will be redirected to Google to approve access.
            </p>
          </div>
        </SettingsSectionCard>
      </SettingsShell>

      {/* Disconnect Confirmation Modal */}
      {disconnectTarget && (
        <DisconnectMailboxModal
          isOpen={!!disconnectTarget}
          onClose={handleDisconnectClose}
          onConfirm={handleDisconnectConfirm}
          mailboxEmail={disconnectTarget.emailAddress}
          isPrimary={disconnectTarget.isPrimary}
        />
      )}
    </>
  );
};
