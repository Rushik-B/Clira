'use client';

import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, Clock, Edit3, Info, X, Minimize2, Maximize2, Check } from 'lucide-react';
import { QueueItem } from '@/types';
import { timeSince } from '@/lib/utils/utils';
import { ConfidencePill } from './ConfidencePill';
import { 
  Tooltip, 
  TooltipContent, 
  TooltipTrigger 
} from './sidebar/tooltip';

interface ActionCardProps {
  item: QueueItem;
  onAction: (itemId: string, actionType: string) => void;
}

export const ActionCard: React.FC<ActionCardProps> = ({ item, onAction }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  const statusColors = {
    'auto-approved': { 
      bg: 'bg-emerald-50 dark:bg-emerald-900/30', 
      border: 'border-emerald-500', 
      text: 'text-emerald-700 dark:text-emerald-300', 
      icon: <ShieldCheck size={16} /> 
    },
    'needs-attention': { 
      bg: 'bg-yellow-50 dark:bg-yellow-900/30', 
      border: 'border-yellow-500', 
      text: 'text-yellow-700 dark:text-yellow-300', 
      icon: <AlertTriangle size={16} /> 
    },
    'snoozed': { 
      bg: 'bg-blue-50 dark:bg-blue-900/30', 
      border: 'border-blue-500', 
      text: 'text-blue-700 dark:text-blue-300', 
      icon: <Clock size={16} /> 
    },
    'manual': { 
      bg: 'bg-gray-100 dark:bg-gray-700/30', 
      border: 'border-gray-500', 
      text: 'text-gray-700 dark:text-gray-300', 
      icon: <Edit3 size={16} /> 
    },
  };
  
  const currentStatus = statusColors[item.status] || statusColors['manual'];

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300 border-l-4 ${currentStatus.border} overflow-hidden mb-4`}>
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <img src={item.senderAvatar} alt={item.sender} className="h-10 w-10 rounded-full border-2 border-gray-200 dark:border-gray-700" />
            <div>
              <p className="font-semibold text-gray-800 dark:text-white">{item.sender}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">{item.actionSummary}</p>
            </div>
          </div>
          <div className="flex flex-col items-end space-y-1">
            <ConfidencePill confidence={item.confidence} />
            <p className="text-xs text-gray-400 dark:text-gray-500">{item.timestamp ? timeSince(item.timestamp) : 'Recently'}</p>
          </div>
        </div>

        <div className={`mt-3 text-sm text-gray-700 dark:text-gray-300 transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-96' : 'max-h-12'}`}>
          <p className="whitespace-pre-line">{isExpanded ? item.fullDraft : item.draftPreview}</p>
        </div>
        
        <div className="mt-4 flex items-center justify-between">
           <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline focus:outline-none flex items-center"
            >
              {isExpanded ? <Minimize2 size={14} className="mr-1"/> : <Maximize2 size={14} className="mr-1"/>}
              {isExpanded ? 'Collapse' : 'Expand'} Preview
            </button>
            <div className="relative">
              <button
                onClick={() => setShowWhy(!showWhy)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none flex items-center"
              >
                <Info size={14} className="mr-1"/> Why?
              </button>
              {showWhy && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-gray-800 dark:bg-gray-900 text-white text-xs p-3 rounded-lg shadow-xl z-20 border border-gray-700">
                  <p className="font-semibold mb-1">Decision Rationale:</p>
                  <p>{item.reason}</p>
                  <p className="mt-1 text-gray-400">Confidence based on: tone, topic, timing.</p>
                   <button onClick={() => setShowWhy(false)} className="absolute top-1 right-1 text-gray-400 hover:text-white">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex space-x-2">
            {item.status === 'needs-attention' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => onAction(item.id, 'approve')} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-md shadow-sm focus:ring-2 focus:ring-emerald-400 focus:outline-none flex items-center">
                    <Check size={14} className="mr-1"/> Approve
                  </button>
                </TooltipTrigger>
                <TooltipContent>Approve (Enter)</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => onAction(item.id, 'edit')} className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-gray-400 focus:outline-none flex items-center">
                  <Edit3 size={14} className="mr-1"/> Edit
                </button>
              </TooltipTrigger>
              <TooltipContent>Edit (E)</TooltipContent>
            </Tooltip>
            {item.status !== 'snoozed' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => onAction(item.id, 'snooze')} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md shadow-sm focus:ring-2 focus:ring-blue-400 focus:outline-none flex items-center">
                    <Clock size={14} className="mr-1"/> Snooze
                  </button>
                </TooltipTrigger>
                <TooltipContent>Snooze (S)</TooltipContent>
              </Tooltip>
            )}
             <Tooltip >
              <TooltipTrigger asChild>
              <button onClick={() => onAction(item.id, 'reject')} className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md shadow-sm focus:ring-2 focus:ring-red-400 focus:outline-none flex items-center">
                <X size={14} className="mr-1"/> Reject
              </button>
              </TooltipTrigger>
              <TooltipContent>Reject (Del)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
       <div className={`h-1.5 ${currentStatus.bg.replace('bg-', 'bg-opacity-50 ')}`}>
        <div className={`h-full ${currentStatus.border.replace('border-', 'bg-')} w-full`}></div>
      </div>
    </div>
  );
}; 
