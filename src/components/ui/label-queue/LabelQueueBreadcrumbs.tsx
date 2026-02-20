'use client';

import React from 'react';
import { ChevronRight, List, ArrowLeft, Home } from 'lucide-react';
import { FolderData } from '@/components/ui/folder-management/types';

interface BreadcrumbItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  isActive?: boolean;
}

interface LabelQueueBreadcrumbsProps {
  folder: FolderData | null;
  onNavigateHome?: () => void;
  onNavigateToQueue?: () => void;
  className?: string;
}

export const LabelQueueBreadcrumbs: React.FC<LabelQueueBreadcrumbsProps> = ({
  folder,
  onNavigateHome,
  onNavigateToQueue,
  className = ''
}) => {
  const breadcrumbItems: BreadcrumbItem[] = [
    {
      id: 'home',
      label: 'Dashboard',
      icon: <Home size={14} />,
      onClick: onNavigateHome
    },
    {
      id: 'queue',
      label: 'All Queues',
      icon: <List size={14} />,
      onClick: onNavigateToQueue
    },
    {
      id: 'label-queue',
      label: folder?.name || 'Label Queue',
      icon: folder?.icon ? (
        <span className="text-sm leading-none">{folder.icon}</span>
      ) : null,
      isActive: true
    }
  ];

  return (
    <nav
      className={`flex items-center space-x-2 text-sm ${className}`}
      aria-label="Breadcrumb navigation"
    >
      {/* Back button for mobile/quick navigation */}
      <button
        onClick={onNavigateToQueue}
        className="flex items-center space-x-1 px-2 py-1 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-all duration-200 lg:hidden"
        aria-label="Go back to all queues"
      >
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      {/* Full breadcrumb trail for larger screens */}
      <div className="hidden lg:flex items-center space-x-2">
        {breadcrumbItems.map((item, index) => (
          <React.Fragment key={item.id}>
            {/* Breadcrumb Item */}
            <div className="flex items-center space-x-2">
              {item.onClick ? (
                <button
                  onClick={item.onClick}
                  className={`
                    flex items-center space-x-2 px-2 py-1 rounded-md transition-all duration-200
                    ${item.isActive
                      ? 'text-blue-400 bg-blue-900/20 border border-blue-800/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                    }
                  `}
                  aria-current={item.isActive ? 'page' : undefined}
                >
                  {item.icon && (
                    <span className={`
                      ${item.isActive ? 'text-blue-400' : 'text-gray-500'}
                    `}>
                      {item.icon}
                    </span>
                  )}
                  <span className="font-medium">{item.label}</span>
                </button>
              ) : (
                <div
                  className={`
                    flex items-center space-x-2 px-2 py-1 rounded-md
                    ${item.isActive
                      ? 'text-blue-400 bg-blue-900/20 border border-blue-800/30'
                      : 'text-gray-400'
                    }
                  `}
                  aria-current={item.isActive ? 'page' : undefined}
                >
                  {item.icon && (
                    <span className={`
                      ${item.isActive ? 'text-blue-400' : 'text-gray-500'}
                    `}>
                      {item.icon}
                    </span>
                  )}
                  <span className="font-medium">{item.label}</span>
                </div>
              )}
            </div>

            {/* Separator */}
            {index < breadcrumbItems.length - 1 && (
              <ChevronRight 
                size={14} 
                className="text-gray-600 flex-shrink-0" 
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Queue count indicator */}
      {folder && (
        <div className="ml-auto flex items-center space-x-2 px-3 py-1 bg-gray-800/50 border border-gray-700/50 rounded-md">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          <span className="text-xs text-gray-400">
            {folder.emailCount || 0} emails
          </span>
        </div>
      )}
    </nav>
  );
};

// Enhanced version with folder color theming
export const ThemedLabelQueueBreadcrumbs: React.FC<LabelQueueBreadcrumbsProps> = ({
  folder,
  onNavigateHome,
  onNavigateToQueue,
  className = ''
}) => {
  const folderColor = folder?.color || '#6366f1';
  
  // Extract RGB values for dynamic theming
  const getRgbFromHex = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 99, g: 102, b: 241 }; // Default blue
  };

  const rgb = getRgbFromHex(folderColor);
  const colorStyle = {
    '--folder-color': `${rgb.r}, ${rgb.g}, ${rgb.b}`,
    '--folder-color-bg': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`,
    '--folder-color-border': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`
  } as React.CSSProperties;

  const breadcrumbItems: BreadcrumbItem[] = [
    {
      id: 'home',
      label: 'Dashboard',
      icon: <Home size={14} />,
      onClick: onNavigateHome
    },
    {
      id: 'queue',
      label: 'All Queues',
      icon: <List size={14} />,
      onClick: onNavigateToQueue
    },
    {
      id: 'label-queue',
      label: folder?.name || 'Label Queue',
      icon: folder?.icon ? (
        <span className="text-sm leading-none">{folder.icon}</span>
      ) : null,
      isActive: true
    }
  ];

  return (
    <nav
      className={`flex items-center space-x-2 text-sm ${className}`}
      style={colorStyle}
      aria-label="Breadcrumb navigation"
    >
      {/* Back button for mobile */}
      <button
        onClick={onNavigateToQueue}
        className="flex items-center space-x-1 px-2 py-1 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-all duration-200 lg:hidden"
        aria-label="Go back to all queues"
      >
        <ArrowLeft size={16} />
        <span>Back</span>
      </button>

      {/* Full breadcrumb trail */}
      <div className="hidden lg:flex items-center space-x-2">
        {breadcrumbItems.map((item, index) => (
          <React.Fragment key={item.id}>
            <div className="flex items-center space-x-2">
              {item.onClick ? (
                <button
                  onClick={item.onClick}
                  className={`
                    flex items-center space-x-2 px-2 py-1 rounded-md transition-all duration-200
                    ${item.isActive
                      ? 'text-white border'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                    }
                  `}
                  style={item.isActive ? {
                    backgroundColor: 'var(--folder-color-bg)',
                    borderColor: 'var(--folder-color-border)',
                    color: `rgb(var(--folder-color))`
                  } : undefined}
                  aria-current={item.isActive ? 'page' : undefined}
                >
                  {item.icon && (
                    <span className={item.isActive ? 'opacity-90' : 'text-gray-500'}>
                      {item.icon}
                    </span>
                  )}
                  <span className="font-medium">{item.label}</span>
                </button>
              ) : (
                <div
                  className="flex items-center space-x-2 px-2 py-1 rounded-md border"
                  style={{
                    backgroundColor: 'var(--folder-color-bg)',
                    borderColor: 'var(--folder-color-border)',
                    color: `rgb(var(--folder-color))`
                  }}
                  aria-current="page"
                >
                  {item.icon && (
                    <span className="opacity-90">{item.icon}</span>
                  )}
                  <span className="font-medium">{item.label}</span>
                </div>
              )}
            </div>

            {index < breadcrumbItems.length - 1 && (
              <ChevronRight 
                size={14} 
                className="text-gray-600 flex-shrink-0" 
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Enhanced queue indicator with color theming */}
      {folder && (
        <div 
          className="ml-auto flex items-center space-x-2 px-3 py-1 rounded-md border"
          style={{
            backgroundColor: 'var(--folder-color-bg)',
            borderColor: 'var(--folder-color-border)'
          }}
        >
          <div 
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: `rgb(var(--folder-color))` }}
          ></div>
          <span 
            className="text-xs font-medium"
            style={{ color: `rgb(var(--folder-color))` }}
          >
            {folder.emailCount || 0} emails
          </span>
        </div>
      )}
    </nav>
  );
};

export default LabelQueueBreadcrumbs;