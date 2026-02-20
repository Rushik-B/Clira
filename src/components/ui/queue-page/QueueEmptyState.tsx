'use client';

import React, { memo } from 'react';
import { getQueueEmptyText } from '@/lib/utils/timeOfDayCopy';

/**
 * Empty state component for when no emails are in queue
 * Optimized with memo for performance
 */
export const QueueEmptyState = memo(() => {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <div className="relative">
        <div className="absolute left-1/2 top-1/2 h-24 w-80 -translate-x-1/2 -translate-y-1/2 rounded-[999px] bg-blue-400/35 blur-[120px] opacity-80 sm:h-32 sm:w-[28rem]" />
        <div className="absolute left-1/2 top-1/2 h-16 w-64 -translate-x-1/2 -translate-y-1/2 rounded-[999px] bg-blue-300/25 blur-[80px] opacity-1000 sm:h-24 sm:w-[22rem]" />
        <h2 className="relative text-3xl sm:text-4xl lg:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-100 to-blue-200 tracking-tight leading-tight drop-shadow-[0_0_8px_rgba(59,130,246,0.3)]">
          {getQueueEmptyText()}
        </h2>
      </div>
    </div>
  );
});

QueueEmptyState.displayName = 'QueueEmptyState';
