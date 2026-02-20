'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Edit3,
  Check,
  Trash2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  SparklesIcon,
  Brain,
  Target,
  Loader2,
} from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { FolderData, isWellDescribed, getAccuracyLevel } from './types';
import { AddRuleModal } from './AddRuleModal';

// Helper functions for API mapping
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

interface FolderManagementCardProps {
  folder: FolderData;
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (folder: FolderData) => void;
  onRequestDelete: (folder: FolderData) => void;
  deleteInProgress?: boolean;
  editing: boolean;
  onEdit: (folderId: string) => void;
  onCancelEdit: () => void;
  rulesLoading: boolean;
  rulesPending: boolean;
}

export const FolderManagementCard: React.FC<FolderManagementCardProps> = ({ 
  folder, 
  expanded, 
  onToggleExpand, 
  onUpdate, 
  onRequestDelete,
  deleteInProgress,
  editing,
  onEdit,
  onCancelEdit,
  rulesLoading,
  rulesPending
}) => {
  const [editName, setEditName] = useState(folder.name);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editInstruction, setEditInstruction] = useState(folder.instruction);

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!editName.trim() || !editInstruction.trim()) {
      setActionError('Name and description cannot be empty');
      return;
    }

    try {
      setSaving(true);
      setActionError(null);
      
      const response = await fetch(`/api/folders/${folder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          metaPrompt: editInstruction.trim()
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save folder');
      }
      
      // Update local state with server response
      onUpdate({
        ...folder,
        name: data.folder.name,
        instruction: data.folder.metaPrompt,
        description: data.folder.metaPrompt
      });
      
      onCancelEdit();
      
    } catch (error) {
      console.error('Error saving folder:', error);
      setActionError(error instanceof Error ? error.message : 'Failed to save folder');
    } finally {
      setSaving(false);
    }
  }, [editInstruction, editName, folder, onCancelEdit, onUpdate]);

  // Keyboard shortcut handler for Cmd/Ctrl + Enter
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (editName.trim() && editInstruction.trim() && !saving) {
        handleSave();
      }
    }
  }, [editName, editInstruction, handleSave, saving]);

  // Add keyboard listener for global Cmd+Enter when editing
  useEffect(() => {
    if (!editing) return;
    
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (editName.trim() && editInstruction.trim() && !saving) {
          handleSave();
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [editing, editInstruction, editName, handleSave, saving]);

  const handleCancel = () => {
    setEditName(folder.name);
    setEditInstruction(folder.instruction);
    onCancelEdit();
  };

  const isUnderDescribed = !isWellDescribed(folder);
  
  return (
    <div className="relative group transition-transform duration-300 will-change-transform">
      {/* Ambient glow effects inspired by QueuePage */}
      {isUnderDescribed ? (
        // Under-described folder: amber warning glow
        <div className="absolute -inset-2 rounded-3xl blur-2xl bg-gradient-radial from-amber-500/8 via-amber-600/4 to-transparent opacity-60 group-hover:opacity-80 transition-all duration-500"></div>
      ) : (
        // Well-described folder: blue success glow  
        <div className="absolute -inset-2 rounded-3xl blur-2xl bg-gradient-radial from-blue-500/8 via-blue-600/4 to-transparent opacity-40 group-hover:opacity-60 transition-all duration-500"></div>
      )}
      <div className="absolute -inset-1 bg-gradient-to-r rounded-2xl blur-lg transition-all duration-500 opacity-60 group-hover:opacity-100" style={{
        background: isUnderDescribed 
          ? 'linear-gradient(to right, rgba(245, 158, 11, 0.1), rgba(251, 191, 36, 0.15), rgba(245, 158, 11, 0.1))'
          : 'linear-gradient(to right, rgba(59, 130, 246, 0.1), rgba(96, 165, 250, 0.15), rgba(59, 130, 246, 0.1))'
      }}></div>
      
      <div className={`relative rounded-3xl border backdrop-blur-md shadow-2xl transition-all duration-300 cursor-pointer w-full max-w-full ${
        isUnderDescribed
          ? 'border-amber-800/60 bg-black/80 group-hover:border-amber-700/80'
          : 'border-gray-800/50 bg-black/80 group-hover:border-gray-700/60'
      }`}>
        <GlowingEffect
          blur={0}
          borderWidth={2}
          spread={60}
          glow={true}
          disabled={false}
          proximity={120}
          inactiveZone={0.01}
          movementDuration={0.3}
        />
        <div className={`relative border-2 rounded-2xl px-3.5 py-3 sm:px-5 sm:py-4 backdrop-blur-sm shadow-inner transition-all duration-300 ${
          isUnderDescribed
            ? 'bg-black/70 border-amber-800/70 group-hover:bg-black/80 group-hover:border-amber-700/80'
            : 'bg-black/70 border-gray-800/70 group-hover:bg-black/80 group-hover:border-gray-700/80'
        }`}>

          {/* Collapsed State */}
          {!expanded && (
            <div
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between cursor-pointer rounded-xl transition-all duration-300 group/card"
              onClick={onToggleExpand}
            >
              <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                <div className="mt-1 text-lg sm:text-xl group-hover/card:scale-110 transition-transform duration-300 flex-shrink-0">{folder.icon}</div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
                    <span
                      className="inline-flex h-3 w-3 rounded-full transition-all duration-300 group-hover/card:h-3.5 group-hover/card:w-3.5 group-hover/card:shadow-lg flex-shrink-0"
                      style={{ backgroundColor: folder.color, boxShadow: `0 0 8px ${folder.color}40` }}
                    />
                    <h3 className="text-sm sm:text-base font-semibold text-white group-hover/card:text-blue-400 transition-colors duration-300 truncate">
                      {folder.name}
                    </h3>
                    {!isWellDescribed(folder) && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-800/50 bg-amber-900/25 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 transition-colors duration-300 group-hover/card:border-amber-700/60 group-hover/card:bg-amber-900/35">
                        <AlertCircle className="h-3 w-3" />
                        <span className="hidden sm:inline">Needs description</span>
                        <span className="sm:hidden">Improve</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm text-gray-300 line-clamp-2 font-medium leading-snug group-hover/card:text-gray-200 transition-colors duration-300">
                    {folder.instruction}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-700/50 bg-gray-800/60 px-1.5 py-0.5 font-medium text-gray-200 transition-colors duration-300 group-hover/card:border-gray-600/60 group-hover/card:bg-gray-700/70">
                      {folder.emailCount} emails
                    </span>
                    {folder.hardRules && folder.hardRules.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-blue-800/50 bg-blue-900/30 px-1.5 py-0.5 font-medium text-blue-200 transition-colors duration-300 group-hover/card:border-blue-700/60 group-hover/card:bg-blue-900/45">
                        <Target className="h-3 w-3 flex-shrink-0" />
                        {folder.hardRules.length} rule{folder.hardRules.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {!isWellDescribed(folder) && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-800/40 bg-amber-900/20 px-1.5 py-0.5 font-medium text-amber-300">
                        Basic sorting
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 self-end sm:self-center">
                {isUnderDescribed && (
                  <PrimaryButton
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!expanded) {
                        onToggleExpand();
                      }
                      onEdit(folder.id);
                    }}
                    minWidth="sm"
                    aria-label="Add description to improve sorting accuracy"
                    className="!h-8 rounded-full !px-2.5 sm:!px-3 !text-[13px] !bg-[hsl(var(--sidebar-primary))] !text-[hsl(var(--sidebar-primary-foreground))] hover:!bg-[hsl(var(--sidebar-primary))] hover:brightness-110 active:brightness-95 focus-visible:ring-[hsl(var(--sidebar-primary)/0.35)]"
                  >
                    <SparklesIcon className="h-3 w-3" />
                    <span className="hidden sm:inline">Upgrade</span>
                  </PrimaryButton>
                )}
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300 ${
                    isUnderDescribed
                      ? 'border-amber-700/50 bg-amber-800/35 group-hover/card:border-amber-600/60 group-hover/card:bg-amber-700/45'
                      : 'border-gray-700/50 bg-gray-800/40 group-hover/card:border-gray-600/60 group-hover/card:bg-gray-700/55'
                  }`}
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-colors duration-300 ${
                      isUnderDescribed
                        ? 'text-amber-300 group-hover/card:text-amber-200'
                        : 'text-gray-300 group-hover/card:text-blue-300'
                    }`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Expanded State */}
          {expanded && (
            <div className="space-y-4 md:space-y-6 overflow-hidden max-w-full">
              {/* Header */}
              <div className="flex flex-col space-y-3 md:space-y-4 lg:flex-row lg:space-y-0 lg:items-center lg:justify-between">
                <div className="flex items-center space-x-2 md:space-x-4 min-w-0 flex-1">
                  <div className="text-lg md:text-2xl flex-shrink-0">{folder.icon}</div>
                  <div className="flex-1 min-w-0">
                    {editing ? (
                      <div className="space-y-4">
                        <div className="space-y-2 md:space-y-3">
                          <label className="block text-xs font-semibold text-gray-300 mb-1.5 md:mb-2">Folder Name</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full max-w-full text-sm md:text-base font-semibold text-white bg-gray-900/60 border-2 border-gray-700/50 rounded-xl px-2.5 md:px-3 py-1.5 md:py-2 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
                            placeholder="e.g., Financials, Newsletters"
                            aria-label="Folder name"
                          />
                        </div>
                        
                        {/* Error message */}
                        {actionError && (
                          <div className="mt-1.5 md:mt-2 p-1.5 md:p-2 bg-red-900/20 border border-red-800/40 rounded-lg">
                            <p className="text-xs text-red-300 font-medium">{actionError}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <h3 className="text-base md:text-lg font-bold text-white">{folder.name}</h3>
                        <p className="text-sm text-gray-300 font-medium">{folder.instruction}</p>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-col space-y-1.5 md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-2 flex-shrink-0">
                  {editing ? (
                    <>
                      <PrimaryButton
                        onClick={handleSave}
                        disabled={saving}
                        minWidth="sm"
                        aria-label="Save folder changes"
                        keyboardShortcut="⌘↵"
                      >
                        {saving ? (
                          <>
                            <div className="w-3.5 md:w-4 h-3.5 md:h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            <span className="hidden sm:inline">Saving...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 md:w-4 h-3.5 md:h-4" />
                            <span className="hidden sm:inline">Save</span>
                          </>
                        )}
                      </PrimaryButton>
                      <LiquidButton
                        onClick={handleCancel}
                        disabled={saving}
                        minWidth="sm"
                        responsive
                        variant="default"
                        size="lg"
                        aria-label="Cancel editing"
                        className={LIQUID_BUTTON_BASE_CLASS}
                        type="button"
                      >
                        <span className="flex items-center gap-2">
                          <X className="w-3.5 md:w-4 h-3.5 md:h-4" />
                          <span className="hidden sm:inline">Cancel</span>
                        </span>
                      </LiquidButton>
                    </>
                  ) : (
                    <>
                      <PrimaryButton
                        onClick={() => onEdit(folder.id)}
                        minWidth="sm"
                        aria-label="Edit folder"
                        className="!bg-[hsl(var(--sidebar-primary))] !text-[hsl(var(--sidebar-primary-foreground))] hover:!bg-[hsl(var(--sidebar-primary))] hover:brightness-110 active:brightness-95 focus-visible:ring-[hsl(var(--sidebar-primary)/0.35)]"
                      >
                        <Edit3 className="w-3.5 md:w-4 h-3.5 md:h-4" />
                        <span className="hidden sm:inline">Edit</span>
                      </PrimaryButton>
                      {!folder.isSystemDefault && (
                        <PrimaryButton
                          onClick={() => onRequestDelete(folder)}
                          minWidth="sm"
                          aria-label={`Delete folder ${folder.name}`}
                          disabled={Boolean(deleteInProgress)}
                          className="!bg-red-700 hover:!bg-red-600 active:!bg-red-800 !text-white !ring-1 !ring-red-400/30"
                        >
                          {deleteInProgress ? (
                            <Loader2 className="w-3.5 md:w-4 h-3.5 md:h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 md:w-4 h-3.5 md:h-4" />
                          )}
                        </PrimaryButton>
                      )}
                      <LiquidButton
                        onClick={onToggleExpand}
                        minWidth="none"
                        size="icon"
                        variant="default"
                        aria-label="Collapse"
                        className="h-10 w-10 rounded-full text-sky-100"
                        type="button"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </LiquidButton>
                    </>
                  )}
                </div>
              </div>

              {!editing && actionError && (
                <div className="mt-2.5 md:mt-3 p-2.5 md:p-3 bg-red-900/20 border border-red-800/40 rounded-lg">
                  <p className="text-xs md:text-sm text-red-300 font-medium flex items-center gap-1.5">
                    <AlertCircle className="w-3 md:w-3.5 h-3 md:h-3.5" />
                    <span>{actionError}</span>
                  </p>
                </div>
              )}

              {/* Instruction Editing */}
              {editing && (
                <div className="relative">
                  {/* Editing ambient glow effect */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-cyan-400/15 to-blue-500/10 rounded-xl blur-lg transition-all duration-500 opacity-80"></div>
                  <div className="relative p-3 md:p-6 bg-gray-950/60 border-2 border-gray-700/80 rounded-xl backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-3 md:mb-4">
                      <div className="flex items-center space-x-2">
                        <Brain className="w-3.5 md:w-4 h-3.5 md:h-4 text-blue-400" />
                        <label className="block text-xs md:text-sm font-semibold text-blue-100">Folder Description</label>
                      </div>
                      <span className="text-[10px] md:text-[11px] text-blue-300 bg-blue-900/30 px-1.5 md:px-2 py-0.5 md:py-1 rounded border border-blue-800/40 font-medium">Smart sorting</span>
                    </div>
                    
                    {/* Helpful guidance for writing good descriptions */}
                    <div className="mb-3 md:mb-4 p-2.5 md:p-3 bg-blue-900/20 border border-blue-800/40 rounded-lg">
                      <h5 className="text-[11px] md:text-xs font-semibold text-blue-200 mb-1.5 md:mb-2 flex items-center space-x-1">
                        <Target className="w-2.5 md:w-3 h-2.5 md:h-3" />
                        <span>Tips for better email sorting:</span>
                      </h5>
                      <ul className="text-[10px] md:text-[11px] text-blue-200/90 space-y-0.5 md:space-y-1 ml-3 md:ml-4">
                        <li>• Be specific about email types (newsletters, receipts, work emails)</li>
                        <li>• Mention sender patterns (company domains, keywords)</li>
                        <li>• Include subject line patterns or keywords</li>
                        <li>• Describe the email purpose or content type</li>
                      </ul>
                    </div>
                    
                    <textarea
                      value={editInstruction}
                      onChange={(e) => setEditInstruction(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="w-full max-w-full bg-gray-900/80 border-2 border-gray-700/60 rounded-xl p-3 md:p-4 text-sm md:text-base text-white placeholder-gray-400 resize-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all font-medium break-words"
                      rows={4}
                      placeholder={`Example: Emails related to ${folder.name} including newsletters, promotional content, marketing emails from retail companies, subscription services, and email campaigns. Look for unsubscribe links, promotional language, and bulk sender patterns.`}
                      aria-label="Folder instruction"
                    />
                    
                    <div className="mt-2.5 md:mt-3 flex items-start space-x-1.5 md:space-x-2">
                      <SparklesIcon className="w-3.5 md:w-4 h-3.5 md:h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[11px] md:text-xs text-blue-200 font-medium mb-0.5 md:mb-1">This description helps Clira understand what emails belong in this folder.</p>
                        <p className="text-[10px] md:text-[11px] text-blue-300/80">The more specific and detailed you are, the more accurate the sorting will be.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Current Instruction */}
              {!editing && (
                <div className="relative group/instruction">
                  {!isWellDescribed(folder) ? (
                    // Under-described folder warning
                    <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/10 via-amber-400/15 to-amber-500/10 rounded-xl blur-lg transition-all duration-500 opacity-60 group-hover/instruction:opacity-100"></div>
                  ) : (
                    // Well-described folder normal styling
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-xl blur-lg transition-all duration-500 opacity-0 group-hover/instruction:opacity-100"></div>
                  )}
                  <div className={`relative p-3 md:p-4 backdrop-blur-sm transition-all duration-300 rounded-xl ${
                    !isWellDescribed(folder) 
                      ? 'bg-amber-900/20 border-2 border-amber-800/60 group-hover/instruction:border-amber-700/80 group-hover/instruction:bg-amber-900/30'
                      : 'bg-gray-950/40 border-2 border-gray-800/60 group-hover/instruction:border-gray-700/80 group-hover/instruction:bg-gray-950/60'
                  }`}>
                    <div className="flex items-center justify-between mb-2 md:mb-3">
                      <div className="flex items-center space-x-2">
                        <h4 className={`text-xs md:text-sm font-semibold transition-colors duration-300 ${
                          !isWellDescribed(folder)
                            ? 'text-amber-200 group-hover/instruction:text-amber-100'
                            : 'text-gray-100 group-hover/instruction:text-blue-400'
                        }`}>Current description</h4>
                        {!isWellDescribed(folder) && (
                          <AlertCircle className="w-3.5 md:w-4 h-3.5 md:h-4 text-amber-400" />
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-[10px] md:text-[11px] px-1.5 md:px-2 py-0.5 rounded-lg border font-medium transition-all duration-300 ${
                          !isWellDescribed(folder)
                            ? 'text-amber-300 bg-amber-900/30 border-amber-800/40 group-hover/instruction:bg-amber-900/40 group-hover/instruction:border-amber-700/60'
                            : 'text-blue-300 bg-blue-900/30 border-blue-800/40 group-hover/instruction:bg-blue-900/40 group-hover/instruction:border-blue-700/60'
                        }`}>
                          {isWellDescribed(folder) ? 'Smart sorting' : 'Basic sorting'}
                        </span>
                        <span className={`text-[9px] md:text-[10px] px-1 md:px-1.5 py-0.5 rounded font-medium border ${
                          isWellDescribed(folder)
                            ? 'text-emerald-300 bg-emerald-900/30 border-emerald-800/40'
                            : 'text-amber-300 bg-amber-900/30 border-amber-800/40'
                        }`}>
                          Sorting: {getAccuracyLevel(folder)}
                        </span>
                      </div>
                    </div>
                    
                    {/* Warning message for under-described folders */}
                    {!isWellDescribed(folder) && (
                      <div className="mb-2.5 md:mb-3 p-2.5 md:p-3 bg-amber-900/20 border border-amber-800/40 rounded-lg">
                        <p className="text-[11px] md:text-xs text-amber-200 font-medium flex items-center space-x-1.5 md:space-x-2">
                          <AlertCircle className="w-2.5 md:w-3 h-2.5 md:h-3 flex-shrink-0" />
                          <span>This folder uses basic sorting. Add a detailed description for better accuracy.</span>
                        </p>
                      </div>
                    )}
                    
                    <p className={`text-xs md:text-sm leading-relaxed whitespace-pre-line font-medium transition-colors duration-300 break-words overflow-wrap-anywhere ${
                      !isWellDescribed(folder)
                        ? 'text-amber-100 group-hover/instruction:text-amber-50'
                        : 'text-gray-100 group-hover/instruction:text-gray-50'
                    }`}>
                      {folder.instruction}
                    </p>
                    
                    {/* Add Description call-to-action for under-described folders */}
                    {!isWellDescribed(folder) && (
                      <div className="mt-2.5 md:mt-3 pt-2.5 md:pt-3 border-t border-amber-800/30">
                        <PrimaryButton
                          onClick={() => onEdit(folder.id)}
                          minWidth="sm"
                          className="!bg-[hsl(var(--sidebar-primary))] !text-[hsl(var(--sidebar-primary-foreground))] hover:!bg-[hsl(var(--sidebar-primary))] hover:brightness-110 active:brightness-95 focus-visible:ring-[hsl(var(--sidebar-primary)/0.35)]"
                        >
                          <SparklesIcon className="w-3.5 md:w-4 h-3.5 md:h-4" />
                          Add Description
                        </PrimaryButton>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sample Emails */}
              {folder.examples && folder.examples.length > 0 && (
                <div className="relative group/samples">
                  <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/10 via-emerald-400/15 to-emerald-500/10 rounded-xl blur-lg transition-all duration-500 opacity-0 group-hover/samples:opacity-100"></div>
                  <div className="relative p-3 md:p-4 bg-gray-950/30 border-2 border-gray-800/60 rounded-xl backdrop-blur-sm transition-all duration-300 group-hover/samples:border-gray-700/80 group-hover/samples:bg-gray-950/50">
                    <h4 className="text-xs md:text-sm font-semibold text-gray-100 mb-2.5 md:mb-3 group-hover/samples:text-emerald-400 transition-colors duration-300">Sample emails:</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 md:gap-3">
                      {folder.examples.slice(0, 3).map((example, idx) => (
                        <div key={idx} className="bg-gray-900/60 rounded-lg p-2.5 md:p-3 border border-gray-700/50 transition-all duration-300 hover:bg-gray-900/80 hover:border-gray-600/60 group/example">
                          <div className="text-[10px] md:text-xs text-blue-300 mb-0.5 md:mb-1 truncate font-medium group-hover/example:text-blue-200 transition-colors duration-300">{example.from}</div>
                          <div className="text-xs md:text-sm text-white mb-0.5 md:mb-1 line-clamp-1 font-medium group-hover/example:text-gray-100 transition-colors duration-300">{example.subject}</div>
                          <div className="text-[10px] md:text-xs text-gray-200 line-clamp-1 md:line-clamp-2 font-medium group-hover/example:text-gray-100 transition-colors duration-300">{example.snippet}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Hard Rules - Enhanced visibility */}
              <div className="relative group/rules">
                {/* Enhanced ambient glow for rules section */}
                <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/15 via-indigo-400/20 to-purple-500/15 rounded-xl blur-xl transition-all duration-500 opacity-60 group-hover/rules:opacity-100"></div>
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 via-purple-400/15 to-purple-500/10 rounded-xl blur-lg transition-all duration-500 opacity-80 group-hover/rules:opacity-100"></div>
                <div className="relative p-3 md:p-5 bg-purple-950/20 border-2 border-purple-800/60 rounded-xl backdrop-blur-sm transition-all duration-300 group-hover/rules:border-purple-700/80 group-hover/rules:bg-purple-950/30 shadow-lg">
                  <div className="flex flex-col space-y-2.5 md:space-y-3 lg:flex-row lg:space-y-0 lg:items-center lg:justify-between mb-3 md:mb-4">
                    <div className="flex items-center space-x-2">
                      <Target className="w-3.5 md:w-4 h-3.5 md:h-4 text-purple-400" />
                      <h4 className="text-sm md:text-base font-semibold text-purple-100 group-hover/rules:text-purple-300 transition-colors duration-300">Smart Rules</h4>
                      <span className="text-[10px] md:text-xs text-purple-300 bg-purple-900/40 px-1.5 md:px-2 py-0.5 md:py-1 rounded border border-purple-800/50 font-medium">Auto-sort emails</span>
                    </div>
                    <PrimaryButton 
                      onClick={() => setShowAddRule(true)}
                      minWidth="sm"
                    >
                      <Plus className="w-3.5 md:w-4 h-3.5 md:h-4" />
                      <span className="hidden sm:inline">Add Rule</span>
                      <span className="sm:hidden">Add</span>
                    </PrimaryButton>
                  </div>
                  {rulesPending ? (
                    <div className="text-center py-4 md:py-6">
                      <div className="flex items-center justify-center gap-1.5 md:gap-2 text-purple-300">
                        <Loader2 className="w-3.5 md:w-4 h-3.5 md:h-4 animate-spin" />
                        <span className="text-xs md:text-sm font-medium">Loading rules…</span>
                      </div>
                    </div>
                  ) : folder.hardRules && folder.hardRules.length > 0 ? (
                    <div className="space-y-2.5 md:space-y-3">
                      <div className="flex items-center space-x-1.5 md:space-x-2 mb-1.5 md:mb-2">
                        <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                        <span className="text-[10px] md:text-xs text-purple-300 font-medium">{folder.hardRules.length} active rule{folder.hardRules.length !== 1 ? 's' : ''} sorting emails automatically</span>
                      </div>
                      {folder.hardRules.map((rule) => (
                        <div key={rule.id} className="relative group">
                          <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 via-indigo-400/15 to-purple-500/10 rounded-lg blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
                          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between p-3 md:p-4 bg-purple-950/30 border border-purple-800/50 rounded-lg group-hover:border-purple-700/60 group-hover:bg-purple-950/40 transition-all duration-300 overflow-hidden">
                            <div className="flex-1 mb-2.5 md:mb-3 lg:mb-0 min-w-0">
                              <div className="flex flex-wrap items-center gap-1 md:gap-1.5 mb-1.5 md:mb-2">
                                <span className="inline-flex items-center px-1.5 md:px-2 py-0.5 md:py-1 bg-purple-900/40 text-purple-200 text-[10px] md:text-xs font-medium rounded border border-purple-800/50 flex-shrink-0">
                                  <Target className="w-2.5 md:w-3 h-2.5 md:h-3 mr-0.5 md:mr-1" />
                                  IF
                                </span>
                                <span className="text-xs md:text-sm text-purple-100 font-medium flex-shrink-0">
                                  {getConditionReadable(rule.condition)} {getConditionOperator(rule.condition)}
                                </span>
                                <code className="px-1.5 md:px-2 py-0.5 md:py-1 bg-gray-900/60 text-blue-300 text-[10px] md:text-xs font-mono rounded border border-gray-700/50 max-w-[80px] md:max-w-[120px] lg:max-w-[150px] xl:max-w-[200px] truncate flex-shrink-1">
                                  {rule.value}
                                </code>
                              </div>
                              <div className="flex items-center space-x-1.5 md:space-x-2">
                                <span className="text-[10px] md:text-xs text-purple-300">→</span>
                                <span className="text-[10px] md:text-xs text-purple-200 font-medium">Auto-move to</span>
                                <span className="px-1.5 md:px-2 py-0.5 bg-purple-900/30 text-purple-200 text-[10px] md:text-xs font-medium rounded border border-purple-800/40 truncate max-w-[60px] md:max-w-[100px] lg:max-w-[120px] xl:max-w-none">
                                  {folder.name}
                                </span>
                              </div>
                            </div>
                            <button 
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/folders/${folder.id}/rules?ruleId=${rule.id}`, {
                                    method: 'DELETE'
                                  });
                                  const json = await res.json();
                                  if (!res.ok || !json.success) {
                                    throw new Error(json.error || 'Failed to delete rule');
                                  }
                                  const updatedFolder = {
                                    ...folder,
                                    hardRules: folder.hardRules.filter(r => r.id !== rule.id)
                                  };
                                  onUpdate(updatedFolder);
                                } catch (e) {
                                  console.error('Failed to delete rule', e);
                                }
                              }}
                              className="relative p-1.5 md:p-2 rounded-lg border border-red-800/50 text-red-300 hover:bg-red-900/30 hover:border-red-700/60 transition-all duration-300 group/delete flex-shrink-0"
                              aria-label={`Delete rule ${rule.value}`}
                            >
                              <X className="w-3.5 md:w-4 h-3.5 md:h-4 group-hover/delete:scale-110 transition-transform duration-200" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 md:py-6">
                      <Target className="w-6 md:w-8 h-6 md:h-8 text-purple-400/60 mx-auto mb-1.5 md:mb-2" />
                      <p className="text-xs md:text-sm text-purple-200/80 font-medium mb-0.5 md:mb-1">No automatic rules yet</p>
                      <p className="text-[10px] md:text-xs text-purple-300/60">Create rules to automatically sort matching emails to this folder</p>
                    </div>
                  )}
                  </div>
                </div>
            </div>
          )}

          {/* Add Rule Modal */}
          {showAddRule && (
            <AddRuleModal
              folderId={folder.id}
              folderName={folder.name}
              onClose={() => setShowAddRule(false)}
              onAdd={(newRule: any) => {
                const updatedFolder = {
                  ...folder,
                  hardRules: [...(folder.hardRules || []), newRule]
                };
                onUpdate(updatedFolder);
                setShowAddRule(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
