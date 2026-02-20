import { useEffect, useState } from 'react';

type ScrollIndicators = {
  scrollProgress: number;
  isScrollable: boolean;
  isNearTop: boolean;
  isNearBottom: boolean;
};

export function useScrollIndicators<T extends HTMLElement>(
  containerRef: React.RefObject<T | null> | React.MutableRefObject<T | null>,
  deps: unknown[] = []
): ScrollIndicators {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrollable, setIsScrollable] = useState(false);
  const [isNearTop, setIsNearTop] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId = 0;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = Math.max(scrollHeight - clientHeight, 1);
      const progress = Math.min(scrollTop / maxScroll, 1);
      setScrollProgress(progress);
      setIsScrollable(scrollHeight > clientHeight + 1);
      setIsNearTop(scrollTop <= 2);
      setIsNearBottom(scrollTop + clientHeight >= scrollHeight - 2);
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    const onResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { scrollProgress, isScrollable, isNearTop, isNearBottom };
}

export function useModalScrollLock(allowedSelectors: string = '.overflow-y-auto, textarea') {
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    const preventScroll = (e: WheelEvent | TouchEvent) => {
      const target = e.target as Element | null;
      if (!target) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const scrollableContent = (target.closest(allowedSelectors) as HTMLElement) || null;

      if (!scrollableContent) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Allow native scrolling within textareas without interference
      const isTextArea = scrollableContent.tagName === 'TEXTAREA';
      if (isTextArea) {
        return;
      }

      if (e instanceof WheelEvent) {
        const { scrollTop, scrollHeight, clientHeight } = scrollableContent;
        const isScrollingUp = e.deltaY < 0;
        const isScrollingDown = e.deltaY > 0;

        if (isScrollingUp && scrollTop === 0) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (isScrollingDown && scrollTop + clientHeight >= scrollHeight) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };

    document.addEventListener('wheel', preventScroll, { passive: false });
    document.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = originalStyle;
      document.removeEventListener('wheel', preventScroll);
      document.removeEventListener('touchmove', preventScroll);
    };
  }, [allowedSelectors]);
}


