export interface QueueViewerNavigationPosition {
  index: number;
  total: number;
}

export interface QueueViewerNavigation {
  goToNext: () => void;
  goToPrevious: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
  position?: QueueViewerNavigationPosition;
}
