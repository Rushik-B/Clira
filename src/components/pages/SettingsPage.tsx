'use client';

import React from 'react';
import { AccountPrivacyPage } from './settings/AccountPrivacyPage';
import { AssistantRepliesPage } from './settings/AssistantRepliesPage';
import { FoldersLabelsPage } from './settings/FoldersLabelsPage';
import { MailboxConnectionsPage } from './settings/MailboxConnectionsPage';
import { WhatsAppIntegrationPage } from './settings/WhatsAppIntegrationPage';

interface SettingsPageProps {
  activeSection?: 'account-privacy' | 'assistant-replies' | 'folders-labels' | 'whatsapp-integration' | 'inboxes';
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ activeSection = 'account-privacy' }) => {
  // Route to the appropriate settings page based on activeSection
  switch (activeSection) {
    case 'assistant-replies':
      return <AssistantRepliesPage />;
    case 'folders-labels':
      return <FoldersLabelsPage />;
    case 'whatsapp-integration':
      return <WhatsAppIntegrationPage />;
    case 'inboxes':
      return <MailboxConnectionsPage />;
    case 'account-privacy':
    default:
      return <AccountPrivacyPage />;
  }
};
