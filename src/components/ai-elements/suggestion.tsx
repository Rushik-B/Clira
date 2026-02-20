'use client';

import * as React from 'react';
import { LiquidButton } from '@/components/ui/buttons';
import { cn } from '@/lib/utils';

type SuggestionsProps = React.HTMLAttributes<HTMLDivElement>;

export function Suggestions({ className, ...props }: SuggestionsProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap gap-2 sm:flex-nowrap sm:overflow-x-auto sm:pb-1',
        '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
}

type SuggestionProps = Omit<
  React.ComponentProps<typeof LiquidButton>,
  'children' | 'onClick' | 'type'
> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export function Suggestion({
  suggestion,
  onClick,
  className,
  ...props
}: SuggestionProps) {
  return (
    <LiquidButton
      type="button"
      size="sm"
      minWidth="none"
      onClick={() => onClick?.(suggestion)}
      className={cn(
        'h-8 !rounded-full border border-white/10 bg-slate-950/40 px-3 text-xs font-semibold text-slate-100',
        'backdrop-blur-xl transition-all duration-200 hover:bg-slate-900/50 hover:border-emerald-300/30',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {suggestion}
    </LiquidButton>
  );
}

