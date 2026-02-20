import React, { memo, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  iconColor?: string;
  showGreeting?: boolean;
  className?: string;
}

/**
 * Unified PageHeader component for all pages
 * Modern, elegant design with consistent styling across the app
 */
export const PageHeader = memo<PageHeaderProps>(({ 
  title, 
  subtitle, 
  icon: Icon, 
  iconColor = 'text-blue-400',
  showGreeting = false,
  className = ''
}) => {
  const { data: session } = useSession();
  
  // Memoize derived values
  const { firstName, greeting } = useMemo(() => {
    const fullName = session?.user?.name ?? '';
    const firstName = fullName.split(' ')[0] || 'there';
    
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    
    return { firstName, greeting };
  }, [session?.user?.name]);

  return (
    <div className={`relative group mx-4 sm:mx-6 lg:mx-8 mb-8 ${className}`}>
      <div className="relative py-8">
        {/* Greeting (optional) */}
        {showGreeting && (
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-100 to-blue-200 mb-4 tracking-tight leading-tight drop-shadow-[0_0_8px_rgba(59,130,246,0.3)] group-hover:drop-shadow-[0_0_12px_rgba(59,130,246,0.5)] transition-all duration-300">
            Good {greeting}, {firstName}
          </h1>
        )}
        
        {/* Main Title with Icon */}
        <div className="flex items-center gap-4 mb-4">
          {Icon && (
            <div className={`w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-2xl bg-gray-900/60 border-2 border-gray-800/60 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-300`}>
              <Icon className={`w-7 h-7 sm:w-8 sm:h-8 lg:w-9 lg:h-9 ${iconColor}`} />
            </div>
          )}
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-100 to-blue-200 tracking-tight leading-tight drop-shadow-[0_0_8px_rgba(59,130,246,0.3)] group-hover:drop-shadow-[0_0_12px_rgba(59,130,246,0.5)] transition-all duration-300">
            {title}
          </h2>
        </div>
        
        {/* Subtitle */}
        <p className="text-gray-300/90 text-lg sm:text-xl leading-relaxed font-medium tracking-wide max-w-3xl drop-shadow-[0_0_4px_rgba(156,163,175,0.2)] group-hover:drop-shadow-[0_0_6px_rgba(156,163,175,0.3)] transition-all duration-300">
          {subtitle}
        </p>
      </div>
      
      {/* Elegant separation gradient - desktop only to avoid mobile blue strip */}
      <div className="hidden sm:block absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400/20 to-transparent"></div>
      <div className="hidden sm:block absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none"></div>
    </div>
  );
});

PageHeader.displayName = 'PageHeader';
