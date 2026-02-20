'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { Shield, User, AlertTriangle, Trash2, Lock, Loader2 } from 'lucide-react';
import { PrimaryButton } from '@/components/ui/buttons';
import { StandardModal } from '@/components/ui/modals/StandardModal';
import { SettingsShell, SettingsSectionCard } from './SettingsShell';

export const AccountPrivacyPage: React.FC = () => {
  const { data: session } = useSession();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const canDelete = confirmationInput.trim().toLowerCase() === 'delete';

  return (
    <>
      <SettingsShell
        title="Account & Privacy"
        subtitle="See what we know about you, how it’s protected, and how to remove it."
        icon={Shield}
        iconColor="text-blue-400"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SettingsSectionCard
            title="Account profile"
            description="Clira uses your Google identity to authenticate and sync Gmail."
            icon={<User className="w-5 h-5" />}
          >
            <dl className="space-y-4">
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">Full name</dt>
                <dd className="mt-1 text-base text-white font-medium">
                  {session?.user?.name || 'Not available'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">Email</dt>
                <dd className="mt-1 text-base text-white font-medium">
                  {session?.user?.email || 'Not available'}
                </dd>
              </div>
              <div className="flex items-center justify-between pt-2">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-gray-500">Status</dt>
                  <dd className="mt-1 flex items-center space-x-2 text-sm text-emerald-300 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>Connected</span>
                  </dd>
                </div>
                <span className="text-xs text-gray-500">
                  Update your profile from Google Account settings
                </span>
              </div>
            </dl>
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Data & privacy"
            description="We minimize the data stored and encrypt everything at rest and in transit."
            icon={<Lock className="w-5 h-5" />}
          >
            <ul className="space-y-4 text-sm text-gray-300 leading-relaxed">
              <li>Emails are fetched, processed, and discarded after actions complete.</li>
              <li>OAuth tokens are envelope-encrypted with per-user keys.</li>
              <li>
                Access to your Gmail can be revoked anytime from{' '}
                <Link
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  className="text-blue-400 hover:text-blue-300 underline-offset-2"
                >
                  Google security settings
                </Link>
                .
              </li>
            </ul>
          </SettingsSectionCard>
        </div>

        <SettingsSectionCard
          title="Danger zone"
          description="Delete your account and every trace of data stored in Clira."
          icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
        >
          <p className="text-sm text-gray-400 mb-4">
            This permanently removes your automation history, AI learning, and any cached Gmail
            data. Gmail itself is untouched, but Clira will lose access immediately.
          </p>
          <PrimaryButton
            onClick={() => setDeleteOpen(true)}
            className="bg-red-600 text-white hover:bg-red-500 border-red-500"
          >
            <Trash2 className="w-4 h-4" />
            Delete account & data
          </PrimaryButton>
        </SettingsSectionCard>
      </SettingsShell>

      {isDeleteOpen && (
        <StandardModal
          isOpen
          onClose={() => {
            if (isDeleting) return;
            setDeleteOpen(false);
            setConfirmationInput('');
            setDeleteError('');
          }}
          title="Delete everything"
          subtitle="This action cannot be undone. Type DELETE to continue."
          icon={<AlertTriangle className="w-5 h-5 text-red-300" />}
          size="sm"
          footer={
            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={() => {
                  if (isDeleting) return;
                  setDeleteOpen(false);
                  setConfirmationInput('');
                  setDeleteError('');
                }}
                className="text-sm text-gray-400 hover:text-gray-300 disabled:opacity-50"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <PrimaryButton
                disabled={!canDelete || isDeleting}
                className="bg-red-600 text-white hover:bg-red-500 border-red-500 disabled:opacity-40"
                onClick={() => {
                  const deleteAccount = async () => {
                    if (isDeleting) return;
                    setIsDeleting(true);
                    setDeleteError('');
                    try {
                      const response = await fetch('/api/user/account', { method: 'DELETE' });
                      const data = await response.json();
                      if (!response.ok || !data.success) {
                        throw new Error(data.error || 'Failed to delete account');
                      }
                      await signOut({ callbackUrl: '/' });
                    } catch (error) {
                      setDeleteError(
                        error instanceof Error ? error.message : 'Failed to delete account'
                      );
                    } finally {
                      setIsDeleting(false);
                    }
                  };
                  deleteAccount();
                }}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Removing…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Permanently delete
                  </>
                )}
              </PrimaryButton>
            </div>
          }
        >
          <input
            type="text"
            value={confirmationInput}
            onChange={(e) => setConfirmationInput(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full rounded-xl bg-gray-900 border border-gray-800 px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/60"
          />
          {deleteError && <p className="mt-3 text-sm text-red-400">{deleteError}</p>}
        </StandardModal>
      )}
    </>
  );
};
