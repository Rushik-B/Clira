'use client';

import React from 'react';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { PageHeader } from '@/components/ui/PageHeader';
import { TrendingUp } from 'lucide-react';

export const MetricsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-black">
      <MobileHeader title="Impact" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-8 pb-12">
        <PageHeader
          title="Clira's Impact"
          subtitle="See exactly how much time and effort Clira is saving you"
          showGreeting={false}
        />
        
        <div className="mt-12 flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 bg-gray-900/60 border border-gray-800/60 rounded-2xl flex items-center justify-center mb-6">
            <TrendingUp className="w-10 h-10 text-gray-500" />
          </div>
          <h2 className="text-2xl font-semibold text-white mb-2">Coming Soon</h2>
          <p className="text-gray-400 text-center max-w-md">
            Impact metrics and analytics are being built. Check back soon to see how much time Clira is saving you.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MetricsPage;
