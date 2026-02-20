import React, { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { MailboxOption } from '@/hooks/queue/useQueueFilters';

interface QueueFiltersProps {
  mailboxFilter: string;
  onMailboxFilterChange: (value: string) => void;
  mailboxOptions: MailboxOption[];
  filteredCount: number;
  totalCount: number;
  itemLabel?: string;
  summarySuffix?: string;
}

export const QueueFilters = memo<QueueFiltersProps>(({
  mailboxFilter,
  onMailboxFilterChange,
  mailboxOptions,
  filteredCount,
  totalCount,
  itemLabel = 'email',
  summarySuffix = 'in queue',
}) => {
  const isMailboxFilterActive = mailboxFilter !== 'all';
  const showMailboxFilter = mailboxOptions.length > 1;
  const normalizedLabel = itemLabel.trim() || 'email';
  const totalLabel = totalCount === 1 ? normalizedLabel : `${normalizedLabel}s`;
  const suffix = summarySuffix ? ` ${summarySuffix}` : '';

  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div className="text-xs text-gray-400">
        {isMailboxFilterActive
          ? `Showing ${filteredCount} of ${totalCount} ${totalLabel}`
          : `${totalCount} ${totalLabel}${suffix}`}
      </div>

      {showMailboxFilter && (
        <div className="w-full lg:w-64">
          <label className="block text-xs text-gray-400 mb-2">Inbox</label>
          <div className="relative">
            <select
              value={mailboxFilter}
              onChange={(e) => onMailboxFilterChange(e.target.value)}
              className="w-full bg-black/60 border-2 border-gray-800/70 rounded-2xl px-4 py-3 pr-10 text-sm text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all cursor-pointer appearance-none"
              aria-label="Filter queue by inbox"
            >
              <option value="all">All inboxes</option>
              {mailboxOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      )}
    </div>
  );
});

QueueFilters.displayName = 'QueueFilters';
