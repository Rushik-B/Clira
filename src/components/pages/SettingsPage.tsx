'use client';

import React from 'react';
import { AccountPrivacyPage } from './settings/AccountPrivacyPage';
import { AssistantRepliesPage } from './settings/AssistantRepliesPage';
import { FoldersLabelsPage } from './settings/FoldersLabelsPage';
import { MailboxConnectionsPage } from './settings/MailboxConnectionsPage';
import { TextChannelsIntegrationPage } from './settings/TextChannelsIntegrationPage';
import type { TextChannelsSettingsSnapshot } from '@/lib/services/textChannelsSettings';

interface SettingsPageProps {
  activeSection?: 'account-privacy' | 'assistant-replies' | 'folders-labels' | 'text-channels' | 'inboxes';
  initialTextChannelsSettings?: TextChannelsSettingsSnapshot | null;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  activeSection = 'account-privacy',
  initialTextChannelsSettings = null,
}) => {
  // Route to the appropriate settings page based on activeSection
  switch (activeSection) {
    case 'assistant-replies':
      return <AssistantRepliesPage />;
    case 'folders-labels':
      return <FoldersLabelsPage />;
    case 'text-channels':
      return <TextChannelsIntegrationPage initialSettings={initialTextChannelsSettings} />;
    case 'inboxes':
      return <MailboxConnectionsPage />;
    case 'account-privacy':
    default:
      return <AccountPrivacyPage />;
  }
};
