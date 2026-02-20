'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { WhatsAppPromoCard } from './WhatsAppPromoCard';

export interface WhatsAppPromoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: () => void;
}

export const WhatsAppPromoDialog: React.FC<WhatsAppPromoDialogProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-[1000] flex items-center justify-center px-4 py-12">
          <div className="relative w-full max-w-4xl">
            <Dialog.Title className="sr-only">
              Connect with Clira on WhatsApp
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Discover our new WhatsApp integration for instant AI email assistance
            </Dialog.Description>
            <WhatsAppPromoCard onDismiss={onClose} onConnect={onConnect} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
