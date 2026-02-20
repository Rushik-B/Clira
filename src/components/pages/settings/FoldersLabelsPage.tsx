'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import {
  Tag,
  Plus,
  Edit3,
  Trash2,
  Save,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Search,
  ArrowUpDown,
  Folder,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { StandardModal } from '@/components/ui/modals/StandardModal';
import { ConfirmDestructiveModal } from '@/components/ui/modals/ConfirmDestructiveModal';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { QueueFilters } from '@/components/ui/queue-page/QueueFilters';
import { SettingsShell } from './SettingsShell';
import { GMAIL_LABEL_COLORS } from '@/lib/gmail/labelColors';
import { groupItemsByMailbox, useQueueFilters } from '@/hooks/queue/useQueueFilters';

interface Label {
  id: string;
  name: string;
  color: string;
  gmailLabelId: string;
  isCustom: boolean;
  emailCount: number;
  backgroundColor?: string;
  textColor?: string;
  mailboxId?: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
}


export const FoldersLabelsPage: React.FC = () => {
  const { data: session } = useSession();

  const [autoSortingEnabled, setAutoSortingEnabled] = useState(false);
  const [autoSortingLoading, setAutoSortingLoading] = useState(true);

  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Create/Edit modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [newLabel, setNewLabel] = useState({ name: '', color: '#4a86e8' });

  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [labelPendingDelete, setLabelPendingDelete] = useState<Label | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Search and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'emails'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [mailboxFilter, setMailboxFilter] = useState('all');

  // Fetch labels on mount
  useEffect(() => {
    fetchLabels();
    fetchAutoSortingPreference();
  }, []);

  const fetchAutoSortingPreference = async () => {
    try {
      setAutoSortingLoading(true);
      const response = await fetch('/api/user/settings/auto-sorting');
      const data = await response.json();
      if (data.success) {
        setAutoSortingEnabled(Boolean(data.autoSortingEnabled));
      } else {
        setErrorMessage(data.error || 'Failed to load automatic sorting preference');
      }
    } catch (error) {
      console.error('Error loading automatic sorting preference:', error);
      setErrorMessage('Failed to load automatic sorting preference');
    } finally {
      setAutoSortingLoading(false);
    }
  };

  const handleToggleAutoSorting = async () => {
    try {
      setAutoSortingLoading(true);
      setErrorMessage('');
      const response = await fetch('/api/user/settings/auto-sorting', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSortingEnabled: !autoSortingEnabled }),
      });

      const data = await response.json();
      if (data.success) {
        setAutoSortingEnabled(Boolean(data.autoSortingEnabled));
        setSuccessMessage(
          data.autoSortingEnabled ? 'Automatic sorting enabled.' : 'Automatic sorting disabled.'
        );
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || 'Failed to update automatic sorting preference');
      }
    } catch (error) {
      console.error('Error updating automatic sorting preference:', error);
      setErrorMessage('Failed to update automatic sorting preference');
    } finally {
      setAutoSortingLoading(false);
    }
  };

  const fetchLabels = async () => {
    try {
      setLoading(true);
      setErrorMessage('');

      const response = await fetch('/api/labels');
      const data = await response.json();

      if (data.success) {
        setLabels(data.labels);
      } else {
        setErrorMessage(data.error || 'Failed to fetch labels');
      }
    } catch (error) {
      console.error('Error fetching labels:', error);
      setErrorMessage('Failed to load labels');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLabel = async () => {
    if (!newLabel.name.trim()) {
      setErrorMessage('Label name is required');
      return;
    }

    setSaving(true);
    setErrorMessage('');
    setSuccessMessage('');
    
    try {
      const response = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLabel)
      });

      const data = await response.json();

      if (data.success) {
        setLabels(prev => [...prev, data.label]);
        setShowCreateModal(false);
        setNewLabel({ name: '', color: '#4a86e8' });
        setSuccessMessage('Label created successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || 'Failed to create label');
      }
    } catch (error) {
      console.error('Error creating label:', error);
      setErrorMessage('Failed to create label. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLabel = async (label: Label) => {
    if (!label.name.trim()) {
      setErrorMessage('Label name is required');
      return;
    }

    setSaving(true);
    setErrorMessage('');
    setSuccessMessage('');
    
    try {
      const requestData = {
        id: label.id,
        name: label.name,
        color: label.color
      };
      
      const response = await fetch('/api/labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });

      const data = await response.json();

      if (data.success) {
        setLabels(prev => prev.map(l => l.id === label.id ? data.label : l));
        setEditingLabel(null);
        setSuccessMessage('Label updated successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || 'Failed to update label');
      }
    } catch (error) {
      console.error('Error updating label:', error);
      setErrorMessage('Failed to update label. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLabel = async () => {
    if (!labelPendingDelete) return;

    setDeleteLoading(true);
    setDeleteError('');

    try {
      const response = await fetch(`/api/labels?id=${labelPendingDelete.id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        setLabels(prev => prev.filter(l => l.id !== labelPendingDelete.id));
        setShowDeleteModal(false);
        setLabelPendingDelete(null);
        setSuccessMessage('Label deleted successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setDeleteError(data.error || 'Failed to delete label');
      }
    } catch (error) {
      setDeleteError('Failed to delete label. Please try again.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCloseDeleteModal = () => {
    if (deleteLoading) return;
    setShowDeleteModal(false);
    setLabelPendingDelete(null);
    setDeleteError('');
  };

  const getLabelMailboxMeta = useCallback((label: Label) => ({
    mailboxId: label.mailboxId,
    mailboxEmail: label.mailboxEmail,
    mailboxDisplayName: label.mailboxDisplayName,
  }), []);

  const {
    filteredItems: mailboxFilteredLabels,
    mailboxOptions,
    isMailboxFilterActive,
  } = useQueueFilters({
    items: labels,
    mailboxFilter,
    getMailboxMeta: getLabelMailboxMeta,
  });

  // Filter and sort labels
  const filteredSortedLabels = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    let result = mailboxFilteredLabels.filter((label) => {
      if (!normalizedQuery) return true;
      return label.name.toLowerCase().includes(normalizedQuery);
    });
    
    result = result.sort((a, b) => {
      if (sortBy === 'name') {
        return sortDir === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      return sortDir === 'asc' ? a.emailCount - b.emailCount : b.emailCount - a.emailCount;
    });
    return result;
  }, [mailboxFilteredLabels, searchQuery, sortBy, sortDir]);

  const groupedLabels = useMemo(() => (
    groupItemsByMailbox({
      items: filteredSortedLabels,
      getMailboxMeta: getLabelMailboxMeta,
      mailboxOptions,
    })
  ), [filteredSortedLabels, getLabelMailboxMeta, mailboxOptions]);

  const showMailboxGrouping = mailboxOptions.length > 1 || isMailboxFilterActive;

  return (
    <SettingsShell
      title="Folders & Labels"
      subtitle="Tune automatic filing, review label health, and jump into the folder designer."
      icon={Folder}
      iconColor="text-blue-300"
      mobileActions={
        <LiquidButton
          onClick={fetchLabels}
          disabled={saving || loading}
          minWidth="none"
          size="icon"
          className="h-8 w-8 rounded-full text-sky-100"
          aria-label="Refresh labels"
          variant="default"
          type="button"
        >
          <RefreshCw size={14} className={`${loading ? 'animate-spin' : ''}`} />
        </LiquidButton>
      }
    >
      <div className="space-y-8 relative z-10">
        {/* Automation overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 shadow-lg shadow-blue-500/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Smart folders</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Always-on sorting</h2>
                <p className="mt-2 text-sm text-slate-300 max-w-xl">
                  Adjust folder logic, trigger a re-org, or review corrections in the dedicated designer.
                </p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-200">
                <Folder className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton
                minWidth="md"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('clira:navigate', {
                        detail: { page: 'folders' },
                      })
                    );
                  }
                }}
              >
                Open folder designer
              </PrimaryButton>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('clira:navigate', {
                        detail: { page: 'folders', mode: 'review' },
                      })
                    );
                  }
                }}
                className="px-4 py-2 rounded-2xl border border-slate-700 text-sm text-slate-200 hover:border-slate-500 transition"
              >
                Review classifications
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-violet-900/60 bg-gradient-to-br from-violet-950 via-violet-900 to-slate-950 p-6 shadow-lg shadow-violet-500/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Mail cues</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Review-ready labels</h2>
                <p className="mt-2 text-sm text-violet-100/80 max-w-xl">
                  Labels act as instructions for —priority inboxes, VIPs, or low-touch folders.
                </p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-violet-200">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
            <p className="mt-6 text-sm text-violet-100/70">
              Anything you create here mirrors to Gmail instantly, so native filters and  stay in sync.
            </p>
          </div>
        </div>

        {/* Automatic Sorting Toggle */}
        <div className="rounded-3xl border border-slate-800/70 bg-slate-950/70 p-6 shadow-lg shadow-blue-500/10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Automation</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Automatic sorting</h2>
              <p className="mt-2 text-sm text-slate-300 max-w-2xl">
                Keep this on to let Clira continuously route new emails into your approved folders. You can toggle it off anytime.
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleAutoSorting}
              disabled={autoSortingLoading}
              role="switch"
              aria-checked={autoSortingEnabled}
              className={`relative h-12 w-24 rounded-full transition disabled:opacity-60 ${
                autoSortingEnabled ? 'bg-emerald-500/80' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white shadow-2xl transition ${
                  autoSortingEnabled ? 'right-2' : 'left-2'
                }`}
              />
              <span className="sr-only">Toggle automatic sorting</span>
            </button>
          </div>
        </div>

        {/* Messages */}
        {successMessage && (
          <div className="flex items-center space-x-3 p-4 bg-emerald-900/30 border border-emerald-700/50 rounded-xl mb-6">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            <span className="text-emerald-300 font-medium">{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center space-x-3 p-4 bg-red-900/30 border border-red-700/50 rounded-xl mb-6">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <span className="text-red-300 font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Action Bar */}
        <div className="flex flex-col space-y-2 lg:flex-row lg:space-y-0 lg:space-x-3 self-stretch lg:self-auto">
          <button
            onClick={fetchLabels}
            disabled={saving || loading}
            className="px-4 py-2.5 bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700/50 rounded-lg text-gray-300 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            aria-label="Refresh labels"
          >
            <RefreshCw className={`w-4 h-4 inline mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={saving || loading}
            className="px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-600/50 rounded-lg text-purple-300 hover:text-purple-200 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            <Plus className="w-4 h-4 inline mr-2" />
            Create Label
          </button>
        </div>

        <QueueFilters
          mailboxFilter={mailboxFilter}
          onMailboxFilterChange={setMailboxFilter}
          mailboxOptions={mailboxOptions}
          filteredCount={filteredSortedLabels.length}
          totalCount={labels.length}
          itemLabel="label"
          summarySuffix="available"
        />

        {/* Search and Sort Controls */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="flex-1">
            <div className="relative">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={loading ? "Loading labels..." : "Search by name..."}
                disabled={loading}
                className={`w-full bg-gray-900/60 border-2 border-gray-700/50 rounded-lg pl-3 pr-10 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all ${
                  loading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              />
              {loading ? (
                <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
              ) : (
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
              )}
            </div>
          </div>
          <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-3 lg:space-x-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'emails')}
                disabled={loading}
                className={`bg-gray-900/60 border-2 border-gray-700/50 rounded-lg px-2 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all ${
                  loading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <option value="name">Name</option>
                <option value="emails">Email count</option>
              </select>
            </div>
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              disabled={loading}
              className="px-4 py-2.5 bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700/50 rounded-lg text-gray-300 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              aria-label="Toggle sort direction"
            >
              <ArrowUpDown className="w-4 h-4 inline mr-2" />
              {sortDir === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
        </div>

        {/* Labels Section */}
        <div className="space-y-8">
          <div className="relative group text-center mb-8">
            <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/8 via-purple-400/12 to-purple-500/8 rounded-2xl blur-xl"></div>
            <h2 className="relative text-3xl font-bold text-white">Your Labels</h2>
            <div className="relative w-24 h-0.5 bg-gradient-to-r from-transparent via-purple-500 to-transparent mx-auto mt-2"></div>
          </div>
          
          <div className="grid gap-4">
            {loading ? (
              <div className="space-y-4">
                {/* Loading skeleton cards */}
                {[1, 2, 3].map((i) => (
                  <div key={i} className="relative group transition-transform duration-300 will-change-transform animate-pulse">
                    <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 via-purple-400/15 to-purple-500/10 rounded-2xl blur-lg transition-all duration-500"></div>
                    <div className="relative rounded-3xl border border-gray-800/50 bg-black/80 backdrop-blur-md shadow-2xl min-h-[140px]">
                      <div className="relative bg-black/70 border-2 border-gray-800/70 rounded-2xl p-6 backdrop-blur-sm shadow-inner">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3 flex-1">
                            <div className="w-5 h-5 bg-gray-700 rounded-full animate-pulse"></div>
                            <div className="flex-1">
                              <div className="h-6 bg-gray-700 rounded-lg w-32 animate-pulse mb-2"></div>
                              <div className="h-4 bg-gray-700 rounded-lg w-48 animate-pulse"></div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 bg-gray-700 rounded-lg animate-pulse"></div>
                            <div className="w-8 h-8 bg-gray-700 rounded-lg animate-pulse"></div>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="h-4 bg-gray-700 rounded w-12 animate-pulse"></div>
                            <div className="h-6 bg-gray-700 rounded-full w-20 animate-pulse"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredSortedLabels.length === 0 ? (
              isMailboxFilterActive ? (
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
                  <p className="text-gray-300 text-sm mb-2">No labels match this inbox.</p>
                  <button
                    type="button"
                    onClick={() => setMailboxFilter('all')}
                    className="text-xs text-purple-300 hover:text-purple-200 transition-colors cursor-pointer"
                  >
                    Clear inbox filter
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
                  <p className="text-gray-400 text-sm">No labels found. Try adjusting your search.</p>
                </div>
              )
            ) : showMailboxGrouping ? (
              <div className="space-y-10">
                {groupedLabels.map((group, groupIndex) => (
                  <section key={group.key} className="space-y-6">
                    <div className="sticky top-24 sm:top-8 z-20">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-gray-800/70 bg-black/80 px-4 py-3 backdrop-blur-md shadow-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] uppercase tracking-[0.3em] text-gray-500">Inbox</span>
                          <span className="text-sm font-semibold text-white">{group.label}</span>
                        </div>
                        <div className="flex-1 h-px bg-gradient-to-r from-purple-500/40 via-purple-400/10 to-transparent"></div>
                        <span className="text-xs text-gray-400">
                          {group.items.length} label{group.items.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {group.items.map((label, index) => (
                        <div
                          key={label.id}
                          style={{ animationDelay: `${(groupIndex * 3 + index) * 80}ms` }}
                        >
                          <LabelCard
                            label={label}
                            editingLabel={editingLabel}
                            setEditingLabel={setEditingLabel}
                            onUpdate={handleUpdateLabel}
                            onRequestDelete={() => {
                              setDeleteError('');
                              setLabelPendingDelete(label);
                              setShowDeleteModal(true);
                            }}
                            deleteLoading={deleteLoading}
                            deletingLabelId={labelPendingDelete?.id ?? null}
                            saving={saving}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredSortedLabels.map((label, index) => (
                  <div key={label.id} style={{ animationDelay: `${index * 100}ms` }}>
                    <LabelCard
                      label={label}
                      editingLabel={editingLabel}
                      setEditingLabel={setEditingLabel}
                      onUpdate={handleUpdateLabel}
                      onRequestDelete={() => {
                        setDeleteError('');
                        setLabelPendingDelete(label);
                        setShowDeleteModal(true);
                      }}
                      deleteLoading={deleteLoading}
                      deletingLabelId={labelPendingDelete?.id ?? null}
                      saving={saving}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Empty State */}
        {!loading && filteredSortedLabels.length === 0 && searchQuery === '' && !isMailboxFilterActive && (
          <div className="text-center py-16">
            <div className="relative mx-auto mb-6">
              <div className="absolute -inset-4 bg-gradient-to-r from-purple-500/8 via-purple-400/12 to-purple-500/8 rounded-full blur-2xl transition-all duration-700"></div>
              <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500/10 via-purple-400/20 to-purple-500/10 rounded-full blur-lg transition-all duration-500"></div>
              
              <div className="relative w-24 h-24 bg-gray-900/50 border border-gray-700 rounded-full flex items-center justify-center">
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
                <Tag className="w-12 h-12 text-gray-500" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">No Labels Found</h3>
            <p className="text-gray-400 mb-6">
              You haven't created any custom labels yet. Create your first label to get started.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-3 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-600/50 rounded-lg text-purple-300 hover:text-purple-200 transition-all duration-200 text-sm font-medium"
            >
              <Plus className="h-4 w-4 inline mr-2" />
              Create Your First Label
            </button>
          </div>
        )}
        
        {/* Create Label Modal */}
        {showCreateModal && (
          <CreateLabelModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateLabel}
            saving={saving}
            newLabel={newLabel}
            setNewLabel={setNewLabel}
          />
        )}

      </div>
      {/* Delete Confirmation Modal */}
      <ConfirmDestructiveModal
        open={showDeleteModal && Boolean(labelPendingDelete)}
        title="Delete label"
        description={(
          <div className="space-y-2 text-sm">
            <p>
              Are you sure you want to delete
              <span className="text-white font-semibold"> {labelPendingDelete?.name}</span>?
            </p>
            <p className="text-gray-400">This action cannot be undone.</p>
          </div>
        )}
        onConfirm={handleDeleteLabel}
        onCancel={handleCloseDeleteModal}
        loading={deleteLoading}
        confirmLabel="Delete"
        error={deleteError}
      />
    </SettingsShell>
  );
};

// Label Card Component
interface LabelCardProps {
  label: Label;
  editingLabel: Label | null;
  setEditingLabel: (label: Label | null) => void;
  onUpdate: (label: Label) => Promise<void>;
  onRequestDelete: () => void;
  deleteLoading: boolean;
  deletingLabelId: string | null;
  saving: boolean;
}

const LabelCard: React.FC<LabelCardProps> = ({
  label,
  editingLabel,
  setEditingLabel,
  onUpdate,
  onRequestDelete,
  deleteLoading,
  deletingLabelId,
  saving
}) => {
  const [editName, setEditName] = useState(label.name);
  const [editColor, setEditColor] = useState(label.color);

  // Update local state when label changes
  useEffect(() => {
    setEditName(label.name);
    setEditColor(label.color);
  }, [label.name, label.color]);

  const handleSave = async () => {
    if (!editName.trim()) return;
    
    const updatedLabel = {
      ...label,
      name: editName.trim(),
      color: editColor
    };
    
    try {
      await onUpdate(updatedLabel);
    } catch (error) {
      console.error('Failed to update label:', error);
      setEditName(label.name);
      setEditColor(label.color);
    }
  };

  const handleCancel = () => {
    setEditName(label.name);
    setEditColor(label.color);
    setEditingLabel(null);
  };

  const isEditing = editingLabel?.id === label.id;

  return (
    <div className="relative group transition-transform duration-300 will-change-transform">
      <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 via-purple-400/15 to-purple-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-purple-400/20 group-hover:via-purple-300/25 group-hover:to-purple-400/20"></div>
      
      <div className="relative rounded-3xl border border-gray-800/50 bg-black/80 backdrop-blur-md shadow-2xl transition-all duration-300 group-hover:border-gray-700/60 min-h-[120px]">
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
        
        <div className="relative bg-black/70 border-2 border-gray-800/70 rounded-2xl p-6 backdrop-blur-sm shadow-inner transition-all duration-300 group-hover:bg-black/80 group-hover:border-gray-700/80">
          
          {/* Label Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div 
                className="w-5 h-5 rounded-full shadow-lg transition-all duration-300 group-hover:scale-110"
                style={{ 
                  backgroundColor: label.backgroundColor || label.color, 
                  boxShadow: `0 0 15px ${label.backgroundColor || label.color}60` 
                }}
                title={`Color: ${label.color}`}
              />
              <div className="flex-1">
                {isEditing ? (
                  <Input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="bg-gray-800/80 border-gray-600 text-white text-lg font-bold focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 rounded-lg px-3 py-2"
                    disabled={saving}
                    placeholder="Enter label name..."
                  />
                ) : (
                  <h3 className="text-lg font-bold text-white group-hover:text-purple-100 transition-colors">{label.name}</h3>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleSave}
                    disabled={saving || !editName.trim()}
                    className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/50 rounded-lg text-emerald-300 hover:text-emerald-200 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    <Save className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={saving}
                    className="px-3 py-2 bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700/50 rounded-lg text-gray-300 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setEditingLabel(label)}
                    disabled={saving}
                    className="px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/50 rounded-lg text-blue-300 hover:text-blue-200 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={onRequestDelete}
                    disabled={saving || (deleteLoading && deletingLabelId === label.id)}
                    className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 rounded-lg text-red-300 hover:text-red-200 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    {deleteLoading && deletingLabelId === label.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Label Details */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Type:</span>
              <span className="text-purple-300 font-medium bg-purple-900/30 px-2 py-1 rounded-full text-xs border border-purple-700/50">
                Custom Label
              </span>
            </div>
          </div>

          {/* Color Picker (when editing) */}
          {isEditing && (
            <div className="mt-6 pt-6 border-t border-gray-700/50">
              <label className="block text-sm font-medium text-gray-300 mb-4">Color:</label>
              <div className="space-y-6">
                {/* Current Color Preview */}
                <div className="flex items-center space-x-4 p-4 bg-gray-800/30 rounded-xl border border-gray-700/50">
                  <div 
                    className="w-10 h-10 rounded-lg border-2 border-gray-600 shadow-lg"
                    style={{ backgroundColor: editColor }}
                  />
                  <span className="text-sm text-gray-400 font-mono">{editColor}</span>
                </div>
                
                {/* Gmail Color Palette */}
                <div>
                  <div className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-medium">Gmail Colors:</div>
                  <div className="grid grid-cols-8 gap-3 max-h-40 overflow-y-auto p-3 bg-gray-800/20 rounded-xl border border-gray-700/30">
                    {GMAIL_LABEL_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setEditColor(color)}
                        className="w-10 h-10 rounded-lg border-2 border-gray-600 hover:border-gray-400 transition-all duration-200 hover:scale-110"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Create Label Modal Component
interface CreateLabelModalProps {
  onClose: () => void;
  onCreate: () => Promise<void>;
  saving: boolean;
  newLabel: { name: string; color: string };
  setNewLabel: (label: { name: string; color: string }) => void;
}

const CreateLabelModal: React.FC<CreateLabelModalProps> = ({
  onClose,
  onCreate,
  saving,
  newLabel,
  setNewLabel
}) => {
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!saving && newLabel.name.trim()) {
          onCreate();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [saving, newLabel.name, onCreate]);

  const headerIcon = (
    <Plus className="w-5 h-5 text-purple-300" />
  );

  const body = (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Label Name
        </label>
        <Input
          type="text"
          value={newLabel.name}
          onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })}
          placeholder="Enter label name..."
          className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50"
          disabled={saving}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Color
        </label>
        <div className="space-y-4">
          <div className="flex items-center space-x-3 p-3 bg-gray-800/50 rounded-lg">
            <div 
              className="w-8 h-8 rounded-lg border-2 border-gray-600 shadow-lg"
              style={{ backgroundColor: newLabel.color }}
            />
            <span className="text-sm text-gray-400 font-mono">{newLabel.color}</span>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-medium">Gmail Colors:</div>
            <div className="grid grid-cols-8 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-800/30 rounded-lg">
              {GMAIL_LABEL_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewLabel({ ...newLabel, color })}
                  className="w-8 h-8 rounded-lg border-2 border-gray-600 hover:border-gray-400 transition-all duration-200 hover:scale-110"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const footer = (
    <>
      <LiquidButton
        onClick={onClose}
        disabled={saving}
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
        onClick={onCreate}
        disabled={saving || !newLabel.name.trim()}
        minWidth="lg"
        keyboardShortcut="⌘↵"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating...
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" />
            Create Label
          </>
        )}
      </PrimaryButton>
    </>
  );

  return (
    <StandardModal
      isOpen
      onClose={() => { if (!saving) onClose(); }}
      title="Create New Label"
      subtitle="Choose a name and color for your Gmail label."
      icon={headerIcon}
      size="md"
      footer={footer}
    >
      {body}
    </StandardModal>
  );
};
