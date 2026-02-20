'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { 
  Folder, 
  Plus,
  AlertCircle,
  Loader2,
  Search,
  ArrowUpDown,
  Zap,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { LoaderFive } from '@/components/ui/loader';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';
import { getFolderIconWithFallback } from '@/lib/utils/folderIconHelper';
import { FolderCache } from '@/lib/cache/folderCache';
import { LabelCache } from '@/lib/cache/labelCache';
import { EmailViewModal } from '@/components/onboarding/EmailViewModal';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { PageHeader } from '@/components/ui/PageHeader';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { QueueFilters } from '@/components/ui/queue-page/QueueFilters';
import {
  FolderManagementCard,
  CreateFolderModal,
  EmailReviewInterface,
  QuickAdjustModal,
  FolderData,
  EmailExample,
  HardRule,
  EmailPreview,
  EmailCorrection,
  ReorganizationResult,
  PageMode,
  isWellDescribed
} from '@/components/ui/folder-management';
import { ConfirmDestructiveModal } from '@/components/ui/modals/ConfirmDestructiveModal';
import { groupItemsByMailbox, useQueueFilters } from '@/hooks/queue/useQueueFilters';

// Custom folder icon component that follows Lucide pattern
const CustomFolderIcon = React.forwardRef<SVGSVGElement, React.ComponentProps<'svg'>>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Main folder body with modern proportions */}
      <path d="M4 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-6l-2-2H4Z" />
      {/* Folder tab with better positioning */}
      <path d="M6 5h12" />
      {/* Content lines for visual appeal - positioned better */}
      <path d="M8 10h8" />
      <path d="M8 13h6" />
      <path d="M8 16h4" />
    </svg>
  )
);
CustomFolderIcon.displayName = 'CustomFolderIcon';


  // Helper: auto-reset a value after a delay with proper cleanup
  function useAutoReset<T>(value: T, reset: () => void, delayMs: number) {
    useEffect(() => {
      if (value == null) return;
      const timer = window.setTimeout(() => {
        reset();
      }, delayMs);
      return () => window.clearTimeout(timer);
    }, [value, reset, delayMs]);
  }

  // Helper: map API rule types to frontend condition types
  function mapApiTypeToCondition(apiType: string): import('@/components/ui/folder-management').HardRule['condition'] {
    switch (apiType) {
      case 'EMAIL': return 'sender';
      case 'DOMAIN': return 'domain';
      case 'SUBJECT': return 'subject';
      case 'SUBJECT_CONTAINS': return 'subject_contains';
      case 'SUBJECT_STARTS_WITH': return 'subject_starts_with';
      case 'SUBJECT_ENDS_WITH': return 'subject_ends_with';
      case 'SUBJECT_REGEX': return 'subject_regex';
      default: return 'sender';
    }
  }

// Types are now imported from folder-management components

