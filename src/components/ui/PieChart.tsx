import React from 'react';

interface PieChartProps {
  data: Record<string, number>;
  colors: Record<string, string>;
}

export const PieChart: React.FC<PieChartProps> = ({ data, colors }) => {
  const total = Object.values(data).reduce((acc, val) => acc + val, 0);
  if (total === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">No data for pie chart.</p>;

  const segments = Object.entries(data).map(([key, value]) => {
    const percent = (value / total) * 100;
    return { key, percent, color: colors[key] };
  });

  return (
    <div className="space-y-2">
      {segments.map(s => (
        <div key={s.key} className="flex items-center justify-between text-sm">
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-sm mr-2" style={{ backgroundColor: s.color }} />
            <span className="capitalize text-gray-600 dark:text-gray-300">{s.key}</span>
          </div>
          <span className="font-medium text-gray-700 dark:text-gray-200">{s.percent.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
};
