import { useCallback, useEffect, useMemo } from 'react';
import { QueueItem } from '@/types';
import { createQueueNavigator } from '@/lib/queue/navigation/queueNavigator';
import { QueueViewerNavigation } from '@/lib/queue/navigation/types';

interface UseQueueViewerNavigationParams {
  items: readonly QueueItem[];
  activeItem: QueueItem | null;
  setActiveItem: (item: QueueItem | null) => void;
}

export const useQueueViewerNavigation = ({
  items,
  activeItem,
  setActiveItem
}: UseQueueViewerNavigationParams): QueueViewerNavigation | undefined => {
  const navigator = useMemo(() => createQueueNavigator(items), [items]);

  useEffect(() => {
    if (!activeItem) {
      return;
    }

    const matchingItem = navigator.getItem(activeItem.id);
    if (!matchingItem) {
      setActiveItem(null);
    }
  }, [activeItem, navigator, setActiveItem]);

  const goToNext = useCallback(() => {
    if (!activeItem) {
      return;
    }
    const nextItem = navigator.getNext(activeItem.id);
    if (nextItem) {
      setActiveItem(nextItem);
    }
  }, [activeItem, navigator, setActiveItem]);

  const goToPrevious = useCallback(() => {
    if (!activeItem) {
      return;
    }
    const previousItem = navigator.getPrevious(activeItem.id);
    if (previousItem) {
      setActiveItem(previousItem);
    }
  }, [activeItem, navigator, setActiveItem]);

  return useMemo(() => {
    if (!activeItem) {
      return undefined;
    }

    const position = navigator.getPosition(activeItem.id);
    if (!position) {
      return undefined;
    }

    return {
      goToNext,
      goToPrevious,
      hasNext: navigator.hasNext(activeItem.id),
      hasPrevious: navigator.hasPrevious(activeItem.id),
      position
    } satisfies QueueViewerNavigation;
  }, [activeItem, navigator, goToNext, goToPrevious]);
};
