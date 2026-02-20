import React from 'react';
import { 
  Tooltip, 
  TooltipContent, 
  TooltipTrigger 
} from './sidebar/tooltip';
import { Info } from 'lucide-react';

interface KeyMetricCardProps {
  metricKey: string;
  value: number | string;
}

export const KeyMetricCard: React.FC<KeyMetricCardProps> = ({ metricKey, value }) => (
  <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow text-center">
    <p className="text-2xl font-bold text-emerald-500">{value}</p>
    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
      {metricKey.replace(/([A-Z])/g, ' $1').trim()}
      {metricKey === 'errorRate' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info size={12} className="inline ml-1 text-gray-400 cursor-help" />
          </TooltipTrigger>
          <TooltipContent>Breakdown: Typos 40%, Wrong recipient 30%, Tone mismatch 30%</TooltipContent>
        </Tooltip>
      )}
    </p>
  </div>
);
