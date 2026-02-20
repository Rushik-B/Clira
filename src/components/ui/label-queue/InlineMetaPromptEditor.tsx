'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Edit3, Check, X, Brain, Target, SparklesIcon, Loader2 } from 'lucide-react';
import { PrimaryButton, LiquidButton } from '@/components/ui/buttons';

interface InlineMetaPromptEditorProps {
  /** The current meta prompt/instruction text */
  metaPrompt: string;
  /** The folder name for contextual placeholder text */
  folderName: string;
  /** Whether the editor is in edit mode */
  isEditing: boolean;
  /** Whether a save operation is in progress */
  isSaving: boolean;
  /** Callback when edit mode is toggled on */
  onEditStart: () => void;
  /** Callback when edit mode is cancelled */
  onEditCancel: () => void;
  /** Callback when save is triggered with new content */
  onSave: (newMetaPrompt: string) => Promise<void>;
  /** Whether this is a well-described folder (affects styling) */
  isWellDescribed?: boolean;
  /** Optional error message to display */
  error?: string | null;
}

export const InlineMetaPromptEditor: React.FC<InlineMetaPromptEditorProps> = ({
  metaPrompt,
  folderName,
  isEditing,
  isSaving,
  onEditStart,
  onEditCancel,
  onSave,
  isWellDescribed = true,
  error = null
}) => {
  const [editValue, setEditValue] = useState(metaPrompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!editValue.trim() || isSaving) return;
    try {
      await onSave(editValue.trim());
    } catch (error) {
      // Error handling is done by parent component
      console.error('Save failed:', error);
    }
  }, [editValue, isSaving, onSave]);

  const handleCancel = useCallback(() => {
    setEditValue(metaPrompt);
    onEditCancel();
  }, [metaPrompt, onEditCancel]);

  // Reset edit value when metaPrompt changes or edit mode starts
  useEffect(() => {
    if (isEditing) {
      setEditValue(metaPrompt);
    }
  }, [metaPrompt, isEditing]);

  // Auto-focus and resize textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Set cursor to end of text
      const length = editValue.length;
      textareaRef.current.setSelectionRange(length, length);
      // Auto-resize
      autoResize();
    }
  }, [autoResize, editValue, isEditing]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (editValue.trim() && !isSaving) {
        handleSave();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [editValue, handleCancel, handleSave, isSaving]);

  // Global keyboard handlers when editing
  useEffect(() => {
    if (!isEditing) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (editValue.trim() && !isSaving) {
          handleSave();
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [editValue, handleSave, isEditing, isSaving]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value);
    autoResize();
  };

  return (
    <div className="relative group/instruction">
      {/* Ambient glow effect */}
      {!isWellDescribed ? (
        // Under-described folder warning
        <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/10 via-amber-400/15 to-amber-500/10 rounded-xl blur-lg transition-all duration-500 opacity-60 group-hover/instruction:opacity-100"></div>
      ) : (
        // Well-described folder normal styling
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-xl blur-lg transition-all duration-500 opacity-0 group-hover/instruction:opacity-100"></div>
      )}
      
      <div className={`relative backdrop-blur-sm transition-all duration-300 rounded-xl ${
        !isWellDescribed 
          ? 'bg-amber-900/20 border-2 border-amber-800/60 group-hover/instruction:border-amber-700/80 group-hover/instruction:bg-amber-900/30'
          : 'bg-gray-950/40 border-2 border-gray-800/60 group-hover/instruction:border-gray-700/80 group-hover/instruction:bg-gray-950/60'
      } ${isEditing ? 'p-6' : 'p-4'}`}>
        
        {/* Header with title and edit button */}
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-400" />
            <h3 className={`text-sm font-semibold transition-colors duration-300 ${
              !isWellDescribed
                ? 'text-amber-200 group-hover/instruction:text-amber-100'
                : 'text-gray-100 group-hover/instruction:text-blue-400'
            }`}>
              Folder Instructions
            </h3>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Status badges */}
            <span className={`text-[11px] px-2 py-0.5 rounded-lg border font-medium transition-all duration-300 ${
              !isWellDescribed
                ? 'text-amber-300 bg-amber-900/30 border-amber-800/40 group-hover/instruction:bg-amber-900/40 group-hover/instruction:border-amber-700/60'
                : 'text-blue-300 bg-blue-900/30 border-blue-800/40 group-hover/instruction:bg-blue-900/40 group-hover/instruction:border-blue-700/60'
            }`}>
              {isWellDescribed ? 'Smart sorting' : 'Basic sorting'}
            </span>
            
            {!isEditing && (
              <PrimaryButton
                onClick={onEditStart}
                minWidth="sm"
                aria-label="Edit folder instructions"
                className="!bg-[hsl(var(--sidebar-primary))] !text-[hsl(var(--sidebar-primary-foreground))] hover:!bg-[hsl(var(--sidebar-primary))] hover:brightness-110 active:brightness-95 focus-visible:ring-[hsl(var(--sidebar-primary)/0.35)] h-8 sm:h-10 px-3 sm:px-4 rounded-xl sm:rounded-2xl text-xs sm:text-sm min-w-0 w-auto"
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit</span>
              </PrimaryButton>
            )}
          </div>
        </div>
        
        {isEditing ? (
          /* Editing Mode */
          <div className="space-y-4">
            {/* Enhanced editing ambient glow effect */}
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-cyan-400/15 to-blue-500/10 rounded-xl blur-lg transition-all duration-500 opacity-80"></div>
              <div className="relative">
                {/* Helpful guidance for writing good descriptions */}
                <div className="mb-4 p-3 bg-blue-900/20 border border-blue-800/40 rounded-lg">
                  <h5 className="text-xs font-semibold text-blue-200 mb-2 flex items-center space-x-1">
                    <Target className="w-3 h-3" />
                    <span>Tips for better email sorting:</span>
                  </h5>
                  <ul className="text-[11px] text-blue-200/90 space-y-1 ml-4">
                    <li>• Be specific about email types (newsletters, receipts, work emails)</li>
                    <li>• Mention sender patterns (company domains, keywords)</li>
                    <li>• Include subject line patterns or keywords</li>
                    <li>• Describe the email purpose or content type</li>
                  </ul>
                </div>
                
                {/* Textarea with auto-resize */}
                <textarea
                  ref={textareaRef}
                  value={editValue}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-gray-900/80 border-2 border-gray-700/60 rounded-xl p-4 text-white placeholder-gray-400 resize-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all font-medium break-words"
                  placeholder={`Example: Emails related to ${folderName} including newsletters, promotional content, marketing emails from retail companies, subscription services, and email campaigns. Look for unsubscribe links, promotional language, and bulk sender patterns.`}
                  aria-label="Folder instruction"
                  style={{ minHeight: '120px' }}
                />
                
                {/* Helper text */}
                <div className="mt-3 flex items-start space-x-2">
                  <SparklesIcon className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-blue-200 font-medium mb-1">This description helps Clira understand what emails belong in this folder.</p>
                    <p className="text-[11px] text-blue-300/80">The more specific and detailed you are, the more accurate the sorting will be.</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Error message */}
            {error && (
              <div className="p-2 bg-red-900/20 border border-red-800/40 rounded-lg">
                <p className="text-xs text-red-300 font-medium">{error}</p>
              </div>
            )}
            
            {/* Action buttons - Mobile-first responsive layout like EmailQueueCard */}
            <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:space-x-2 sm:justify-end">
              <LiquidButton
                onClick={handleCancel}
                disabled={isSaving}
                minWidth="sm"
                responsive
                variant="default"
                size="lg"
                aria-label="Cancel editing"
                className="w-full sm:w-auto h-9 sm:h-10 px-3 sm:px-4 rounded-xl sm:rounded-2xl text-sm min-w-0 text-sky-100"
                type="button"
              >
                <span className="flex items-center gap-2">
                  <X className="w-4 h-4" />
                  <span className="sm:hidden">Cancel</span>
                  <span className="hidden sm:inline">Cancel</span>
                </span>
              </LiquidButton>
              <PrimaryButton
                onClick={handleSave}
                disabled={isSaving || !editValue.trim()}
                minWidth="sm"
                aria-label="Save folder instructions"
                keyboardShortcut="⌘↵"
                className="w-full sm:w-auto h-9 sm:h-10 px-3 sm:px-4 rounded-xl sm:rounded-2xl text-sm min-w-0"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="sm:hidden">Saving...</span>
                    <span className="hidden sm:inline">Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span className="sm:hidden">Save</span>
                    <span className="hidden sm:inline">Save</span>
                  </>
                )}
              </PrimaryButton>
            </div>
          </div>
        ) : (
          /* Read-only Mode */
          <div>
            {/* Warning message for under-described folders */}
            {!isWellDescribed && (
              <div className="mb-3 p-3 bg-amber-900/20 border border-amber-800/40 rounded-lg">
                <p className="text-xs text-amber-200 font-medium flex items-center space-x-2">
                  <SparklesIcon className="w-3 h-3 flex-shrink-0" />
                  <span>This folder uses basic sorting. Add a detailed description for better accuracy.</span>
                </p>
              </div>
            )}
            
            {/* Meta prompt display */}
            <p className={`text-sm leading-relaxed whitespace-pre-line font-medium transition-colors duration-300 break-words overflow-wrap-anywhere ${
              !isWellDescribed
                ? 'text-amber-100 group-hover/instruction:text-amber-50'
                : 'text-gray-100 group-hover/instruction:text-gray-50'
            }`}>
              {metaPrompt || `Emails related to ${folderName}`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
