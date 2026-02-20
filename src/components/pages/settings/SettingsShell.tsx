'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { MobileHeader } from '@/components/ui/MobileHeader';

type SettingsIconComponent = LucideIcon | React.ComponentType<{ className?: string }>;

interface SettingsShellProps {
  title: string;
  subtitle: string;
  icon: SettingsIconComponent;
  iconColor?: string;
  mobileActions?: React.ReactNode;
  children: React.ReactNode;
}

export const SettingsShell: React.FC<SettingsShellProps> = ({
  title,
  subtitle,
  icon,
  iconColor,
  mobileActions,
  children,
}) => {
  return (
    <div className="min-h-screen flex flex-col bg-black">
      <MobileHeader title={title}>
        {mobileActions}
      </MobileHeader>
      <div className="flex-1 w-full">
        <div className="max-w-6xl mx-auto pt-24 sm:pt-8 pb-12">
          <PageHeader
            title={title}
            subtitle={subtitle}
            icon={icon}
            iconColor={iconColor}
          />
          <div className="px-4 sm:px-6 lg:px-8 space-y-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

interface SettingsSectionCardProps {
  title: string;
  description?: string;
  icon: React.ReactNode;
  className?: string;
}

export const SettingsSectionCard: React.FC<
  React.PropsWithChildren<SettingsSectionCardProps>
> = ({ title, description, icon, className = '', children }) => {
  return (
    <section
      className={`group bg-gray-950/60 border border-gray-900/70 rounded-2xl p-6 shadow-xl shadow-black/40 transition-all duration-300 hover:border-gray-800 hover:shadow-2xl ${className}`}
    >
      <header className="flex items-center space-x-3 mb-4">
        <div className="w-11 h-11 rounded-2xl bg-white/5 flex items-center justify-center text-slate-200">
          {icon}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {description && <p className="text-sm text-gray-400">{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
};

