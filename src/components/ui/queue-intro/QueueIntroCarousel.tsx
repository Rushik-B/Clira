'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import type { QueueIntroCarouselProps, QueueIntroStep } from './types';

const INDICATOR_BASE = 'h-1.5 rounded-full transition-all duration-200 ease-out';

interface StepContentProps {
  step: QueueIntroStep;
  isFirst: boolean;
}

const StepContent: React.FC<StepContentProps> = ({ step, isFirst }) => {
  const media = step.media;

  return (
    <article
      className="flex flex-col gap-6 rounded-[28px] border border-white/8 bg-gradient-to-b from-white/4 via-white/[0.03] to-black/20 p-4 shadow-[0_20px_60px_-32px_rgba(15,118,110,0.6)] transition-all duration-300 ease-out backdrop-blur-xl sm:p-6 md:min-h-[560px] md:grid md:grid-cols-[minmax(0,640px)_1fr] md:items-center md:gap-8 md:p-8"
    >
      <div className="flex w-full justify-center md:justify-start">
        <div className="relative aspect-[3456/1771] w-full max-w-[640px] overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-inner">
          {media.type === 'image' ? (
            <Image
              src={media.src}
              alt={media.alt}
              width={672}
              height={504}
              priority={isFirst}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            <video
              key={media.src}
              className="h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            >
              <source src={media.src} />
              {media.alt}
            </video>
          )}
        </div>
      </div>

      <div className="flex h-full flex-col items-center justify-center space-y-4 text-center md:items-start md:text-left">
        <div>
          <h2 className="text-2xl font-extrabold text-white sm:text-3xl md:text-4xl">{step.title}</h2>
          <p className="mt-2 text-sm text-slate-300 sm:mt-3 sm:text-base md:text-lg">{step.description}</p>
        </div>
      </div>
    </article>
  );
};

export const QueueIntroCarousel: React.FC<QueueIntroCarouselProps> = ({
  steps,
  initialIndex = 0,
  onIndexChange,
  onComplete,
}) => {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeStep = steps[activeIndex];
  const isLast = activeIndex === steps.length - 1;

  const handleGoBack = useCallback(() => {
    if (activeIndex === 0) return;
    const nextIndex = Math.max(activeIndex - 1, 0);
    setActiveIndex(nextIndex);
    onIndexChange?.(nextIndex);
  }, [activeIndex, onIndexChange]);

  const handleNext = useCallback(() => {
    const nextIndex = Math.min(activeIndex + 1, steps.length - 1);
    if (nextIndex !== activeIndex) {
      setActiveIndex(nextIndex);
      onIndexChange?.(nextIndex);
    }
    if (activeIndex === steps.length - 1) {
      onComplete?.();
    }
  }, [activeIndex, steps.length, onComplete, onIndexChange]);

  const indicatorItems = useMemo(
    () =>
      steps.map((step, index) => (
        <button
          key={step.id}
          type="button"
          aria-label={`Go to step ${index + 1}`}
          onClick={() => {
            setActiveIndex(index);
            onIndexChange?.(index);
          }}
          className={cn(
            INDICATOR_BASE,
            'bg-white/20',
            index === activeIndex && 'bg-white w-8',
            index !== activeIndex && 'w-4 hover:bg-white/30',
          )}
        />
      )),
    [steps, activeIndex, onIndexChange]
  );

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 text-white">
      <StepContent key={activeStep.id} step={activeStep} isFirst={activeIndex === 0} />

      <footer className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-black/40 p-4 shadow-[0_20px_60px_-36px_rgba(17,24,39,0.9)] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-300 md:text-base">
          <span className="font-medium text-white">Step {activeIndex + 1}</span>
          <span className="text-white/40">/</span>
          <span>{steps.length}</span>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end md:w-auto">
          <LiquidButton
            minWidth="sm"
            responsive
            variant="default"
            size="lg"
            className={`${LIQUID_BUTTON_BASE_CLASS} h-10 sm:h-11 sm:text-base md:min-w-[110px]`}
            onClick={handleGoBack}
            disabled={activeIndex === 0}
            type="button"
          >
            Go back
          </LiquidButton>
          <PrimaryButton
            minWidth="sm"
            className="w-full sm:w-auto h-10 rounded-xl text-sm font-semibold sm:h-11 sm:text-base md:min-w-[120px]"
            onClick={handleNext}
          >
            {isLast ? 'Get started' : 'Next'}
          </PrimaryButton>
        </div>
      </footer>

      <div className="flex items-center justify-center gap-2">{indicatorItems}</div>
    </div>
  );
};
