'use client';

import React, { memo, useEffect, useRef } from 'react';
import { CheckCircle, X, Mail } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  isVisible: boolean;
  onClose: () => void;
  onAnimationEnd?: () => void;
}

/**
 * Event-driven Toast component using CSS animations instead of setTimeout
 * Follows strict rules: no setTimeout for UI state management
 */
export const Toast = memo<ToastProps>(({ 
  message, 
  type, 
  isVisible, 
  onClose, 
  onAnimationEnd 
}) => {
  const toastRef = useRef<HTMLDivElement>(null);

  // Handle animation events instead of setTimeout
  useEffect(() => {
    const element = toastRef.current;
    if (!element) return;

    const handleAnimationEnd = (e: AnimationEvent) => {
      // Auto-hide after show animation completes
      if (e.animationName === 'toast-show' && isVisible) {
        // Use CSS animation delay for auto-dismiss
        element.style.animationDelay = '4s';
        element.style.animationName = 'toast-hide';
      }
      
      // Call cleanup after hide animation
      if (e.animationName === 'toast-hide') {
        onAnimationEnd?.();
      }
    };

    element.addEventListener('animationend', handleAnimationEnd);
    return () => element.removeEventListener('animationend', handleAnimationEnd);
  }, [isVisible, onAnimationEnd]);

  const getToastStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-emerald-900/90 border-emerald-700/50',
          icon: <CheckCircle size={20} className="text-emerald-400" />,
          glow: 'shadow-emerald-500/20'
        };
      case 'error':
        return {
          bg: 'bg-red-900/90 border-red-700/50',
          icon: <X size={20} className="text-red-400" />,
          glow: 'shadow-red-500/20'
        };
      default:
        return {
          bg: 'bg-blue-900/90 border-blue-700/50',
          icon: <Mail size={20} className="text-blue-400" />,
          glow: 'shadow-blue-500/20'
        };
    }
  };

  const styles = getToastStyles();

  if (!isVisible && !message) return null;

  return (
    <>
      <style jsx>{`
        @keyframes toast-show {
          from {
            transform: translate3d(100%, 0, 0);
            opacity: 0;
          }
          to {
            transform: translate3d(0, 0, 0);
            opacity: 1;
          }
        }
        
        @keyframes toast-hide {
          from {
            transform: translate3d(0, 0, 0);
            opacity: 1;
          }
          to {
            transform: translate3d(100%, 0, 0);
            opacity: 0;
          }
        }
        
        @media (prefers-reduced-motion: reduce) {
          @keyframes toast-show {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes toast-hide {
            from { opacity: 1; }
            to { opacity: 0; }
          }
        }
        
        .toast-enter {
          animation: toast-show 0.3s ease-out;
          will-change: transform, opacity;
        }
        
        .toast-exit {
          animation: toast-hide 0.3s ease-out;
          will-change: transform, opacity;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .toast-enter {
            animation: toast-show 0.15s ease-out;
          }
          .toast-exit {
            animation: toast-hide 0.15s ease-out;
          }
        }
      `}</style>
      
      <div 
        ref={toastRef}
        className={`fixed top-4 right-4 left-4 sm:left-auto z-50 ${
          isVisible ? 'toast-enter' : 'toast-exit'
        }`}
      >
        <div className={`relative group ${styles.bg} backdrop-blur-xl border-2 px-4 sm:px-6 py-3 sm:py-4 rounded-2xl shadow-2xl flex items-center space-x-3 w-full sm:max-w-md transition-colors duration-200 will-change-transform`}>
          {/* Enhanced glow effect */}
          <div className={`absolute -inset-1 bg-gradient-to-r from-transparent via-current to-transparent rounded-2xl blur-lg opacity-20 ${styles.glow}`}></div>
          
          <div className="relative flex items-center space-x-3 w-full">
            {styles.icon}
            <span className="font-medium text-sm sm:text-base flex-1 text-white">{message}</span>
            <button 
              onClick={onClose} 
              className="text-white/80 hover:text-white transition-colors cursor-pointer ml-2 flex-shrink-0 p-1 hover:bg-white/10 rounded-lg"
              aria-label="Close notification"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
});

Toast.displayName = 'Toast';