import React from 'react';
import { Zap } from 'lucide-react'; // swap for your icon system

interface LineGraphProps {
  data: number[];
  label: string;
}

export const LineGraph: React.FC<LineGraphProps> = ({ data, label }) => {
  const width = 300;
  const height = 100;
  const padding = 20;
  const maxX = data.length - 1;
  const maxY = Math.max(...data, 100);

  const points = data.map(
    (d, i) => `${(i / maxX) * (width - 2 * padding) + padding},${height - padding - (d / maxY) * (height - 2 * padding)}`
  ).join(' ');

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
      <h4 className="text-md font-semibold text-gray-700 dark:text-gray-200 mb-2">{label}</h4>
      {data && data.length > 0 ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          {[0, 25, 50, 75, 100].map(y => (
            <g key={`y-line-${y}`}>
              <line
                x1={padding}
                y1={height - padding - (y / maxY) * (height - 2 * padding)}
                x2={width - padding}
                y2={height - padding - (y / maxY) * (height - 2 * padding)}
                stroke="#e5e7eb"
                strokeWidth="0.5"
                strokeDasharray="2,2"
              />
              <text
                x={padding - 5}
                y={height - padding - (y / maxY) * (height - 2 * padding) + 3}
                textAnchor="end"
                fontSize="8"
                fill="#6b7280"
              >
                {y}%
              </text>
            </g>
          ))}
          <text x={padding} y={height - padding + 12} fontSize="8" fill="#6b7280">Start</text>
          <text x={width - padding} y={height - padding + 12} textAnchor="end" fontSize="8" fill="#6b7280">Now</text>

          <polyline points={points} fill="none" stroke="#10B981" strokeWidth="2" />
          {data.map((d, i) => (
            <circle
              key={i}
              cx={(i / maxX) * (width - 2 * padding) + padding}
              cy={height - padding - (d / maxY) * (height - 2 * padding)}
              r="2.5"
              fill="#10B981"
            />
          ))}
        </svg>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">No data available for graph.</p>
      )}
      {data[data.length - 1] > data[0] && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/50 p-2 rounded-md">
          <Zap size={12} className="inline mr-1" /> Your agent is learning and improving!
        </p>
      )}
    </div>
  );
};
