import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface BaseButtonProps {
  children: ReactNode;
  onClick?:
    | ((e: ReactMouseEvent<HTMLButtonElement>) => void | Promise<void>)
    | (() => void | Promise<void>);
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  type?: 'button' | 'submit' | 'reset';
  minWidth?: ButtonSize;
}

export interface PrimaryButtonProps extends BaseButtonProps {
  keyboardShortcut?: string;
  keyboardShortcutClassName?: string;
}
