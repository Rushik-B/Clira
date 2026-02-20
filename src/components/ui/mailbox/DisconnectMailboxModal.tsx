'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { StandardModal } from '@/components/ui/modals/StandardModal';
import { PrimaryButton } from '@/components/ui/buttons';

interface DisconnectMailboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  mailboxEmail: string;
  isPrimary: boolean;
}

export const DisconnectMailboxModal: React.FC<DisconnectMailboxModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  mailboxEmail,
  isPrimary,
}) => {
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState('');

  const canDisconnect = confirmationInput.trim().toLowerCase() === 'disconnect';

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setConfirmationInput('');
      setError('');
      setIsDisconnecting(false);
    }
  }, [isOpen]);

  const handleDisconnect = useCallback(async () => {
    if (!canDisconnect || isDisconnecting) return;

    setIsDisconnecting(true);
    setError('');

    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect mailbox');
    } finally {
      setIsDisconnecting(false);
    }
  }, [canDisconnect, isDisconnecting, onConfirm, onClose]);

  const handleClose = useCallback(() => {
    if (isDisconnecting) return;
    onClose();
  }, [isDisconnecting, onClose]);

  return (
    <StandardModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Disconnect inbox"
      subtitle={`Remove ${mailboxEmail} from your account`}
      icon={<AlertTriangle className="w-5 h-5 text-red-300" />}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={isDisconnecting}
            className="text-sm text-gray-400 hover:text-gray-300 disabled:opacity-50 cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <PrimaryButton
            disabled={!canDisconnect || isDisconnecting}
            onClick={handleDisconnect}
            className="bg-red-600 text-white hover:bg-red-500 border-red-500 disabled:opacity-40"
          >
            {isDisconnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Disconnecting…
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Disconnect inbox
              </>
            )}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-red-900/20 border border-red-800/40">
          <p className="text-sm text-red-200">
            <strong>Warning:</strong> This will permanently remove this inbox from
            Clira. Emails from this account will no longer appear in your queue.
          </p>
          {isPrimary && (
            <p className="text-sm text-amber-300 mt-2">
              This is your primary inbox. Another connected inbox will become the
              new primary.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-gray-300">
            Type <span className="font-mono font-bold text-white">disconnect</span> to
            confirm
          </label>
          <input
            type="text"
            value={confirmationInput}
            onChange={(e) => setConfirmationInput(e.target.value)}
            placeholder="Type disconnect to confirm"
            disabled={isDisconnecting}
            className="w-full rounded-xl bg-gray-900 border border-gray-800 px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/60 disabled:opacity-50 transition-all"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}
      </div>
    </StandardModal>
  );
};
