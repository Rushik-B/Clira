import { useMemo } from 'react';
import { QueueItem } from '@/types';

export const UNKNOWN_MAILBOX_KEY = '__unknown__';

export interface MailboxMeta {
  mailboxId?: string | null;
  mailboxEmail?: string | null;
  mailboxDisplayName?: string | null;
}

export interface MailboxOption {
  key: string;
  label: string;
}

export interface MailboxGroup<T> {
  key: string;
  label: string;
  items: T[];
}

type MailboxMetaGetter<T> = (item: T) => MailboxMeta | null | undefined;

export const getMailboxKeyFromMeta = (meta?: MailboxMeta | null) =>
  meta?.mailboxId || meta?.mailboxEmail || meta?.mailboxDisplayName || '';

export const buildMailboxLabelFromMeta = (meta?: MailboxMeta | null) => {
  const displayName = meta?.mailboxDisplayName?.trim();
  const mailboxEmail = meta?.mailboxEmail?.trim();

  if (displayName && mailboxEmail && displayName !== mailboxEmail) {
    return `${displayName} (${mailboxEmail})`;
  }

  return displayName || mailboxEmail || 'Mailbox';
};

const defaultQueueMailboxMeta: MailboxMetaGetter<QueueItem> = (item) => ({
  mailboxId: item.metadata?.mailboxId ?? undefined,
  mailboxEmail: item.metadata?.mailboxEmail ?? undefined,
  mailboxDisplayName: item.metadata?.mailboxDisplayName ?? undefined,
});

const buildMailboxOptions = <T,>(
  items: T[],
  getMailboxMeta: MailboxMetaGetter<T>
): MailboxOption[] => {
  const seen = new Map<string, MailboxOption>();
  let hasUnknown = false;

  items.forEach((item) => {
    const meta = getMailboxMeta(item);
    const key = getMailboxKeyFromMeta(meta);
    if (!key) {
      hasUnknown = true;
      return;
    }
    if (!seen.has(key)) {
      seen.set(key, { key, label: buildMailboxLabelFromMeta(meta) });
    }
  });

  const options = Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));

  if (hasUnknown) {
    options.push({ key: UNKNOWN_MAILBOX_KEY, label: 'Unknown inbox' });
  }

  return options;
};

interface UseQueueFiltersArgs<T> {
  items: T[];
  mailboxFilter: string;
  getMailboxMeta?: MailboxMetaGetter<T>;
}

export const useQueueFilters = <T,>({
  items,
  mailboxFilter,
  getMailboxMeta,
}: UseQueueFiltersArgs<T>) => {
  const resolveMailboxMeta = useMemo(
    () => (getMailboxMeta ?? (defaultQueueMailboxMeta as MailboxMetaGetter<T>)),
    [getMailboxMeta]
  );

  const mailboxOptions = useMemo(
    () => buildMailboxOptions(items, resolveMailboxMeta),
    [items, resolveMailboxMeta]
  );
  const isMailboxFilterActive = mailboxFilter !== 'all';

  const filteredItems = useMemo(() => {
    if (!isMailboxFilterActive) {
      return items;
    }

    return items.filter((item) => {
      const meta = resolveMailboxMeta(item);
      const key = getMailboxKeyFromMeta(meta);
      if (!key) {
        return mailboxFilter === UNKNOWN_MAILBOX_KEY;
      }
      return key === mailboxFilter;
    });
  }, [items, isMailboxFilterActive, mailboxFilter, resolveMailboxMeta]);

  return {
    filteredItems,
    mailboxOptions,
    isMailboxFilterActive,
  };
};

export const groupItemsByMailbox = <T,>({
  items,
  getMailboxMeta,
  mailboxOptions,
}: {
  items: T[];
  getMailboxMeta: MailboxMetaGetter<T>;
  mailboxOptions?: MailboxOption[];
}): MailboxGroup<T>[] => {
  const labelLookup = new Map((mailboxOptions ?? []).map((option) => [option.key, option.label]));
  const orderLookup = new Map(
    (mailboxOptions ?? []).map((option, index) => [option.key, index])
  );
  const groups = new Map<string, MailboxGroup<T>>();

  items.forEach((item) => {
    const meta = getMailboxMeta(item);
    const key = getMailboxKeyFromMeta(meta) || UNKNOWN_MAILBOX_KEY;
    const label =
      labelLookup.get(key) ||
      (key === UNKNOWN_MAILBOX_KEY ? 'Unknown inbox' : buildMailboxLabelFromMeta(meta));

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      return;
    }

    groups.set(key, { key, label, items: [item] });
  });

  const grouped = Array.from(groups.values());

  if (orderLookup.size > 0) {
    grouped.sort((a, b) => {
      const orderA = orderLookup.get(a.key);
      const orderB = orderLookup.get(b.key);
      if (orderA != null && orderB != null && orderA !== orderB) {
        return orderA - orderB;
      }
      if (orderA != null) return -1;
      if (orderB != null) return 1;
      return a.label.localeCompare(b.label);
    });
  } else {
    grouped.sort((a, b) => a.label.localeCompare(b.label));
  }

  return grouped;
};
