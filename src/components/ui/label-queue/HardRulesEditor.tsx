'use client';

import React, { useState } from 'react';
import { Plus, Target, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { PrimaryButton } from '@/components/ui/buttons';
import { AddRuleModal } from '@/components/ui/folder-management/AddRuleModal';

// Helper functions for displaying rules (consistent with FolderManagementCard)
function getConditionReadable(condition: string): string {
  switch (condition) {
    case 'sender': return 'sender email';
    case 'domain': return 'sender domain';
    case 'subject': return 'subject';
    case 'subject_contains': return 'subject contains';
    case 'subject_starts_with': return 'subject starts with';
    case 'subject_ends_with': return 'subject ends with';
    case 'subject_regex': return 'subject matches regex';
    default: return 'sender email';
  }
}

function getConditionOperator(condition: string): string {
  switch (condition) {
    case 'sender': return 'is';
    case 'domain': return 'is';
    case 'subject': return 'is';
    case 'subject_contains': return 'contains';
    case 'subject_starts_with': return 'starts with';
    case 'subject_ends_with': return 'ends with';
    case 'subject_regex': return 'matches';
    default: return 'is';
  }
}

interface HardRule {
  id: string;
  condition: string;
  value: string;
  action: string;
  targetFolderId?: string;
}

interface HardRulesEditorProps {
  /** The folder ID for API calls */
  folderId: string;
  /** The folder name for display purposes */
  folderName: string;
  /** Array of current rules */
  rules: HardRule[];
  /** Whether rules are currently loading */
  isLoading: boolean;
  /** Whether the rules section is expanded */
  isExpanded: boolean;
  /** Callback when expansion state changes */
  onToggleExpanded: () => void;
  /** Callback when a new rule is added */
  onRuleAdd: (rule: HardRule) => void;
  /** Callback when a rule is deleted */
  onRuleDelete: (ruleId: string) => Promise<void>;
  /** Whether a delete operation is in progress */
  isDeletingRule?: boolean;
}

export const HardRulesEditor: React.FC<HardRulesEditorProps> = ({
  folderId,
  folderName,
  rules,
  isLoading,
  isExpanded,
  onToggleExpanded,
  onRuleAdd,
  onRuleDelete,
  isDeletingRule = false
}) => {
  const [showAddRule, setShowAddRule] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const handleDeleteRule = async (ruleId: string) => {
    try {
      setDeletingRuleId(ruleId);
      await onRuleDelete(ruleId);
    } catch (error) {
      console.error('Failed to delete rule:', error);
      // Error handling could be enhanced with toast notifications
    } finally {
      setDeletingRuleId(null);
    }
  };

  const handleAddRule = (newRule: HardRule) => {
    onRuleAdd(newRule);
    setShowAddRule(false);
  };

  return (
    <div className="relative group/rules">
      {/* Enhanced ambient glow for rules section */}
      <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/15 via-indigo-400/20 to-purple-500/15 rounded-xl blur-xl transition-all duration-500 opacity-60 group-hover/rules:opacity-100"></div>
      <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 via-purple-400/15 to-purple-500/10 rounded-xl blur-lg transition-all duration-500 opacity-80 group-hover/rules:opacity-100"></div>
      
      <div className="relative p-4 md:p-5 bg-purple-950/20 border-2 border-purple-800/60 rounded-xl backdrop-blur-sm transition-all duration-300 group-hover/rules:border-purple-700/80 group-hover/rules:bg-purple-950/30 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <Target className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-semibold text-purple-100 group-hover/rules:text-purple-300 transition-colors duration-300">Smart Rules</h3>
            <span className="text-xs text-purple-300 bg-purple-900/40 px-2 py-1 rounded border border-purple-800/50 font-medium">Auto-sort emails</span>
            {rules.length > 0 && (
              <span className="text-xs text-purple-200/80 bg-purple-900/30 px-2 py-1 rounded border border-purple-800/40 font-medium">
                {rules.length} rule{rules.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          
          {/* Mobile-first responsive button layout like EmailQueueCard */}
          <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:items-center sm:space-x-2 w-full sm:w-auto">
            <PrimaryButton 
              onClick={() => setShowAddRule(true)}
              minWidth="sm"
              aria-label="Add new rule"
              className="w-full sm:w-auto h-8 sm:h-10 px-3 sm:px-4 rounded-xl sm:rounded-2xl text-xs sm:text-sm min-w-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Rule</span>
              <span className="sm:hidden">Add</span>
            </PrimaryButton>
            
            {/* Collapse/Expand button */}
            {rules.length > 0 && (
              <button
                onClick={onToggleExpanded}
                className="w-full sm:w-auto h-8 sm:h-10 px-3 sm:px-4 bg-purple-800/40 border border-purple-700/50 hover:bg-purple-700/60 hover:border-purple-600/60 text-purple-300 rounded-xl sm:rounded-2xl transition-all duration-300 justify-center flex items-center text-xs sm:text-sm"
                aria-label={isExpanded ? 'Collapse rules' : 'Expand rules'}
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span className="ml-2 sm:hidden">{isExpanded ? 'Collapse' : 'Expand'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Loading state */}
        {isLoading ? (
          <div className="text-center py-6">
            <div className="flex items-center justify-center gap-2 text-purple-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm font-medium">Loading rules…</span>
            </div>
          </div>
        ) : rules.length > 0 ? (
          <div className="space-y-3">
            {/* Rules count indicator */}
            <div className="flex items-center space-x-2 mb-2">
              <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-purple-300 font-medium">{rules.length} active rule{rules.length !== 1 ? 's' : ''} sorting emails automatically</span>
            </div>
            
            {/* Rules list - show first rule always, rest based on isExpanded */}
            {rules.slice(0, isExpanded ? rules.length : 1).map((rule, index) => (
              <div key={rule.id} className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 via-indigo-400/15 to-purple-500/10 rounded-lg blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
                {/* Mobile-first: content fills width, delete icon moves to top-right */}
                <div className="relative p-4 bg-purple-950/30 border border-purple-800/50 rounded-lg group-hover:border-purple-700/60 group-hover:bg-purple-950/40 transition-all duration-300 overflow-hidden">
                  {/* Delete in top-right on mobile */}
                  <div className="absolute right-2 top-2 flex sm:hidden">
                    <button 
                      onClick={() => handleDeleteRule(rule.id)}
                      disabled={deletingRuleId === rule.id}
                      className="p-2 rounded-md border border-red-800/50 text-red-300 hover:bg-red-900/30 hover:border-red-700/60 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={`Delete rule ${rule.value}`}
                    >
                      {deletingRuleId === rule.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-2 pr-10 sm:pr-0">
                        <span className="inline-flex items-center px-2 py-1 bg-purple-900/40 text-purple-200 text-xs font-medium rounded border border-purple-800/50 flex-shrink-0">
                          <Target className="w-3 h-3 mr-1" />
                          IF
                        </span>
                        <span className="text-sm text-purple-100 font-medium flex-shrink-0">
                          {getConditionReadable(rule.condition)} {getConditionOperator(rule.condition)}
                        </span>
                        <code className="px-2 py-1 bg-gray-900/60 text-blue-300 text-xs font-mono rounded border border-gray-700/50 truncate max-w-full sm:max-w-[200px]">
                          {rule.value}
                        </code>
                      </div>
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="text-xs text-purple-300">→</span>
                        <span className="text-xs text-purple-200 font-medium">Auto-move to</span>
                        <span className="px-2 py-0.5 bg-purple-900/30 text-purple-200 text-xs font-medium rounded border border-purple-800/40 truncate max-w-full sm:max-w-[200px]">
                          {folderName}
                        </span>
                      </div>
                    </div>

                    {/* Delete button on desktop/wide */}
                    <div className="hidden sm:flex sm:flex-shrink-0">
                      <button 
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={deletingRuleId === rule.id}
                        className="p-2 rounded-lg border border-red-800/50 text-red-300 hover:bg-red-900/30 hover:border-red-700/60 transition-all duration-300 group/delete disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Delete rule ${rule.value}`}
                      >
                        {deletingRuleId === rule.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4 group-hover/delete:scale-110 transition-transform duration-200" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Show more indicator */}
            {!isExpanded && rules.length > 1 && (
              <div className="text-center">
                <button
                  onClick={onToggleExpanded}
                  className="text-xs text-purple-300/80 hover:text-purple-200 font-medium transition-colors duration-200 flex items-center justify-center space-x-1 mx-auto"
                >
                  <span>Show {rules.length - 1} more rule{rules.length - 1 !== 1 ? 's' : ''}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Empty state */
          <div className="text-center py-6">
            <Target className="w-8 h-8 text-purple-400/60 mx-auto mb-2" />
            <p className="text-sm text-purple-200/80 font-medium mb-1">No automatic rules yet</p>
            <p className="text-xs text-purple-300/60">Create rules to automatically sort matching emails to this folder</p>
          </div>
        )}
      </div>

      {/* Add Rule Modal */}
      {showAddRule && (
        <AddRuleModal
          folderId={folderId}
          folderName={folderName}
          onClose={() => setShowAddRule(false)}
          onAdd={handleAddRule}
        />
      )}
    </div>
  );
};