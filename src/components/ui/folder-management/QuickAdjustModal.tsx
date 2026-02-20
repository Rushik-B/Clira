'use client';

import React from 'react';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';

interface QuickAdjustModalProps {
  onClose: () => void;
  [key: string]: any; // Allow other props for future implementation
}

export const QuickAdjustModal: React.FC<QuickAdjustModalProps> = ({ onClose }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
    <div className="bg-gray-900 rounded-3xl p-8 max-w-2xl w-full">
      <h3 className="text-xl font-semibold text-white mb-6">Quick Adjust</h3>
      <p className="text-gray-300 mb-4">Quick Adjust Modal (Implementation needed)</p>
      <LiquidButton
        onClick={onClose}
        minWidth="md"
        responsive
        variant="default"
        size="lg"
        className={LIQUID_BUTTON_BASE_CLASS}
        type="button"
      >
        Close
      </LiquidButton>
    </div>
  </div>
);
