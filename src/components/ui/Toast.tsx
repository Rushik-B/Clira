import React, { memo } from 'react';
import { CheckCircle, X, Mail } from 'lucide-react';
import { useAutoDismiss } from '@/hooks/queue/useAutoDismiss';
import { TOAST_DISMISS_DELAY } from '@/constants/queue';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
  isVisible: boolean;
}

/**
 * Optimized Toast component with memoization
 * Preserves exact UI design while improving performance
 */
export const Toast = memo<ToastProps>(({ message, type, onClose, isVisible }) => {
  useAutoDismiss(isVisible, onClose, TOAST_DISMISS_DELAY);

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

  return (
    <div className={`fixed top-4 right-4 left-4 sm:left-auto z-50 transform transition-all duration-500 ease-out ${
      isVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'
    }`}>
      <div className={`relative group ${styles.bg} backdrop-blur-xl border-2 px-4 sm:px-6 py-3 sm:py-4 rounded-2xl shadow-2xl flex items-center space-x-3 w-full sm:max-w-md transition-all duration-300 hover:scale-105`}>
        {/* Enhanced glow effect */}
        <div className={`absolute -inset-1 bg-gradient-to-r from-transparent via-current to-transparent rounded-2xl blur-lg opacity-20 ${styles.glow}`}></div>
        
        <div className="relative flex items-center space-x-3 w-full">
          {styles.icon}
          <span className="font-medium text-sm sm:text-base flex-1 text-white">{message}</span>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors cursor-pointer ml-2 flex-shrink-0 p-1 hover:bg-white/10 rounded-lg">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
});

Toast.displayName = 'Toast';