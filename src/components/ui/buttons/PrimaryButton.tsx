import React from 'react';
import { Button } from '@/components/ui/sidebar/button';
import { PrimaryButtonProps } from './types';

const minWidthClasses = {
  sm: 'min-w-[100px]',
  md: 'min-w-[120px]', 
  lg: 'min-w-[140px]',
  xl: 'min-w-[160px]'
};

interface ExtendedPrimaryButtonProps extends PrimaryButtonProps {
  colorScheme?: 'primary' | 'secondary' | 'destructive';
}

/**
 * Unified button component with color scheme support
 * Used for all button types with different colors
 */
export const PrimaryButton: React.FC<ExtendedPrimaryButtonProps> = ({
  children,
  onClick,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
  type = 'button',
  keyboardShortcut,
  keyboardShortcutClassName,
  minWidth = 'lg'
}) => {
  const handleClick = React.useCallback<React.MouseEventHandler<HTMLButtonElement>>(
    (e) => {
      if (!onClick) return;
      if (onClick.length === 0) {
        (onClick as () => void | Promise<void>)();
      } else {
        (onClick as React.MouseEventHandler<HTMLButtonElement>)(e);
      }
    },
    [onClick]
  );
  return (
    <Button
      onClick={handleClick}
      disabled={disabled}
      variant="default"
      size="lg"
      type={type}
      className={`w-full sm:w-auto ${minWidthClasses[minWidth]} rounded-2xl h-10 leading-none bg-emerald-600 hover:bg-emerald-500 text-white ring-1 ring-emerald-400/30 shadow-elegant-lg transition-colors duration-150 ease-out cursor-pointer disabled:cursor-not-allowed font-bold ${className}`}
      aria-label={ariaLabel}
    >
      <span className="flex items-center gap-2">
        {children}
        {keyboardShortcut && (
          <span className={keyboardShortcutClassName ?? "text-xs bg-emerald-800/40 px-1.5 py-0.5 rounded font-medium border border-emerald-600/30"}>
            {keyboardShortcut}
          </span>
        )}
      </span>
    </Button>
  );
};
