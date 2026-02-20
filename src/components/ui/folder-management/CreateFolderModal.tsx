'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Folder, Plus, Loader2 } from 'lucide-react';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { StandardModal } from '@/components/ui/modals/StandardModal';

interface CreateFolderModalProps {
  onClose: () => void;
  onCreate: (folder: {
    name: string;
    description: string;
    icon: string;
    color: string;
    enableReorganization?: boolean;
  }) => Promise<void> | void;
  processing: boolean;
  existingNames?: string[];
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  onClose,
  onCreate,
  processing,
  existingNames = []
}) => {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState('#6B7280');
  const [description, setDescription] = useState('');
  const [enableReorganization, setEnableReorganization] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colorOptions = [
    '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#84CC16', '#6B7280'
  ];
  const iconOptions = [
    '📁','📧','💼','🏠','💰','✈️','🛒','🎵','📚','🎮','🏥','🚗','🍕','📱','💻','⚽'
  ];

  const validate = useCallback((): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return 'Please enter a folder name.';
    if (existingNames.includes(trimmed.toLowerCase())) return 'A folder with this name already exists.';
    return null;
  }, [existingNames, name]);

  const handleSubmit = useCallback(async () => {
    if (submitting || processing) return;
    const v = validate();
    if (v) { setError(v); return; }
    try {
      setSubmitting(true);
      setError(null);
      await onCreate({
        name: name.trim(),
        description: (description || `Emails related to ${name.trim()}`).trim(),
        icon,
        color,
        enableReorganization
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create folder');
    } finally {
      setSubmitting(false);
    }
  }, [color, description, enableReorganization, icon, name, onCreate, processing, submitting, validate]);

  // Keyboard shortcut handler for Cmd/Ctrl + Enter
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitting && !processing && !validate()) {
        handleSubmit();
      }
    }
  }, [handleSubmit, processing, submitting, validate]);

  // Handle Cmd/Ctrl + Enter to submit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!submitting && !processing && !validate()) {
          handleSubmit();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleSubmit, processing, submitting, validate]);

  const headerIcon = (
    <Folder className="w-5 h-5 text-blue-300" />
  );

  const body = (
    <div className="space-y-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-gray-200 mb-2">Folder name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g., Work, Personal, Shopping"
              className="w-full bg-gray-900/60 border border-gray-700/50 rounded-xl p-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
              />
            </div>

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-gray-200">Short description</label>
                <span className="text-[11px] text-gray-400">Shown under the folder title</span>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={handleKeyDown}
              className="w-full bg-gray-900/60 border border-gray-700/50 rounded-xl p-3 text-white placeholder-gray-400 resize-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
                rows={3}
                placeholder="Describe what types of emails should go in this folder..."
              />
            </div>

            {/* Icon and Color */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Icon</label>
                <div className="grid grid-cols-8 gap-2">
                  {iconOptions.map((ico) => (
                    <button
                      key={ico}
                      onClick={() => setIcon(ico)}
                      className={`p-2 text-xl rounded-lg border transition-all ${icon === ico ? 'border-blue-500 bg-blue-900/30' : 'border-gray-700/70 hover:border-gray-600'}`}
                      type="button"
                    >
                      {ico}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-lg border-2 transition-all ${color === c ? 'border-white scale-105' : 'border-gray-600/80 hover:border-gray-500 hover:scale-105'}`}
                      style={{ backgroundColor: c }}
                      type="button"
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Enable reorganization */}
            <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div>
                <div className="text-sm font-semibold text-gray-200">Automatically reorganize emails into this folder</div>
                <div className="text-xs text-gray-400">We will analyze recent emails and move matching ones here.</div>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableReorganization}
                  onChange={(e) => setEnableReorganization(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
                  <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform ${enableReorganization ? 'translate-x-5' : ''}`}></div>
                </div>
              </label>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-900/20 border border-red-800/40 text-red-300 rounded-lg text-sm">{error}</div>
            )}
    </div>
  );

  const footer = (
    <>
      <LiquidButton
        onClick={onClose}
        disabled={submitting}
        minWidth="md"
        responsive
        variant="default"
        size="lg"
        className={LIQUID_BUTTON_BASE_CLASS}
        type="button"
      >
        Cancel
      </LiquidButton>
      <PrimaryButton
        onClick={handleSubmit}
        disabled={!!validate() || submitting || processing}
        minWidth="lg"
        keyboardShortcut="⌘↵"
      >
        {submitting || processing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Creating...
          </>
        ) : (
          <>
            <Plus className="w-4 h-4" />
            Create Folder
          </>
        )}
      </PrimaryButton>
    </>
  );

  return (
    <StandardModal
      isOpen
      onClose={() => { if (!submitting) onClose(); }}
      title="Create New Folder"
      subtitle="Name, color, and description. You can reorganize emails into it right away."
      icon={headerIcon}
      size="lg"
      footer={footer}
    >
      {body}
    </StandardModal>
  );
};
