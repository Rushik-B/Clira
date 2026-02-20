'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Mail, X, Target, AtSign } from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_REGEX = /^@?[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z.]{2,}$/;

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

function mapConditionToApiType(condition: string): string {
  switch (condition) {
    case 'sender': return 'EMAIL';
    case 'domain': return 'DOMAIN';
    case 'subject': return 'SUBJECT';
    case 'subject_contains': return 'SUBJECT_CONTAINS';
    case 'subject_starts_with': return 'SUBJECT_STARTS_WITH';
    case 'subject_ends_with': return 'SUBJECT_ENDS_WITH';
    case 'subject_regex': return 'SUBJECT_REGEX';
    default: return 'EMAIL';
  }
}

interface AddRuleModalProps {
  folderId: string;
  folderName: string;
  onClose: () => void;
  onAdd: (rule: any) => void;
}

export const AddRuleModal: React.FC<AddRuleModalProps> = ({
  folderId,
  folderName,
  onClose,
  onAdd
}) => {
  const [condition, setCondition] = useState<'sender' | 'domain' | 'subject' | 'subject_contains' | 'subject_starts_with' | 'subject_ends_with' | 'subject_regex'>('sender');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll while modal is open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  const getPlaceholder = (cond: string) => {
    switch (cond) {
      case 'sender': return 'e.g., user@company.com';
      case 'domain': return 'e.g., @company.com';
      case 'subject': return 'e.g., Meeting Reminder';
      case 'subject_contains': return 'e.g., invoice';
      case 'subject_starts_with': return 'e.g., [URGENT]';
      case 'subject_ends_with': return 'e.g., - Confirmed';
      case 'subject_regex': return 'e.g., ^\\[.*\\].*$';
      default: return 'e.g., user@company.com';
    }
  };

  const previewText = () => {
    const readable = getConditionReadable(condition);
    return `IF ${readable} ${getConditionOperator(condition)} "${value || '...'}" THEN move to ${folderName}`;
  };

  const placeholder = getPlaceholder(condition);

  const validate = useCallback((): string | null => {
    if (!value.trim()) return 'Please enter a value.';
    
    switch (condition) {
      case 'sender':
        if (!EMAIL_REGEX.test(value.trim())) return 'Please enter a valid email address.';
        break;
      case 'domain':
        if (!DOMAIN_REGEX.test(value.trim())) return 'Please enter a valid domain (e.g., @company.com).';
        break;
      case 'subject':
      case 'subject_contains':
      case 'subject_starts_with':
      case 'subject_ends_with':
        if (value.trim().length < 2) return 'Subject pattern must be at least 2 characters long.';
        break;
      case 'subject_regex':
        try {
          new RegExp(value.trim());
        } catch {
          return 'Please enter a valid regular expression.';
        }
        break;
    }
    
    return null;
  }, [condition, value]);

  const handleSubmit = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      
      const apiType = mapConditionToApiType(condition);
      const res = await fetch(`/api/folders/${folderId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          type: apiType, 
          value: value.trim()
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create rule');
      }
      onAdd({ 
        id: data.rule.id, 
        condition, 
        value: data.rule.value, 
        action: 'move_to_folder', 
        targetFolderId: folderId
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create rule');
    } finally {
      setSubmitting(false);
    }
  }, [condition, folderId, onAdd, validate, value]);

  // Keyboard shortcut handler for Cmd/Ctrl + Enter
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitting && value.trim()) {
        handleSubmit();
      }
    }
  }, [handleSubmit, submitting, value]);

  // Add keyboard listener for global Cmd+Enter
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!submitting && value.trim()) {
          handleSubmit();
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleSubmit, onClose, submitting, value]);

  const modal = (
    <div
      className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[99999] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative group max-w-2xl w-full transition-all duration-200 ease-out transform">
        <div className="absolute -inset-6 bg-gradient-to-r from-blue-500/10 via-purple-400/15 to-cyan-500/10 rounded-3xl blur-3xl"></div>
        <div
          className="relative bg-black border-2 border-gray-800/60 rounded-3xl backdrop-blur-xl shadow-2xl flex flex-col transition-all duration-200 ease-out"
          onClick={(e) => e.stopPropagation()}
        >
          <GlowingEffect
            blur={0}
            borderWidth={2}
            spread={60}
            glow={true}
            disabled={false}
            proximity={80}
            inactiveZone={0.02}
            movementDuration={1.5}
          />

          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-800/50">
            <div className="flex items-center space-x-4">
              <div className="w-11 h-11 bg-gray-900/60 border-2 border-gray-700/60 rounded-xl flex items-center justify-center shadow-lg">
                <Mail className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Add Hard Rule</h3>
                <p className="text-sm text-gray-300">Apply a guaranteed mapping to <span className="text-blue-300 font-semibold">{folderName}</span></p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-lg transition-colors" aria-label="Close">
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Live Preview */}
            <div className="p-4 bg-blue-900/20 border border-blue-800/40 rounded-xl">
              <p className="text-sm text-blue-200"><span className="font-semibold">Preview:</span> {previewText()}</p>
            </div>

            {/* Condition Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Rule Type</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as any)}
                className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
              >
                <optgroup label="Sender Rules">
                  <option value="sender">Sender email is exactly</option>
                  <option value="domain">Sender domain contains</option>
                </optgroup>
                <optgroup label="Subject Rules">
                  <option value="subject">Subject is exactly</option>
                  <option value="subject_contains">Subject contains</option>
                  <option value="subject_starts_with">Subject starts with</option>
                  <option value="subject_ends_with">Subject ends with</option>
                  <option value="subject_regex">Subject matches regex</option>
                </optgroup>
              </select>
            </div>

            {/* Value Input */}
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Value</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 pl-3 flex items-center">
                  {condition === 'sender' ? (
                    <Mail className="w-4 h-4 text-gray-400" />
                  ) : condition === 'domain' ? (
                    <AtSign className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Target className="w-4 h-4 text-gray-400" />
                  )}
                </div>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 pl-10 pr-3 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all"
                />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {condition === 'sender'
                  ? 'Example: user@company.com'
                  : condition === 'domain'
                  ? 'Example: @company.com (subdomains will also match)'
                  : 'Enter the pattern to match against email subjects'}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-900/20 border border-red-800/40 text-red-300 rounded-lg text-sm">{error}</div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 pt-0 border-t border-gray-800/50">
            <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-3 sm:justify-end">
              <LiquidButton
                onClick={onClose}
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
                onClick={() => { if (!submitting) handleSubmit(); }}
                disabled={submitting}
                minWidth="md"
                keyboardShortcut="⌘↵"
              >
                {submitting ? 'Adding...' : 'Add Rule'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Render in a portal to avoid overlap with folder cards
  return typeof window !== 'undefined' ? createPortal(modal, document.body) : null;
};
