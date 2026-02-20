'use client';

import React, { memo } from 'react';

interface QueueStatsProps {
  itemCount: number;
}

/**
 * Simple stats component showing queue item count
 * Memoized for performance
 */
export const QueueStats = memo<QueueStatsProps>(({ itemCount }) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm space-y-3 sm:space-y-0 px-2">
      <span className="text-gray-400">
        Showing {itemCount} {itemCount === 1 ? 'email' : 'emails'}
      </span>
    </div>
  );
});

QueueStats.displayName = 'QueueStats';
