'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, ChevronDown, ArrowRight, Clock, Star, Zap, Command } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { LabelCache } from '@/lib/cache/labelCache';

interface Label {
  id: string;
  name: string;
  color: string;
  gmailLabelId: string;
  isCustom: boolean;
  emailCount: number;
  queueCount?: number; // Will be populated from cache if available
}

interface QuickLabelSwitcherProps {
  currentLabelId?: string;
  onLabelSelect: (labelId: string) => void;
  className?: string;
}

// Recent labels localStorage management
const RECENT_LABELS_KEY = 'clira-recent-label-queues';
const MAX_RECENT_LABELS = 5;

const getRecentLabels = (): string[] => {
  try {
    const stored = localStorage.getItem(RECENT_LABELS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const addRecentLabel = (labelId: string) => {
  try {
    const recent = getRecentLabels();
    const filtered = recent.filter(id => id !== labelId);
    const updated = [labelId, ...filtered].slice(0, MAX_RECENT_LABELS);
    localStorage.setItem(RECENT_LABELS_KEY, JSON.stringify(updated));
  } catch {
    // Silently fail if localStorage isn't available
  }
};

export const QuickLabelSwitcher: React.FC<QuickLabelSwitcherProps> = ({
  currentLabelId,
  onLabelSelect,
  className = ''
}) => {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [labels, setLabels] = useState<Label[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recentLabelIds, setRecentLabelIds] = useState<string[]>([]);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadLabels = useCallback(async () => {
    const userId = session?.userId;
    if (!userId) return;
    
    setIsLoading(true);
    try {
      // Try cache first
      const { data, isFresh } = LabelCache.getCached(userId);
      
      if (data?.labels && isFresh) {
        setLabels(data.labels);
        setIsLoading(false);
        return;
      }

      // Fetch fresh data
      const response = await fetch('/api/labels');
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.labels) {
          setLabels(result.labels);
          LabelCache.setCached(userId, result.labels);
        }
      }
    } catch (error) {
      console.error('Error loading labels for switcher:', error);
    } finally {
      setIsLoading(false);
    }
  }, [session?.userId]);
  
  // Load labels and recent labels on mount
  useEffect(() => {
    loadLabels();
    setRecentLabelIds(getRecentLabels());
  }, [loadLabels]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd/Ctrl + K to open quick switcher
      if ((event.metaKey || event.ctrlKey) && event.key === 'k' && !isOpen) {
        event.preventDefault();
        setIsOpen(true);
      }
      
      // Escape to close
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Filter and sort labels based on search
  const filteredLabels = useMemo(() => {
    const filtered = labels.filter(label => 
      label.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      label.id !== currentLabelId // Don't show current label
    );

    // Sort by relevance: exact match, starts with, contains
    filtered.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const query = searchQuery.toLowerCase();

      if (aName === query) return -1;
      if (bName === query) return 1;
      if (aName.startsWith(query) && !bName.startsWith(query)) return -1;
      if (bName.startsWith(query) && !aName.startsWith(query)) return 1;

      return aName.localeCompare(bName);
    });

    return filtered;
  }, [labels, searchQuery, currentLabelId]);

  // Get recent labels (excluding current)
  const recentLabels = useMemo(() => {
    return recentLabelIds
      .map(id => labels.find(label => label.id === id))
      .filter((label): label is Label => 
        label !== undefined && label.id !== currentLabelId
      );
  }, [recentLabelIds, labels, currentLabelId]);

  // Get high priority labels (high email count)
  const priorityLabels = useMemo(() => {
    return labels
      .filter(label => 
        label.id !== currentLabelId && 
        label.emailCount > 10 &&
        !recentLabelIds.includes(label.id)
      )
      .sort((a, b) => b.emailCount - a.emailCount)
      .slice(0, 3);
  }, [labels, currentLabelId, recentLabelIds]);

  const handleLabelSelect = (labelId: string) => {
    addRecentLabel(labelId);
    setRecentLabelIds(getRecentLabels());
    onLabelSelect(labelId);
    setIsOpen(false);
    setSearchQuery('');
  };

  const currentLabel = labels.find(label => label.id === currentLabelId);

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-all duration-200 min-w-48"
        aria-label="Switch between label queues"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {currentLabel && (
          <span className="text-lg leading-none">{currentLabel.name.charAt(0).toUpperCase()}</span>
        )}
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-white truncate">
            {currentLabel?.name || 'Select Label'}
          </div>
          <div className="text-xs text-gray-400">
            Switch queue • ⌘K
          </div>
        </div>
        <ChevronDown 
          size={16} 
          className={`text-gray-400 transition-transform duration-200 ${
            isOpen ? 'transform rotate-180' : ''
          }`} 
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-black/95 border border-gray-700/50 rounded-lg shadow-xl backdrop-blur-md z-50 max-h-96 overflow-hidden">
          {/* Search Input */}
          <div className="p-3 border-b border-gray-700/50">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search labels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-800/50 border border-gray-600/50 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-blue-500/50 focus:bg-gray-800"
              />
            </div>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="p-4 text-center">
              <div className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full mx-auto"></div>
              <p className="text-sm text-gray-400 mt-2">Loading labels...</p>
            </div>
          )}

          {/* Results */}
          {!isLoading && (
            <div className="max-h-80 overflow-y-auto">
              {/* Recent Labels */}
              {!searchQuery && recentLabels.length > 0 && (
                <div className="p-2">
                  <div className="flex items-center space-x-2 px-2 py-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <Clock size={12} />
                    <span>Recent</span>
                  </div>
                  {recentLabels.map((label) => (
                    <LabelOption
                      key={label.id}
                      label={label}
                      onClick={() => handleLabelSelect(label.id)}
                      icon={<Clock size={14} className="text-gray-400" />}
                    />
                  ))}
                </div>
              )}

              {/* Priority Labels */}
              {!searchQuery && priorityLabels.length > 0 && (
                <div className="p-2 border-t border-gray-700/30">
                  <div className="flex items-center space-x-2 px-2 py-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <Star size={12} />
                    <span>High Activity</span>
                  </div>
                  {priorityLabels.map((label) => (
                    <LabelOption
                      key={label.id}
                      label={label}
                      onClick={() => handleLabelSelect(label.id)}
                      icon={<Zap size={14} className="text-orange-400" />}
                    />
                  ))}
                </div>
              )}

              {/* Search Results / All Labels */}
              {(searchQuery || (!recentLabels.length && !priorityLabels.length)) && (
                <div className="p-2 border-t border-gray-700/30">
                  {searchQuery && (
                    <div className="flex items-center space-x-2 px-2 py-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
                      <Search size={12} />
                      <span>Search Results ({filteredLabels.length})</span>
                    </div>
                  )}
                  {filteredLabels.map((label) => (
                    <LabelOption
                      key={label.id}
                      label={label}
                      onClick={() => handleLabelSelect(label.id)}
                    />
                  ))}
                </div>
              )}

              {/* Empty State */}
              {!isLoading && filteredLabels.length === 0 && searchQuery && (
                <div className="p-6 text-center text-gray-400">
                  <Search size={24} className="mx-auto mb-2 opacity-50" />
                  <p>No labels found for "{searchQuery}"</p>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-700/50 p-2">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center space-x-1">
                <Command size={12} />
                <span>⌘K to open</span>
              </div>
              <span>{labels.length} labels total</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Individual label option component
const LabelOption: React.FC<{
  label: Label;
  onClick: () => void;
  icon?: React.ReactNode;
}> = ({ label, onClick, icon }) => {
  const labelColor = label.color || '#6366f1';
  
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center space-x-3 px-3 py-2 rounded-md hover:bg-gray-800/50 transition-colors duration-150 group"
    >
      {icon || (
        <div 
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: labelColor }}
        />
      )}
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm font-medium text-white truncate">
          {label.name}
        </div>
        <div className="text-xs text-gray-400">
          {label.emailCount} emails
        </div>
      </div>
      <ArrowRight 
        size={14} 
        className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0" 
      />
    </button>
  );
};

export default QuickLabelSwitcher;
