'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MailboxStatus } from '@/components/ui/mailbox/MailboxStatusPill';

export interface Mailbox {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  emailAddress: string;
  displayName: string | null;
  isPrimary: boolean;
  status: MailboxStatus;
  createdAt: string;
  updatedAt: string;
}

interface UseMailboxesReturn {
  mailboxes: Mailbox[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setMailboxAsPrimary: (id: string) => Promise<void>;
  disconnectMailbox: (id: string) => Promise<void>;
  updatingId: string | null;
}

export function useMailboxes(): UseMailboxesReturn {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchMailboxes = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/api/mailbox');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch mailboxes');
      }

      setMailboxes(data.mailboxes);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load mailboxes';
      setError(message);
      console.error('[useMailboxes] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMailboxes();
  }, [fetchMailboxes]);

  const setMailboxAsPrimary = useCallback(async (id: string) => {
    setUpdatingId(id);
    setError(null);

    // Optimistic update
    const previousMailboxes = mailboxes;
    setMailboxes((current) =>
      current.map((m) => ({
        ...m,
        isPrimary: m.id === id,
      }))
    );

    try {
      const response = await fetch(`/api/mailbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-primary' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to set primary mailbox');
      }

      // Refetch to ensure consistency
      await fetchMailboxes();
    } catch (err) {
      // Rollback on error
      setMailboxes(previousMailboxes);
      const message = err instanceof Error ? err.message : 'Failed to set primary';
      setError(message);
      throw err;
    } finally {
      setUpdatingId(null);
    }
  }, [mailboxes, fetchMailboxes]);

  const disconnectMailbox = useCallback(async (id: string) => {
    setUpdatingId(id);
    setError(null);

    try {
      const response = await fetch(`/api/mailbox/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to disconnect mailbox');
      }

      // Refetch to get updated list
      await fetchMailboxes();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect';
      setError(message);
      throw err;
    } finally {
      setUpdatingId(null);
    }
  }, [fetchMailboxes]);

  return {
    mailboxes,
    isLoading,
    error,
    refetch: fetchMailboxes,
    setMailboxAsPrimary,
    disconnectMailbox,
    updatingId,
  };
}
