'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { QueueIntroCarousel } from './QueueIntroCarousel';
import type { QueueIntroDialogProps } from './types';

export const QueueIntroDialog: React.FC<QueueIntroDialogProps> = ({
  isOpen,
  steps,
  onClose,
  onComplete,
}) => {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => (!open ? onClose() : null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-[1000] flex items-center justify-center px-4 py-12">
          <div className="relative w-full max-w-5xl">
            <Dialog.Title className="sr-only">Queue introduction</Dialog.Title>
            <Dialog.Description className="sr-only">
              Guided overview of the Clira experience
            </Dialog.Description>
            <button
              type="button"
              onClick={onClose}
              className="absolute -top-12 right-0 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-slate-200 transition hover:scale-105 hover:bg-black/80"
              aria-label="Close intro"
            >
              <X className="h-5 w-5" />
            </button>
            <QueueIntroCarousel steps={steps} onComplete={onComplete} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
