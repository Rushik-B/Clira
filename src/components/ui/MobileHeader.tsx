'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useOptionalSidebar } from '@/components/ui/sidebar/sidebar';
import { PanelLeftOpen, X } from '@/components/icons/icons';

interface MobileHeaderProps {
  title?: string;
  showTitle?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Fixed mobile header component with integrated sidebar toggle
 * Shows only on mobile (sm:hidden) and provides a clean header bar
 * Design matches the app's aesthetic with proper backdrop blur and styling
 */
export const MobileHeader: React.FC<MobileHeaderProps> = ({
  title,
  showTitle = true,
  className = '',
  children
}) => {
  const sidebar = useOptionalSidebar();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Only render after mount; if provider exists and indicates desktop, hide.
  if (!mounted) return null;
  if (sidebar && !sidebar.isMobile) return null;

  const header = (
    <header
      className={`
        sm:hidden fixed top-0 left-0 right-0 z-[200]
        h-16 flex items-center justify-between px-4
        bg-black/85 backdrop-blur-xl border-b border-gray-800/60
        shadow-2xl will-change-transform pointer-events-auto
        ${className}
      `}
    >
      {/* Left section - Sidebar Toggle (only if sidebar provider exists) */}
      <div className="flex items-center">
        {sidebar && (
          <button
            type="button"
            aria-label={sidebar.openMobile ? "Close menu" : "Open menu"}
            onClick={sidebar.toggleSidebar}
            className="
              h-10 w-10 rounded-lg flex items-center justify-center
              text-gray-100 hover:text-white
              active:scale-95 transition-all duration-150 ease-out
              focus:outline-none focus:ring-2 focus:ring-blue-500/40
            "
          >
            {sidebar.openMobile ? (
              <X className="w-5 h-5" />
            ) : (
              <PanelLeftOpen className="w-5 h-5" />
            )}
          </button>
        )}

        {/* Title */}
        {showTitle && title && (
          <h1 className="ml-4 text-xl font-semibold text-white truncate">
            {title}
          </h1>
        )}
      </div>

      {/* Right section - Custom content or actions */}
      <div className="flex items-center space-x-2">
        {children}
      </div>
    </header>
  );

  return createPortal(header, document.body);
};
