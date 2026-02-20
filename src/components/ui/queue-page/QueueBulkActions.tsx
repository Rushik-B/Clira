'use client';

import React, { memo } from 'react';
import { CheckCircle } from 'lucide-react';

interface QueueBulkActionsProps {
  selectedCount: number;
  onBulkApprove: () => void;
  onBulkReject: () => void;
}

/**
 * Bulk actions component for queue items
 * Only renders when items are selected for optimal performance
 */
export const QueueBulkActions = memo<QueueBulkActionsProps>(({ 
  selectedCount, 
  onBulkApprove, 
  onBulkReject 
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="relative group -mx-2">
      {/* Enhanced glow effect */}
      <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-blue-400/20 group-hover:via-blue-300/25 group-hover:to-blue-400/20 group-hover:blur-xl"></div>
      
      <div className="relative bg-blue-900/20 border-2 border-blue-700/50 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between shadow-xl backdrop-blur-sm space-y-4 sm:space-y-0 mx-2">
        <span className="text-base font-semibold text-blue-400 flex items-center">
          <CheckCircle size={18} className="mr-2" />
          {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
        </span>
        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4">
          <button 
            onClick={onBulkApprove} 
            className="w-full sm:w-auto min-w-[140px] px-6 py-3 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white border-2 border-emerald-500/50 hover:border-emerald-400/60 rounded-xl flex items-center justify-center transition-all duration-300 cursor-pointer backdrop-blur-sm"
          >
            <span className="flex items-center gap-2">
              Approve Selected
              <span className="text-xs opacity-60">⌘↵</span>
            </span>
          </button>
          <button 
            onClick={onBulkReject} 
            className="w-full sm:w-auto min-w-[140px] px-6 py-3 text-sm font-medium bg-red-600 hover:bg-red-500 text-white border-2 border-red-500/50 hover:border-red-400/60 rounded-xl flex items-center justify-center transition-all duration-300 cursor-pointer backdrop-blur-sm"
          >
            <span className="flex items-center gap-2">
              Reject Selected
              <span className="text-xs opacity-60">⌘↵</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
});

QueueBulkActions.displayName = 'QueueBulkActions';