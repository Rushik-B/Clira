
'use client';

import React, { useState, useCallback } from 'react';
import { FolderData, isWellDescribed } from '@/components/ui/folder-management/types';
import { InlineMetaPromptEditor } from './InlineMetaPromptEditor';
import { HardRulesEditor } from './HardRulesEditor';
import { CheckCircle2, AlertCircle, Database, ListChecks, FileQuestion } from 'lucide-react';

interface LabelQueueHeaderProps {
  folder: FolderData | null;
  queueCount?: number;
  isLoading?: boolean;
  /** When true, only the rules section shows a loading spinner */
  rulesLoading?: boolean;
}

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string | number; iconBgColor: string; iconTextColor: string }> = ({ icon, label, value, iconBgColor, iconTextColor }) => (
  <div className="relative group">
    <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-white/5 via-transparent to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur" />
    <div className="relative flex items-center gap-3 rounded-xl border border-gray-800/60 bg-black/60 px-4 py-3 shadow-inner">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBgColor} ${iconTextColor} ring-1 ring-inset ring-white/10`}>
        {icon}
      </div>
      <div className="leading-tight">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-semibold text-white tabular-nums">{value}</p>
      </div>
    </div>
  </div>
);

export const LabelQueueHeader: React.FC<LabelQueueHeaderProps> = ({
  folder,
  queueCount = 0,
  isLoading = false,
  rulesLoading = false
}) => {
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [isRulesExpanded, setIsRulesExpanded] = useState(false);
  const [localFolder, setLocalFolder] = useState<FolderData | null>(folder);
  
  React.useEffect(() => {
    setLocalFolder(folder);
  }, [folder]);

  const handleSaveMetaPrompt = useCallback(async (newMetaPrompt: string) => {
    if (!localFolder) return;
    
    try {
      setIsSavingMeta(true);
      setMetaError(null);
      
      const response = await fetch(`/api/folders/${localFolder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaPrompt: newMetaPrompt
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save folder instructions');
      }
      
      const updatedFolder = {
        ...localFolder,
        instruction: data.folder.metaPrompt,
        description: data.folder.metaPrompt
      };
      setLocalFolder(updatedFolder);
      setIsEditingMeta(false);
      
    } catch (error) {
      console.error('Error saving folder instruction:', error);
      setMetaError(error instanceof Error ? error.message : 'Failed to save folder instructions');
    } finally {
      setIsSavingMeta(false);
    }
  }, [localFolder]);
  
  const handleRuleAdd = useCallback((newRule: any) => {
    if (!localFolder) return;
    
    const updatedFolder = {
      ...localFolder,
      hardRules: [...(localFolder.hardRules || []), newRule]
    };
    setLocalFolder(updatedFolder);
  }, [localFolder]);
  
  const handleRuleDelete = useCallback(async (ruleId: string) => {
    if (!localFolder) return;
    
    try {
      const response = await fetch(`/api/folders/${localFolder.id}/rules?ruleId=${ruleId}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete rule');
      }
      
      const updatedFolder = {
        ...localFolder,
        hardRules: localFolder.hardRules?.filter(r => r.id !== ruleId) || []
      };
      setLocalFolder(updatedFolder);
      
    } catch (error) {
      console.error('Error deleting rule:', error);
      throw error;
    }
  }, [localFolder]);

  if (isLoading || !folder || !localFolder) {
    return (
      <div className="bg-gray-900/50 border border-gray-700/50 rounded-2xl p-6 backdrop-blur-sm">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-700 rounded-lg w-48 mb-6"></div>
          <div className="space-y-2 mb-6">
            <div className="h-4 bg-gray-700 rounded w-full"></div>
            <div className="h-4 bg-gray-700 rounded w-3/4"></div>
          </div>
          <div className="h-10 bg-gray-700 rounded-lg w-full mb-6"></div>
          <div className="flex space-x-8">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gray-700 rounded-lg"></div>
              <div className="space-y-1">
                <div className="h-3 bg-gray-700 rounded w-16"></div>
                <div className="h-4 bg-gray-700 rounded w-8"></div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gray-700 rounded-lg"></div>
              <div className="space-y-1">
                <div className="h-3 bg-gray-700 rounded w-16"></div>
                <div className="h-4 bg-gray-700 rounded w-8"></div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gray-700 rounded-lg"></div>
              <div className="space-y-1">
                <div className="h-3 bg-gray-700 rounded w-16"></div>
                <div className="h-4 bg-gray-700 rounded w-8"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const wellDescribed = isWellDescribed(localFolder);

  return (
    <div className="relative group">
      <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-blue-400/20 group-hover:via-blue-300/25 group-hover:to-blue-400/20"></div>
      <div className="relative bg-black/80 border-2 border-gray-800/50 rounded-2xl p-6 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-gray-700/60">
        <div className="flex flex-col space-y-6">
          {/* Folder Instructions */}
          <div>
            <div className="flex items-center space-x-3 mb-3">
              {wellDescribed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-400" />
              )}
              <h3 className="text-lg font-semibold text-white">Folder Instructions</h3>
              <span className={`px-2 py-1 text-xs font-medium rounded border ${
                wellDescribed
                  ? 'bg-emerald-900/30 text-emerald-300 border-emerald-800/40'
                  : 'bg-amber-900/30 text-amber-300 border-amber-800/40'
              }`}>
                {wellDescribed ? 'Smart Sorting Active' : 'Basic Sorting'}
              </span>
            </div>
            <InlineMetaPromptEditor
              metaPrompt={localFolder.instruction || localFolder.description || `Emails related to ${localFolder.name}`}
              folderName={localFolder.name}
              isEditing={isEditingMeta}
              isSaving={isSavingMeta}
              onEditStart={() => setIsEditingMeta(true)}
              onEditCancel={() => {
                setIsEditingMeta(false);
                setMetaError(null);
              }}
              onSave={handleSaveMetaPrompt}
              isWellDescribed={wellDescribed}
              error={metaError}
            />
          </div>

          {/* Hard Rules */}
          <HardRulesEditor
            folderId={localFolder.id}
            folderName={localFolder.name}
            rules={localFolder.hardRules || []}
            isLoading={rulesLoading}
            isExpanded={isRulesExpanded}
            onToggleExpanded={() => setIsRulesExpanded(!isRulesExpanded)}
            onRuleAdd={handleRuleAdd}
            onRuleDelete={handleRuleDelete}
          />

          {/* Stats row - Mobile optimized layout like EmailQueueCard */}
          <div className="border-t border-gray-700/50 pt-4">
            {/* Mobile: Single column stack, Desktop: 3 columns */}
            <div className="flex flex-col space-y-3 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-3">
              <StatCard
                icon={<FileQuestion className="h-5 w-5" />}
                label="In Queue"
                value={queueCount}
                iconBgColor="bg-blue-900/40"
                iconTextColor="text-blue-400"
              />
              <StatCard
                icon={<Database className="h-5 w-5" />}
                label="Total Emails"
                value={localFolder.emailCount}
                iconBgColor="bg-green-900/40"
                iconTextColor="text-green-400"
              />
              <StatCard
                icon={<ListChecks className="h-5 w-5" />}
                label="Hard Rules"
                value={localFolder.hardRules?.length || 0}
                iconBgColor="bg-purple-900/40"
                iconTextColor="text-purple-400"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
