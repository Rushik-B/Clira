'use client';

import { motion } from 'motion/react';
import { memo, useMemo, type CSSProperties, type ElementType, type JSX } from 'react';
import { cn } from '@/lib/utils';

export type ShimmerProps = {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
};

const ShimmerComponent = ({
  children,
  as: Component = 'p',
  className,
  duration = 2.6,
  spread = 2.5,
}: ShimmerProps) => {
  const MotionComponent = motion.create(Component as keyof JSX.IntrinsicElements);

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  const style = useMemo(
    () =>
      ({
        '--spread': `${dynamicSpread}px`,
        backgroundImage:
          'linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--shimmer-highlight, rgba(248, 250, 252, 0.95)), transparent calc(50% + var(--spread))), linear-gradient(var(--shimmer-base, rgba(148, 163, 184, 0.95)), var(--shimmer-base, rgba(148, 163, 184, 0.95)))',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '250% 100%, 100% 100%',
      }) as CSSProperties,
    [dynamicSpread],
  );

  return (
    <MotionComponent
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'relative inline-block bg-clip-text text-transparent',
        className,
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={style}
      transition={{
        repeat: Number.POSITIVE_INFINITY,
        duration,
        ease: 'linear',
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
