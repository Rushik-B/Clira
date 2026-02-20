import React from 'react';

interface ConfidencePillProps {
  confidence: number;
}

export const ConfidencePill: React.FC<ConfidencePillProps> = ({ confidence }) => {
  let colorClasses: string, glowClasses: string, dotColor: string;
  
  if (confidence >= 90) {
    colorClasses = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-700 dark:text-emerald-100';
    glowClasses = 'shadow-lg shadow-emerald-500/30';
    dotColor = 'bg-emerald-500';
  } else if (confidence >= 70) {
    colorClasses = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-600 dark:text-yellow-100';
    glowClasses = 'shadow-lg shadow-yellow-500/30';
    dotColor = 'bg-yellow-500';
  } else {
    colorClasses = 'bg-red-100 text-red-700 dark:bg-red-700 dark:text-red-100';
    glowClasses = 'shadow-lg shadow-red-500/30';
    dotColor = 'bg-red-500';
  }

  return (
    <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${colorClasses} ${glowClasses}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
      <span>{confidence}%</span>
    </div>
  );
}; 