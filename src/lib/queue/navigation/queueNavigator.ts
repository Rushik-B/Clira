import { QueueItem } from '@/types';

export interface QueueNavigator {
  readonly items: readonly QueueItem[];
  getIndex(id: string): number | null;
  getItem(id: string): QueueItem | null;
  getNext(id: string): QueueItem | null;
  getPrevious(id: string): QueueItem | null;
  getPosition(id: string): { index: number; total: number } | null;
  hasNext(id: string): boolean;
  hasPrevious(id: string): boolean;
}

const createIdToIndex = (items: readonly QueueItem[]) => {
  const indexMap = new Map<string, number>();
  items.forEach((item, index) => {
    indexMap.set(item.id, index);
  });
  return indexMap;
};

const clampIndex = (index: number, total: number) => {
  if (index < 0 || index >= total) {
    return null;
  }
  return index;
};

const resolveItemAt = (items: readonly QueueItem[], index: number | null) => {
  if (index === null) {
    return null;
  }
  return items[index] ?? null;
};

export const createQueueNavigator = (items: readonly QueueItem[]): QueueNavigator => {
  const indexMap = createIdToIndex(items);
  const total = items.length;

  const getIndex = (id: string): number | null => {
    const index = indexMap.get(id);
    return typeof index === 'number' ? index : null;
  };

  const getOffsetItem = (id: string, offset: number): QueueItem | null => {
    const index = getIndex(id);
    if (index === null) {
      return null;
    }

    const nextIndex = clampIndex(index + offset, total);
    return resolveItemAt(items, nextIndex);
  };

  const getPosition = (id: string) => {
    const index = getIndex(id);
    if (index === null) {
      return null;
    }
    return { index, total };
  };

  return Object.freeze({
    items,
    getIndex,
    getItem: (id: string) => resolveItemAt(items, getIndex(id)),
    getNext: (id: string) => getOffsetItem(id, 1),
    getPrevious: (id: string) => getOffsetItem(id, -1),
    getPosition,
    hasNext: (id: string) => !!getOffsetItem(id, 1),
    hasPrevious: (id: string) => !!getOffsetItem(id, -1)
  });
};
