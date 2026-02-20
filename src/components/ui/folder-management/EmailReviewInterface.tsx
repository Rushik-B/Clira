'use client';

import React from 'react';
import { PrimaryButton } from '@/components/ui/buttons';

interface EmailReviewInterfaceProps {
  onBackToManagement: () => void;
  [key: string]: any; // Allow other props for future implementation
}

export const EmailReviewInterface: React.FC<EmailReviewInterfaceProps> = ({
  onBackToManagement
}) => (
  <div className="p-8 text-center">
    <p className="text-white">Email Review Interface (Implementation needed)</p>
    <PrimaryButton onClick={onBackToManagement} minWidth="lg">
      Back to Management
    </PrimaryButton>
  </div>
);