export const FolderManagementPage: React.FC = () => {
  const { data: session } = useSession();
  // Core state
  const [folders, setFolders] = useState<FolderData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pageMode, setPageMode] = useState<PageMode>('management');
  
  // Individual loading states for better UX
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [pendingRuleFetch, setPendingRuleFetch] = useState<Set<string>>(new Set());
  
  // Folder management state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  
  // Email review state
  const [reviewData, setReviewData] = useState<EmailPreview[]>([]);
  const [corrections, setCorrections] = useState<EmailCorrection[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailPreview | null>(null);
  const [showQuickAdjust, setShowQuickAdjust] = useState(false);
  const [showEmailView, setShowEmailView] = useState(false);
  
  // Reorganization state
  const [reorganizationResult, setReorganizationResult] = useState<ReorganizationResult | null>(null);
  const [reorganizationProgress, setReorganizationProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  
  // Deletion confirmation state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [folderPendingDelete, setFolderPendingDelete] = useState<FolderData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  
  // Sort Now state
  const [sortingNow, setSortingNow] = useState(false);
  const [sortStatus, setSortStatus] = useState<{
    state: 'idle' | 'processing' | 'success' | 'error';
    message: string;
    details?: string;
    emailsProcessed?: number;
  }>({ state: 'idle', message: '' });
  const jobPollingRef = useRef<number | null>(null);
  const jobCompletedRef = useRef<boolean>(false);
  const fetchingDataRef = useRef<boolean>(false);
  // UI controls
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'emails'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [mailboxFilter, setMailboxFilter] = useState('all');

  const fetchFolderData = useCallback(async (
    opts?: { skipFolderSpinner?: boolean; userId?: string }
  ) => {
    // Prevent concurrent fetchFolderData calls to avoid cascading API requests
    if (fetchingDataRef.current) {
      console.log('🚫 Skipping fetchFolderData - already in progress');
      return;
    }
    
    try {
      fetchingDataRef.current = true;
      
      if (!opts?.skipFolderSpinner) {
        setFoldersLoading(true);
      }
      setRulesLoading(true);
      setError(null);
      
      const response = await fetch('/api/folders', {
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Transform API data to match our interface
        const baseFolders: FolderData[] = data.folders.map((folder: any) => {
          const instructionText = folder.metaPrompt ?? `Emails related to ${folder.name}`;
          return {
            id: folder.id,
            name: folder.name,
            description: instructionText,
            instruction: instructionText,
            color: folder.color,
            icon: getFolderIconWithFallback(folder.name, instructionText),
            emailCount: folder.emailCount || 0,
            isSystemDefault: folder.isSystemDefault || false,
            mailboxId: folder.mailboxId,
            mailboxEmail: folder.mailboxEmail,
            mailboxDisplayName: folder.mailboxDisplayName,
            hardRules: [],
            examples: [],
            confidence: folder.confidence || 90
          };
        });

        // Mark rules pending for all base folders immediately to avoid flicker
        setPendingRuleFetch(new Set(baseFolders.map((bf) => bf.id)));

        // Preserve any local changes that might be more recent than API data
        setFolders(prevFolders => {
          if (prevFolders.length === 0) {
            // First load - use API data directly
            return baseFolders;
          }
          
          // Merge with existing folders, preserving recent local edits
          return baseFolders.map(apiFolder => {
            const existingFolder = prevFolders.find(f => f.id === apiFolder.id);
            
            // If we have an existing folder with a well-described instruction 
            // and the API folder has a basic instruction, preserve the existing one
            if (existingFolder && 
                isWellDescribed(existingFolder) && 
                !isWellDescribed(apiFolder)) {
              console.log(`🔄 Preserving local edits for folder: ${existingFolder.name}`);
              return {
                ...apiFolder,
                instruction: existingFolder.instruction,
                description: existingFolder.description
              };
            }
            
            return apiFolder;
          });
        });
        setFoldersLoading(false);
        console.log('📁 Folder data loaded with local preservation:', baseFolders);

        // Persist lightweight folder metadata in cache for instant next paint
        const userId = opts?.userId || (session?.userId as string | undefined);
        if (userId) {
          FolderCache.setCached(
            userId,
            baseFolders.map((f) => ({
              id: f.id,
              name: f.name,
              color: f.color,
              emailCount: f.emailCount,
              isSystemDefault: f.isSystemDefault,
              instruction: f.instruction
            }))
          );
        }

        // Fetch hard rules for all folders using bulk endpoint; fallback to per-folder on error
        try {
          if (baseFolders.length > 0) {
            const folderIdsParam = baseFolders.map((f) => f.id).join(',');
            const bulkRes = await fetch(`/api/folders/rules/bulk?folderIds=${encodeURIComponent(folderIdsParam)}`, {
              headers: { 'Cache-Control': 'no-cache' }
            });

            if (bulkRes.ok) {
              const bulkJson = await bulkRes.json();
              const rulesByFolder: Record<string, any[]> = {};
              const foldersFromApi = Array.isArray(bulkJson.folders) ? bulkJson.folders : [];
              for (const entry of foldersFromApi) {
                rulesByFolder[entry.id] = Array.isArray(entry.rules) ? entry.rules : [];
              }

              setFolders((prev) =>
                prev.map((pf) => {
                  const apiRules = rulesByFolder[pf.id] || [];
                  const hardRules: import('@/components/ui/folder-management').HardRule[] = apiRules.map((r: any) => ({
                    id: r.id,
                    condition: mapApiTypeToCondition(r.type),
                    value: r.value,
                    action: 'move_to_folder',
                    targetFolderId: pf.id,
                  }));
                  return { ...pf, hardRules };
                })
              );

              // Clear pending set in one go
              setPendingRuleFetch(new Set());
              setRulesLoading(false);
            } else {
              // Fallback to per-folder fetch to avoid breaking UX
              await Promise.all(
                baseFolders.map(async (f) => {
                  try {
                    const rulesRes = await fetch(`/api/folders/${f.id}/rules`, {
                      headers: { 'Cache-Control': 'no-cache' }
                    });
                    if (rulesRes.ok) {
                      const rulesJson = await rulesRes.json();
                      const hardRules = Array.isArray(rulesJson.rules)
                        ? rulesJson.rules.map((r: any) => ({
                            id: r.id,
                            condition: mapApiTypeToCondition(r.type),
                            value: r.value,
                            action: 'move_to_folder',
                            targetFolderId: f.id
                          }))
                        : [];
                      setFolders((prev) => prev.map((pf) => (pf.id === f.id ? { ...pf, hardRules } : pf)));
                    }
                  } catch {}
                  finally {
                    setPendingRuleFetch((prev) => {
                      const next = new Set(prev);
                      next.delete(f.id);
                      return next;
                    });
                  }
                })
              );
              setRulesLoading(false);
            }
          } else {
            // No folders
            setPendingRuleFetch(new Set());
            setRulesLoading(false);
          }
        } catch (e) {
          // Fallback path if bulk call throws
          await Promise.all(
            baseFolders.map(async (f) => {
              try {
                const rulesRes = await fetch(`/api/folders/${f.id}/rules`, {
                  headers: { 'Cache-Control': 'no-cache' }
                });
                if (rulesRes.ok) {
                  const rulesJson = await rulesRes.json();
                  const hardRules = Array.isArray(rulesJson.rules)
                    ? rulesJson.rules.map((r: any) => ({
                        id: r.id,
                        condition: mapApiTypeToCondition(r.type),
                        value: r.value,
                        action: 'move_to_folder',
                        targetFolderId: f.id
                      }))
                    : [];
                  setFolders((prev) => prev.map((pf) => (pf.id === f.id ? { ...pf, hardRules } : pf)));
                }
              } catch {}
              finally {
                setPendingRuleFetch((prev) => {
                  const next = new Set(prev);
                  next.delete(f.id);
                  return next;
                });
              }
            })
          );
          setRulesLoading(false);
        }
      } else {
        setError(data.error || 'Failed to load folders');
        setFoldersLoading(false);
        setRulesLoading(false);
      }
    } catch (error) {
      console.error('Error fetching folder data:', error);
      setError('Failed to load folders. Please try again.');
      setFoldersLoading(false);
      setRulesLoading(false);
    } finally {
      fetchingDataRef.current = false;
    }
  }, [session?.userId]);

  useEffect(() => {
    // Early return until session is available to scope caches
    if (!session?.userId) return;

    // Start with loading state for initial mount
    setFoldersLoading(true);
    setRulesLoading(true);

    // Try to render instantly from FolderCache or LabelCache-derived placeholders
    let showedInstant = false;
    const cached = FolderCache.getCached(session.userId);
    if (cached.data?.folders?.length) {
      const instant = FolderCache.toFolderData(cached.data.folders);
      setFolders(instant);
      // Mark all shown folders as pending rules until fetched
      setPendingRuleFetch(new Set(instant.map((f) => f.id)));
      setFoldersLoading(false);
      showedInstant = true;
    } else {
      const placeholders = FolderCache.getPlaceholdersFromLabels(session.userId);
      if (placeholders && placeholders.length) {
        const instant = FolderCache.toFolderData(placeholders);
        setFolders(instant);
        setPendingRuleFetch(new Set(instant.map((f) => f.id)));
        setFoldersLoading(false);
        showedInstant = true;
      }
    }

    // Always fetch fresh folders; skip folder spinner if we already showed instant data
    fetchFolderData({ skipFolderSpinner: showedInstant, userId: session.userId });

    return () => {
      // Cleanup any running polling interval on unmount
      if (jobPollingRef.current) {
        window.clearInterval(jobPollingRef.current);
        jobPollingRef.current = null;
      }
      // Reset flags on unmount
      jobCompletedRef.current = false;
      fetchingDataRef.current = false;
    };
  }, [session?.userId, fetchFolderData]);

  const getFolderMailboxMeta = useCallback((folder: FolderData) => ({
    mailboxId: folder.mailboxId,
    mailboxEmail: folder.mailboxEmail,
    mailboxDisplayName: folder.mailboxDisplayName,
  }), []);

  const {
    filteredItems: mailboxFilteredFolders,
    mailboxOptions,
    isMailboxFilterActive,
  } = useQueueFilters({
    items: folders,
    mailboxFilter,
    getMailboxMeta: getFolderMailboxMeta,
  });

  const filteredSortedFolders = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    let result = mailboxFilteredFolders.filter((f) => {
      if (!normalizedQuery) return true;
      return (
        f.name.toLowerCase().includes(normalizedQuery) ||
        f.description.toLowerCase().includes(normalizedQuery)
      );
    });
    result = result.sort((a, b) => {
      if (sortBy === 'name') {
        return sortDir === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      // emails
      return sortDir === 'asc' ? a.emailCount - b.emailCount : b.emailCount - a.emailCount;
    });
    return result;
  }, [mailboxFilteredFolders, searchQuery, sortBy, sortDir]);

  const groupedFolders = useMemo(() => (
    groupItemsByMailbox({
      items: filteredSortedFolders,
      getMailboxMeta: getFolderMailboxMeta,
      mailboxOptions,
    })
  ), [filteredSortedFolders, getFolderMailboxMeta, mailboxOptions]);

  // Helper to persist current folders into cache
  const writeCacheFrom = useCallback((list: FolderData[]) => {
    if (!session?.userId) return;
    try {
      FolderCache.setCached(
        session.userId,
        list.map((f) => ({
          id: f.id,
          name: f.name,
          color: f.color,
          emailCount: f.emailCount,
          isSystemDefault: f.isSystemDefault,
          instruction: f.instruction,
          mailboxId: f.mailboxId,
          mailboxEmail: f.mailboxEmail,
          mailboxDisplayName: f.mailboxDisplayName,
        }))
      );
    } catch {}
  }, [session?.userId]);

  const runReorganization = useCallback(
    async ({
      folderId,
      folderName,
      instruction,
    }: {
      folderId: string;
      folderName: string;
      instruction: string;
    }) => {
      setSortStatus({
        state: 'processing',
        message: `Reorganizing emails into ${folderName}`,
        details: 'We will refresh your folders as soon as this completes.',
      });

      try {
        const response = await fetch('/api/folders/reorganize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newFolderId: folderId,
            newFolderInstruction: instruction,
          }),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
          throw new Error(
            payload?.error || `Reorganization request failed with status ${response.status}`
          );
        }

        const emailChanges = Array.isArray(payload?.data?.emailChanges)
          ? payload.data.emailChanges
          : [];

        const emailsMoved = emailChanges.reduce((total: number, change: any) => {
          const emails = Array.isArray(change?.emails) ? change.emails.length : 0;
          return total + emails;
        }, 0);

        setSortStatus({
          state: 'success',
          message:
            emailsMoved > 0
              ? `Reorganized ${emailsMoved} email${emailsMoved === 1 ? '' : 's'} into ${folderName}`
              : `No recent emails matched ${folderName}`,
          details:
            emailsMoved > 0
              ? 'Folder counts have been refreshed.'
              : 'Everything was already organized.',
          emailsProcessed: emailsMoved > 0 ? emailsMoved : undefined,
        });

        await fetchFolderData({ skipFolderSpinner: true });
      } catch (error) {
        setSortStatus({
          state: 'error',
          message: `Failed to reorganize ${folderName}`,
          details: error instanceof Error ? error.message : 'Unexpected error occurred',
        });
      }
    },
    [fetchFolderData]
  );

  const handleCreateFolder = async (newFolder: {
    name: string;
    description: string;
    icon: string;
    color: string;
    enableReorganization?: boolean;
  }) => {
    const fallbackDescription = `Emails related to ${newFolder.name.trim()}`;
    const instruction = (newFolder.description || fallbackDescription).trim() || fallbackDescription;

    let queuedReorganization: {
      folderId: string;
      folderName: string;
      instruction: string;
    } | null = null;

    try {
      setProcessing(true);
      setError(null);

      const createResponse = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolder.name,
          metaPrompt: instruction,
          color: newFolder.color,
        }),
      });

      const payload = await createResponse.json().catch(() => null);

      if (!createResponse.ok || !payload?.success || !payload?.folder) {
        const message = payload?.error || `Failed to create folder (status ${createResponse.status})`;
        throw new Error(message);
      }

      const serverFolder = payload.folder as {
        id: string;
        name: string;
        metaPrompt?: string;
        emailCount?: number;
        color?: string;
        isSystemDefault?: boolean;
        confidence?: number;
        mailboxId?: string;
        mailboxEmail?: string;
        mailboxDisplayName?: string;
      };

      queuedReorganization = newFolder.enableReorganization
        ? {
            folderId: serverFolder.id,
            folderName: serverFolder.name,
            instruction,
          }
        : null;

      const optimisticFolder: FolderData = {
        id: serverFolder.id,
        name: serverFolder.name,
        description: instruction,
        instruction,
        color: serverFolder.color || newFolder.color,
        icon: getFolderIconWithFallback(serverFolder.name, instruction),
        emailCount: serverFolder.emailCount || 0,
        isSystemDefault: Boolean(serverFolder.isSystemDefault),
        mailboxId: serverFolder.mailboxId,
        mailboxEmail: serverFolder.mailboxEmail,
        mailboxDisplayName: serverFolder.mailboxDisplayName,
        hardRules: [],
        examples: [],
        confidence: serverFolder.confidence ?? 90,
      };

      setFolders((prev) => {
        const withoutExisting = prev.filter((folder) => folder.id !== optimisticFolder.id);
        const next = [...withoutExisting, optimisticFolder];
        writeCacheFrom(next);
        return next;
      });

      setPendingRuleFetch((prev) => {
        const next = new Set(prev);
        next.add(serverFolder.id);
        return next;
      });

      LabelCache.invalidate();
      setShowCreateModal(false);

      await fetchFolderData({ skipFolderSpinner: true });
    } catch (error) {
      console.error('Error creating folder:', error);
      setError(error instanceof Error ? error.message : 'Failed to create folder');
    } finally {
      setProcessing(false);
    }

    if (queuedReorganization) {
      void runReorganization(queuedReorganization);
    }
  };

  const handleSortNow = async () => {
    try {
      setSortingNow(true);
      setSortStatus({
        state: 'processing',
        message: 'Analyzing your inbox...',
        details: 'This may take a few moments'
      });
      setError(null);
      
      // Reset job completion flag for new sort operation
      jobCompletedRef.current = false;
      
      console.log('🚀 Triggering Sort Now for user');
      
      const response = await fetch('/api/folders/sort-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        setSortStatus({
          state: 'processing',
          message: 'Sorting emails into folders...',
          details: 'AI is organizing your emails based on folder rules'
        });
        console.log(`📥 Sort Now enqueued:`, data);

        // Begin lightweight polling of batch job status for a short window
        if (jobPollingRef.current) {
          window.clearInterval(jobPollingRef.current);
          jobPollingRef.current = null;
        }
        const intervalId = window.setInterval(async () => {
          try {
            const statusRes = await fetch('/api/batch-jobs/status');
            if (statusRes.ok) {
              const statusJson = await statusRes.json();
              if (statusJson?.success) {
                // Only process job completion once to prevent cascading API calls
                if (!statusJson.data?.hasRunningJob && !jobCompletedRef.current) {
                  console.log('✅ Sort job completed - processing results once');
                  
                  // Mark job as completed FIRST to prevent race conditions
                  jobCompletedRef.current = true;
                  
                  // Stop polling immediately
                  window.clearInterval(intervalId);
                  jobPollingRef.current = null;
                  
                  // Show success state
                  setSortStatus({
                    state: 'success',
                    message: 'Sorting completed successfully!',
                    details: 'Your emails have been organized into folders',
                    emailsProcessed: statusJson.data?.emailsProcessed
                  });
                  
                  // Refresh folders to show updated counts (with deduplication protection)
                  await fetchFolderData();
                }
              }
            }
          } catch (error) {
            console.error('Error during status polling:', error);
          }
        }, 5000); // Increased interval to 5 seconds to reduce server load
        jobPollingRef.current = intervalId;
      } else {
        throw new Error(data.error || 'Sort failed');
      }
      
    } catch (error) {
      console.error('Error during Sort Now:', error);
      setSortStatus({
        state: 'error',
        message: 'Failed to sort emails',
        details: error instanceof Error ? error.message : 'An unexpected error occurred'
      });
      setError(error instanceof Error ? error.message : 'Sort failed');
    } finally {
      setSortingNow(false);
    }
  };

  // Auto-hide sort status after 15 seconds for success/error states only
  useAutoReset(
    sortStatus.state === 'success' || sortStatus.state === 'error' ? sortStatus : null,
    () => setSortStatus({ state: 'idle', message: '' }),
    15000
  );

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      try {
        const response = await fetch(`/api/folders/${folderId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const message = typeof payload?.error === 'string' ? payload.error : 'Failed to delete folder';
          throw new Error(message);
        }

        setFolders((prev) => {
          const updated = prev.filter((folder) => folder.id !== folderId);
          writeCacheFrom(updated);
          return updated;
        });

        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });

        setPendingRuleFetch((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      } catch (error) {
        console.error('Error deleting folder:', error);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Failed to delete folder');
      }
    },
    [writeCacheFrom]
  );

  const requestFolderDelete = useCallback((folder: FolderData) => {
    setDeleteError('');
    setFolderPendingDelete(folder);
    setDeleteModalOpen(true);
  }, []);

  const closeDeleteModal = useCallback(() => {
    if (deleteLoading) return;
    setDeleteModalOpen(false);
    setFolderPendingDelete(null);
    setDeleteError('');
  }, [deleteLoading]);

  const confirmDeleteFolder = useCallback(async () => {
    if (!folderPendingDelete) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await handleDeleteFolder(folderPendingDelete.id);
      setDeleteModalOpen(false);
      setFolderPendingDelete(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete folder';
      setDeleteError(message);
    } finally {
      setDeleteLoading(false);
    }
  }, [folderPendingDelete, handleDeleteFolder]);

  const handleEmailCorrection = async (email: EmailPreview, newFolderId: string, shouldLearn: boolean = false, reason?: string) => {
    const correction: EmailCorrection = {
      emailId: email.id,
      emailFrom: email.from,
      fromFolder: email.suggestedFolder,
      toFolder: newFolderId,
      shouldLearn,
      reason
    };
    
    setCorrections(prev => [...prev, correction]);
    
    // Update the email in review data
    setReviewData(prev => prev.map(e => 
      e.id === email.id ? { ...e, suggestedFolder: newFolderId } : e
    ));
  };

  const handleFinishReview = async () => {
    try {
      setProcessing(true);
      
      if (corrections.length > 0) {
        const response = await fetch('/api/onboarding/inbox-review/correct-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections })
        });
        
        if (!response.ok) {
          throw new Error('Failed to apply corrections');
        }
      }
      
      // Return to management mode
      setPageMode('management');
      setReviewData([]);
      setCorrections([]);
      setReorganizationResult(null);
      
      // Refresh folder data
      await fetchFolderData();
      
    } catch (error) {
      console.error('Error finishing review:', error);
      setError('Failed to apply changes');
    } finally {
      setProcessing(false);
    }
  };


  // No more full-screen loading - UI shows immediately

  if (error) {
    return (
      <div className="min-h-screen flex flex-col bg-black">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="relative group">
              <GlowingEffect
                blur={0}
                borderWidth={2}
                spread={60}
                glow={true}
                disabled={false}
              />
              <div className="relative bg-black/80 backdrop-blur-xl border border-red-800/50 rounded-3xl p-8 shadow-2xl">
                <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">Failed to Load</h2>
                <p className="text-gray-300 mb-6">{error}</p>
                <PrimaryButton 
                  onClick={() => fetchFolderData()}
                  minWidth="lg"
                >
                  Try Again
                </PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render different modes
  if (pageMode === 'review') {
    return (
      <EmailReviewInterface 
        reviewData={reviewData}
        folders={folders}
        corrections={corrections}
        onEmailCorrection={handleEmailCorrection}
        onFinishReview={handleFinishReview}
        onBackToManagement={() => setPageMode('management')}
        processing={processing}
        selectedEmail={selectedEmail}
        setSelectedEmail={setSelectedEmail}
        showQuickAdjust={showQuickAdjust}
        setShowQuickAdjust={setShowQuickAdjust}
        showEmailView={showEmailView}
        setShowEmailView={setShowEmailView}
        reorganizationResult={reorganizationResult}
      />
    );
  }

  const showMailboxGrouping = mailboxOptions.length > 1 || isMailboxFilterActive;

  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Mobile Header - Fixed */}
      <MobileHeader title="Folder Management">
        <LiquidButton
          onClick={() => fetchFolderData()}
          disabled={processing || sortingNow || foldersLoading}
          minWidth="none"
          size="icon"
          className="h-8 w-8 rounded-full text-sky-100"
          aria-label="Refresh folders"
          variant="default"
          type="button"
        >
          <RefreshCw size={14} className={`${processing || foldersLoading ? 'animate-spin' : ''}`} />
        </LiquidButton>
      </MobileHeader>

      <div className="flex-1 space-y-8 w-full max-w-none p-8 pt-24 sm:pt-8 relative z-10">
        {/* Header */}
        <PageHeader
          title="Folder Management"
          subtitle="Organize your emails with smart folders that automatically sort your inbox."
          icon={CustomFolderIcon}
          iconColor="text-blue-300"
        />

        {/* Action Buttons */}
        {pageMode === 'management' && (
          <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-3">
            <LiquidButton
              onClick={() => fetchFolderData()}
              disabled={processing || sortingNow || foldersLoading}
              minWidth="sm"
              responsive
              variant="default"
              size="lg"
              aria-label="Refresh folders"
              className={LIQUID_BUTTON_BASE_CLASS}
              type="button"
            >
              <span className="flex items-center gap-2">
                <RefreshCw className={`w-4 h-4 ${processing || foldersLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{processing ? 'Loading...' : foldersLoading ? 'Loading...' : 'Refresh'}</span>
              </span>
            </LiquidButton>
            <PrimaryButton
              onClick={handleSortNow}
              disabled={sortingNow || processing || foldersLoading}
              minWidth="md"
              aria-label="Sort emails now using always-on mapping"
            >
              <Zap className={`w-4 h-4 fill-current ${sortingNow ? 'animate-pulse' : ''}`} />
              <span>{sortingNow ? 'Sorting...' : 'Sort Now'}</span>
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setShowCreateModal(true)}
              disabled={processing || foldersLoading}
              minWidth="md"
              className="!bg-[hsl(var(--sidebar-primary))] !text-[hsl(var(--sidebar-primary-foreground))] hover:!bg-[hsl(var(--sidebar-primary))] hover:brightness-110 active:brightness-95 focus-visible:ring-[hsl(var(--sidebar-primary)/0.35)]"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Create </span>
              <span>Folder</span>
            </PrimaryButton>
          </div>
        )}

        {pageMode === 'management' && (
          <QueueFilters
            mailboxFilter={mailboxFilter}
            onMailboxFilterChange={setMailboxFilter}
            mailboxOptions={mailboxOptions}
            filteredCount={filteredSortedFolders.length}
            totalCount={folders.length}
            itemLabel="folder"
            summarySuffix="available"
          />
        )}

        {/* Search and Sort Controls */}
        {pageMode === 'management' && (
          <div className="flex flex-col space-y-3 md:flex-row md:space-y-0 md:items-center md:justify-between md:gap-4">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={foldersLoading ? "Loading folders..." : "Search folders..."}
                  disabled={foldersLoading}
                  className={`w-full bg-gray-900/60 border-2 border-gray-700/50 rounded-xl pl-4 pr-10 py-3 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all ${
                    foldersLoading ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
                {foldersLoading ? (
                  <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 whitespace-nowrap">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'name' | 'emails')}
                  disabled={foldersLoading}
                  className={`bg-gray-900/60 border-2 border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition-all ${
                    foldersLoading ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <option value="name">Name</option>
                  <option value="emails">Email count</option>
                </select>
              </div>
              <LiquidButton
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                disabled={foldersLoading}
                minWidth="sm"
                responsive
                variant="default"
                size="lg"
                aria-label="Toggle sort direction"
                className="rounded-2xl px-4 text-sm font-semibold text-sky-100"
                type="button"
              >
                <span className="flex items-center gap-2">
                  <ArrowUpDown className="w-4 h-4" />
                  <span className="hidden sm:inline">{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>
                </span>
              </LiquidButton>
            </div>
          </div>
        )}

        {/* Sort Status Notification */}
        {sortStatus.state !== 'idle' && (
          <div className="mb-6">
            <div className={`p-4 rounded-xl border backdrop-blur-sm ${
              sortStatus.state === 'processing' 
                ? 'bg-blue-900/20 border-blue-800/40' 
                : sortStatus.state === 'success'
                ? 'bg-green-900/20 border-green-800/40'
                : 'bg-red-900/20 border-red-800/40'
            }`}>
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-0.5">
                  {sortStatus.state === 'processing' ? (
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                  ) : sortStatus.state === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${
                    sortStatus.state === 'processing' 
                      ? 'text-blue-300' 
                      : sortStatus.state === 'success'
                      ? 'text-green-300'
                      : 'text-red-300'
                  }`}>
                    {sortStatus.message}
                  </p>
                  {sortStatus.details && (
                    <p className={`text-sm mt-1 ${
                      sortStatus.state === 'processing' 
                        ? 'text-blue-400/80' 
                        : sortStatus.state === 'success'
                        ? 'text-green-400/80'
                        : 'text-red-400/80'
                    }`}>
                      {sortStatus.details}
                    </p>
                  )}
                  {sortStatus.emailsProcessed && (
                    <p className="text-sm text-green-400/80 mt-1">
                      📧 {sortStatus.emailsProcessed} emails organized
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}


        {/* Processing Progress */}
        {pageMode === 'reorganizing' && (
          <div className="mb-8">
            <div className="bg-blue-900/20 border border-blue-800/40 rounded-2xl p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <h3 className="text-lg font-semibold text-blue-400">Email Reorganization in Progress</h3>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${reorganizationProgress}%` }}
                ></div>
              </div>
              <p className="text-gray-300 text-sm">Analyzing your emails and organizing them into folders...</p>
            </div>
          </div>
        )}

        {/* Folder Management Section */}
        {pageMode === 'management' && (
          <div className="space-y-8">
            <div className="relative group text-center mb-8">
              <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/8 via-blue-400/12 to-blue-500/8 rounded-2xl blur-xl"></div>
              <h2 className="relative text-3xl font-bold text-white">Your Folders</h2>
              <div className="relative w-24 h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent mx-auto mt-2"></div>
            </div>
            
            <div className="grid grid-cols-1 gap-4 md:gap-6">
              {foldersLoading ? (
                <div className="space-y-4">
                  {/* Loading skeleton cards */}
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="relative group transition-transform duration-300 will-change-transform animate-pulse w-full min-w-0 max-w-full">
                      <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg transition-all duration-500"></div>
                      <div className="relative rounded-3xl border border-gray-800/50 bg-black/80 backdrop-blur-md shadow-2xl min-h-[100px] md:min-h-[120px]">
                        <div className="relative bg-black/70 border-2 border-gray-800/70 rounded-2xl p-4 md:p-6 backdrop-blur-sm shadow-inner">
                          <div className="flex flex-col space-y-3 md:flex-row md:space-y-0 md:items-center md:justify-between">
                            <div className="flex items-center space-x-3 md:space-x-4 flex-1">
                              <div className="text-xl md:text-2xl bg-gray-700 rounded-lg w-6 h-6 md:w-8 md:h-8 animate-pulse flex-shrink-0"></div>
                              <div className="flex-1 space-y-2 md:space-y-3">
                                <div className="h-5 md:h-6 bg-gray-700 rounded-lg w-24 md:w-32 animate-pulse"></div>
                                <div className="h-3 md:h-4 bg-gray-700 rounded-lg w-32 md:w-48 animate-pulse"></div>
                              </div>
                            </div>
                            <div className="w-6 h-6 md:w-8 md:h-8 bg-gray-700 rounded-lg animate-pulse flex-shrink-0 self-end md:self-center"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredSortedFolders.length === 0 ? (
                isMailboxFilterActive ? (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 md:p-8 text-center">
                    <Folder className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                    <p className="text-gray-300 text-sm mb-2">No folders match this inbox.</p>
                    <button
                      type="button"
                      onClick={() => setMailboxFilter('all')}
                      className="text-xs text-blue-300 hover:text-blue-200 transition-colors cursor-pointer"
                    >
                      Clear inbox filter
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 md:p-8 text-center">
                    <Folder className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm mb-1">No folders found</p>
                    <p className="text-gray-500 text-xs">Try adjusting your search or create a new folder</p>
                  </div>
                )
              ) : (
                (() => {
                  const renderQualitySections = (items: FolderData[], delayOffset = 0) => {
                    const wellDescribed = items.filter(isWellDescribed);
                    const underDescribed = items.filter((f) => !isWellDescribed(f));

                    return (
                      <div className="space-y-8">
                        {/* Well-described folders section */}
                        {wellDescribed.length > 0 && (
                          <div className="space-y-4 md:space-y-6">
                            <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:items-center sm:space-x-3 mb-4 md:mb-6">
                              <div className="flex items-center space-x-2">
                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                <h3 className="text-lg font-semibold text-white">Smart Folders</h3>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:gap-4">
                              {wellDescribed.map((folder, index) => (
                                <div
                                  key={folder.id}
                                  className="w-full min-w-0 max-w-full"
                                  style={{ animationDelay: `${delayOffset + index * 100}ms` }}
                                >
                                  <FolderManagementCard
                                    folder={folder}
                                    expanded={expandedFolders.has(folder.id)}
                                    onToggleExpand={() => toggleFolder(folder.id)}
                                    onUpdate={(updatedFolder) => {
                                      setFolders((prev) => {
                                        const updated = prev.map((f) => (f.id === folder.id ? updatedFolder : f));
                                        writeCacheFrom(updated);
                                        return updated;
                                      });
                                    }}
                                    onRequestDelete={requestFolderDelete}
                                    deleteInProgress={deleteLoading && folderPendingDelete?.id === folder.id}
                                    editing={editingFolder === folder.id}
                                    onEdit={(folderId) => setEditingFolder(folderId)}
                                    onCancelEdit={() => setEditingFolder(null)}
                                    rulesLoading={rulesLoading}
                                    rulesPending={pendingRuleFetch.has(folder.id)}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Under-described folders section */}
                        {underDescribed.length > 0 && (
                          <div className="space-y-4 md:space-y-6">
                            <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:items-center sm:space-x-3 mb-4 md:mb-6">
                              <div className="flex items-center space-x-2">
                                <AlertCircle className="w-5 h-5 text-amber-400" />
                                <h3 className="text-lg font-semibold text-white">Basic Folders</h3>
                              </div>
                              <span className="text-xs text-amber-300 bg-amber-900/30 px-2 py-1 rounded border border-amber-800/40 font-medium">
                                Basic sorting - improve with descriptions
                              </span>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:gap-4">
                              {underDescribed.map((folder, index) => (
                                <div
                                  key={folder.id}
                                  className="w-full min-w-0 max-w-full"
                                  style={{ animationDelay: `${delayOffset + (index + wellDescribed.length) * 100}ms` }}
                                >
                                  <FolderManagementCard
                                    folder={folder}
                                    expanded={expandedFolders.has(folder.id)}
                                    onToggleExpand={() => toggleFolder(folder.id)}
                                    onUpdate={(updatedFolder) => {
                                      setFolders((prev) => {
                                        const updated = prev.map((f) => (f.id === folder.id ? updatedFolder : f));
                                        writeCacheFrom(updated);
                                        return updated;
                                      });
                                    }}
                                    onRequestDelete={requestFolderDelete}
                                    deleteInProgress={deleteLoading && folderPendingDelete?.id === folder.id}
                                    editing={editingFolder === folder.id}
                                    onEdit={(folderId) => setEditingFolder(folderId)}
                                    onCancelEdit={() => setEditingFolder(null)}
                                    rulesLoading={rulesLoading}
                                    rulesPending={pendingRuleFetch.has(folder.id)}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  };

                  if (!showMailboxGrouping) {
                    return renderQualitySections(filteredSortedFolders);
                  }

                  return (
                    <div className="space-y-10">
                      {groupedFolders.map((group, groupIndex) => {
                        const delayOffset = groupIndex * 80;
                        return (
                          <section key={group.key} className="space-y-6">
                            <div className="sticky top-24 sm:top-8 z-20">
                              <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-gray-800/70 bg-black/80 px-4 py-3 backdrop-blur-md shadow-lg">
                                <div className="flex items-center gap-3">
                                  <span className="text-[11px] uppercase tracking-[0.3em] text-gray-500">Inbox</span>
                                  <span className="text-sm font-semibold text-white">{group.label}</span>
                                </div>
                                <div className="flex-1 h-px bg-gradient-to-r from-blue-500/40 via-blue-400/10 to-transparent"></div>
                                <span className="text-xs text-gray-400">
                                  {group.items.length} folder{group.items.length === 1 ? '' : 's'}
                                </span>
                              </div>
                            </div>
                            {renderQualitySections(group.items, delayOffset)}
                          </section>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        )}
        
        {/* Create Folder Modal */}
        {showCreateModal && (
          <CreateFolderModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateFolder}
            processing={processing}
            existingNames={folders.map(f => f.name.toLowerCase())}
          />
        )}
        
        {/* Email View Modal */}
        {showEmailView && selectedEmail && (
          <EmailViewModal
            email={selectedEmail}
            onClose={() => {
              setShowEmailView(false);
              setSelectedEmail(null);
            }}
            onQuickAdjust={() => {
              setShowEmailView(false);
              setShowQuickAdjust(true);
            }}
          />
        )}
        
        {/* Quick Adjust Modal */}
        {showQuickAdjust && selectedEmail && (
          <QuickAdjustModal
            email={selectedEmail}
            folders={folders}
            onClose={() => {
              setShowQuickAdjust(false);
              setSelectedEmail(null);
            }}
            onCorrect={handleEmailCorrection}
            processing={processing}
          />
        )}

        <ConfirmDestructiveModal
          open={deleteModalOpen && Boolean(folderPendingDelete)}
          title="Delete folder"
          description={(
            <div className="space-y-2 text-sm">
              <p>
                Are you sure you want to delete
                <span className="text-white font-semibold"> {folderPendingDelete?.name}</span>? This will also remove the associated Gmail label.
              </p>
              <p className="text-gray-400">This action cannot be undone.</p>
            </div>
          )}
          onConfirm={confirmDeleteFolder}
          onCancel={closeDeleteModal}
          loading={deleteLoading}
          confirmLabel="Delete"
          error={deleteError}
        />
      </div>

    </div>
  );
}

// Components are now imported from folder-management UI directory
