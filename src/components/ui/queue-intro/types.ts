export interface QueueIntroMediaSource {
  type: 'image' | 'video';
  src: string ;
  alt: string;
}

export interface QueueIntroStep {
  id: string;
  title: string;
  description: string;
  media: QueueIntroMediaSource;
}

export interface QueueIntroCarouselProps {
  steps: QueueIntroStep[];
  initialIndex?: number;
  onIndexChange?: (nextIndex: number) => void;
  onComplete?: () => void;
}

export interface QueueIntroDialogProps {
  isOpen: boolean;
  steps: QueueIntroStep[];
  onClose: () => void;
  onComplete?: () => void;
}
