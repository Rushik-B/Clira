'use client';

import React from 'react';
import { AccountPrivacyPage } from './settings/AccountPrivacyPage';
import { AssistantRepliesPage } from './settings/AssistantRepliesPage';
import { FoldersLabelsPage } from './settings/FoldersLabelsPage';
import { MailboxConnectionsPage } from './settings/MailboxConnectionsPage';
import { McpConnectionsPage } from './settings/McpConnectionsPage';
import { SkillsSettingsPage } from './settings/SkillsSettingsPage';
import { TextChannelsIntegrationPage } from './settings/TextChannelsIntegrationPage';
import type { TextChannelsSettingsSnapshot } from '@/lib/services/textChannelsSettings';

interface SettingsPageProps {
  activeSection?: 'account-privacy' | 'assistant-replies' | 'skills' | 'folders-labels' | 'text-channels' | 'inboxes' | 'mcp-connections';
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
    case 'skills':
      return <SkillsSettingsPage />;
    case 'folders-labels':
      return <FoldersLabelsPage />;
    case 'text-channels':
      return <TextChannelsIntegrationPage initialSettings={initialTextChannelsSettings} />;
    case 'inboxes':
      return <MailboxConnectionsPage />;
    case 'mcp-connections':
      return <McpConnectionsPage />;
    case 'account-privacy':
    default:
      return <AccountPrivacyPage />;
  }
};
