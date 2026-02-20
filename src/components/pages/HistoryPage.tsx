'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Clock, X, ShieldCheck, Trash2, Edit3, Settings, AlertTriangle, Mail, ArrowRight, CheckCircle, Activity, MessageSquare } from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { useSession } from 'next-auth/react';
import { usePageData } from '@/contexts/PageDataContext';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';


interface HistoryItem {
  id: string;
  actionType: string;
  actionSummary: string;
  timestamp: string;
  fullContext: string;
  promptState: string;
  feedback: string;
  confidence?: number;
  emailReference?: string;
}

export const HistoryPage: React.FC = () => {
  const { data: session } = useSession();
  const { cachePageData, getCachedData, setPageLoading } = usePageData();
  const [filter, setFilter] = useState('7'); // Days filter: '1', '7', '30'
  const [actionTypeFilter, setActionTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistoryViewer, setShowHistoryViewer] = useState<HistoryItem | null>(null);
  
  const fullName = session?.user?.name ?? '';
  const firstName = fullName.split(' ')[0] || 'there';
  
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? 'morning'
      : hour < 18
      ? 'afternoon'
      : 'evening';

  const fetchHistoryItems = useCallback(async (forceRefresh = false) => {
    try {
      const cacheKey = `history-${filter}-${actionTypeFilter}`;
      
      // Check cache first if not forcing refresh
      if (!forceRefresh) {
        const cachedData = getCachedData<{ historyItems: HistoryItem[] }>(cacheKey);
        if (cachedData?.historyItems) {
          setHistoryItems(cachedData.historyItems);
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      setPageLoading('history', true);
      
      const params = new URLSearchParams({
        days: filter,
        actionType: actionTypeFilter
      });
      
      const response = await fetch(`/api/action-history?${params}`);
      const data = await response.json();
      
      if (data.success) {
        const items = data.historyItems || [];
        setHistoryItems(items);
        // Cache the data with filter-specific key
        cachePageData(cacheKey, { historyItems: items });
      } else {
        console.error('Failed to fetch history items:', data.error);
        setHistoryItems([]);
      }
    } catch (error) {
      console.error('Error fetching history items:', error);
      setHistoryItems([]);
    } finally {
      setLoading(false);
      setPageLoading('history', false);
    }
  }, [filter, actionTypeFilter, getCachedData, cachePageData, setPageLoading]);

  // Fetch history items on component mount and when filters change
  useEffect(() => {
    fetchHistoryItems();
  }, [fetchHistoryItems]);

  const filteredHistory = historyItems.filter(item => {
    if (searchTerm && !item.actionSummary.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });
  
  // Get icon for action type
  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'EMAIL_SENT':
        return <ShieldCheck className="text-emerald-500" size={16} />;
      case 'EMAIL_EDITED':
        return <Edit3 className="text-blue-500" size={16} />;
      case 'EMAIL_REJECTED':
        return <Trash2 className="text-red-500" size={16} />;
      case 'EMAIL_SNOOZED':
        return <Clock className="text-amber-500" size={16} />;
      case 'MASTER_PROMPT_UPDATED':
        return <Settings className="text-purple-500" size={16} />;
      default:
        return <AlertTriangle className="text-gray-500" size={16} />;
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  // History Viewer Component (similar to EmailViewer in QueuePage)
  const HistoryViewer: React.FC<{ item: HistoryItem; onClose: () => void }> = ({ item, onClose }) => {
    let actionDetails: any = {};
    try {
      actionDetails = item?.fullContext ? JSON.parse(item.fullContext) ?? {} : {};
    } catch {
      actionDetails = {};
    }

    // Lock all scrolling except within modal content and handle overscroll
    useEffect(() => {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';

      const preventScroll = (e: WheelEvent | TouchEvent) => {
        const target = e.target as Element;
        const scrollableContent = target.closest('.modal-scrollable-content') as HTMLElement | null;
        if (!scrollableContent) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e instanceof WheelEvent) {
          const { scrollTop, scrollHeight, clientHeight } = scrollableContent;
          const isUp = e.deltaY < 0;
          const isDown = e.deltaY > 0;
          if ((isUp && scrollTop === 0) || (isDown && scrollTop + clientHeight >= scrollHeight)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      };

      document.addEventListener('wheel', preventScroll, { passive: false });
      document.addEventListener('touchmove', preventScroll, { passive: false });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', onKey);

      return () => {
        document.body.style.overflow = originalStyle;
        document.removeEventListener('wheel', preventScroll);
        document.removeEventListener('touchmove', preventScroll);
        document.removeEventListener('keydown', onKey);
      };
    }, [onClose]);
    
    // Helper function to safely get nested values
    const getDetail = (obj: any, path: string, fallback: string = 'N/A') => {
      try {
        return path.split('.').reduce((o, i) => o?.[i], obj) || fallback;
      } catch {
        return fallback;
      }
    };

    // Parse feedback JSON and extract useful information
    const parseFeedbackData = () => {
      try {
        if (item.feedback && item.feedback !== 'No additional details') {
          const parsed = JSON.parse(item.feedback);
          return parsed;
        }
        return null;
      } catch {
        return null;
      }
    };

    const feedbackData = parseFeedbackData();

    // Render feedback data in a structured way
    const renderFeedbackSection = () => {
      if (!feedbackData) return null;

      return (
        <div className="relative bg-blue-900/20 border-2 border-blue-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
          <h4 className="text-lg font-bold text-blue-400 mb-4 flex items-center">
            <MessageSquare size={18} className="mr-3" />
            Additional Information
          </h4>
          
          <div className="space-y-4">
            {/* Sender & Subject Info */}
            {(feedbackData.sender || feedbackData.subject) && (
              <div className="flex flex-col space-y-4 sm:grid sm:grid-cols-2 sm:space-y-0 sm:gap-4">
                {feedbackData.sender && (
                  <div className="bg-gray-900/60 rounded-xl border border-blue-700/30 p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <div className="w-6 h-6 bg-blue-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                        <Mail size={12} className="text-blue-400" />
                      </div>
                      <span className="text-xs text-blue-300 font-medium">Sender</span>
                    </div>
                    <p className="text-sm text-gray-200 break-all">{feedbackData.sender}</p>
                  </div>
                )}
                
                {feedbackData.subject && (
                  <div className="bg-gray-900/60 rounded-xl border border-blue-700/30 p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <div className="w-6 h-6 bg-blue-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                        <MessageSquare size={12} className="text-blue-400" />
                      </div>
                      <span className="text-xs text-blue-300 font-medium">Subject</span>
                    </div>
                    <p className="text-sm text-gray-200 break-words">{feedbackData.subject}</p>
                  </div>
                )}
              </div>
            )}

            {/* Feedback Details */}
            {feedbackData.feedback && (
              <div className="bg-gray-900/60 rounded-xl border border-blue-700/30 p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <div className="w-6 h-6 bg-blue-900/40 rounded-full flex items-center justify-center">
                    <Edit3 size={12} className="text-blue-400" />
                  </div>
                  <span className="text-xs text-blue-300 font-medium">User Feedback</span>
                </div>
                <p className="text-sm text-gray-200 leading-relaxed">{feedbackData.feedback}</p>
              </div>
            )}

            {/* Feedback Analysis */}
            {feedbackData.feedbackAnalysis && (
              <div className="bg-gray-900/60 rounded-xl border border-blue-700/30 p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <div className="w-6 h-6 bg-blue-900/40 rounded-full flex items-center justify-center">
                    <Activity size={12} className="text-blue-400" />
                  </div>
                  <span className="text-xs text-blue-300 font-medium">Feedback Analysis</span>
                </div>
                <div className="flex flex-col space-y-3 sm:grid sm:grid-cols-3 sm:space-y-0 sm:gap-3">
                  <div className="text-center">
                    <p className="text-xs text-gray-400">Length</p>
                    <p className="text-sm text-white font-semibold">{feedbackData.feedbackAnalysis.feedbackLength} chars</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-400">Type</p>
                    <p className="text-sm text-white font-semibold">
                      {feedbackData.feedbackAnalysis.hasSpecificFeedback ? 'Detailed' : 'Brief'}
                    </p>
                  </div>
                  {feedbackData.feedbackAnalysis.commonKeywords && (
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Keywords</p>
                      <p className="text-sm text-white font-semibold truncate">
                        {feedbackData.feedbackAnalysis.commonKeywords.slice(0, 2).join(', ')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI Metrics */}
            {feedbackData.aiMetrics && (
              <div className="bg-gray-900/60 rounded-xl border border-blue-700/30 p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <div className="w-6 h-6 bg-blue-900/40 rounded-full flex items-center justify-center">
                    <CheckCircle size={12} className="text-blue-400" />
                  </div>
                  <span className="text-xs text-blue-300 font-medium">AI Performance</span>
                </div>
                <div className="flex flex-col space-y-3 sm:grid sm:grid-cols-2 sm:space-y-0 sm:gap-3">
                  {feedbackData.aiMetrics.originalConfidence && (
                    <div>
                      <p className="text-xs text-gray-400">Original Confidence</p>
                      <p className="text-sm text-white font-semibold">
                        {(feedbackData.aiMetrics.originalConfidence * 100).toFixed(0)}%
                      </p>
                    </div>
                  )}
                  {feedbackData.aiMetrics.draftLength && (
                    <div>
                      <p className="text-xs text-gray-400">Draft Length</p>
                      <p className="text-sm text-white font-semibold">
                        {feedbackData.aiMetrics.draftLength} chars
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Rejection Details */}
            {feedbackData.rejectionType && (
              <div className="bg-gray-900/60 rounded-xl border border-blue-700/30 p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <div className="w-6 h-6 bg-blue-900/40 rounded-full flex items-center justify-center">
                    <AlertTriangle size={12} className="text-blue-400" />
                  </div>
                  <span className="text-xs text-blue-300 font-medium">Rejection Details</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-400">Type:</span>
                  <span className="text-xs text-blue-300 bg-blue-900/40 px-2 py-1 rounded-full">
                    {feedbackData.rejectionType}
                  </span>
                </div>
              </div>
            )}

            {/* Feedback Category */}
            {feedbackData.feedbackCategory && (
              <div className="bg-gray-900/60 rounded-xl border border-blue-700/30 p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <div className="w-6 h-6 bg-blue-900/40 rounded-full flex items-center justify-center">
                    <Settings size={12} className="text-blue-400" />
                  </div>
                  <span className="text-xs text-blue-300 font-medium">Feedback Category</span>
                </div>
                <span className="text-xs text-blue-300 bg-blue-900/40 px-3 py-1 rounded-full">
                  {feedbackData.feedbackCategory}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    };

    // Format the action details based on action type
    const renderActionDetails = () => {
      switch (item.actionType) {
        case 'EMAIL_SENT':
        case 'EMAIL_EDITED':
          return (
            <div className="space-y-6">
              {/* Email Details */}
              <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                <h4 className="text-lg font-bold text-blue-400 mb-4 flex items-center">
                  <Mail size={18} className="mr-3" />
                  Email Details
                </h4>
                <div className="flex flex-col space-y-4 sm:grid sm:grid-cols-2 sm:space-y-0 sm:gap-4 text-sm">
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">From:</span>
                      <span className="text-gray-200 break-all">{getDetail(actionDetails, 'emailFrom')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Subject:</span>
                      <span className="text-gray-200 break-words">{getDetail(actionDetails, 'emailSubject')}</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Action:</span>
                      <span className="text-gray-300 break-words">{item.actionSummary}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Was Edited:</span>
                      <span className="text-gray-300">{getDetail(actionDetails, 'wasEdited') ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Response */}
              {actionDetails.finalContent && (
                <div className="relative bg-emerald-900/20 border-2 border-emerald-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                  <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                  <h4 className="text-lg font-bold text-emerald-400 mb-4 flex items-center">
                    <CheckCircle size={18} className="mr-3" />
                    AI Generated Response
                  </h4>
                  <div className="bg-gray-900/60 rounded-xl border border-emerald-700/50 p-4 max-h-64 overflow-y-auto shadow-inner">
                    <div className="whitespace-pre-wrap text-sm text-gray-200 leading-relaxed">
                      {actionDetails.finalContent}
                    </div>
                  </div>
                </div>
              )}

              {/* Original Draft (if different from final) */}
              {actionDetails.originalDraft && actionDetails.originalDraft !== actionDetails.finalContent && (
                <div className="relative bg-blue-900/20 border-2 border-blue-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                  <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                  <h4 className="text-lg font-bold text-blue-400 mb-4 flex items-center">
                    <Edit3 size={18} className="mr-3" />
                    Original AI Draft
                  </h4>
                  <div className="bg-gray-900/60 rounded-xl border border-blue-700/50 p-4 max-h-48 overflow-y-auto shadow-inner">
                    <div className="whitespace-pre-wrap text-sm text-gray-200 leading-relaxed">
                      {actionDetails.originalDraft}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );

        case 'EMAIL_REJECTED':
          return (
            <div className="space-y-6">
              {/* Email Details */}
              <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                <h4 className="text-lg font-bold text-blue-400 mb-4 flex items-center">
                  <Mail size={18} className="mr-3" />
                  Rejected Email
                </h4>
                <div className="flex flex-col space-y-4 sm:grid sm:grid-cols-2 sm:space-y-0 sm:gap-4 text-sm">
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">From:</span>
                      <span className="text-gray-200 break-all">{getDetail(actionDetails, 'emailFrom')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Subject:</span>
                      <span className="text-gray-200 break-words">{getDetail(actionDetails, 'emailSubject')}</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Action:</span>
                      <span className="text-gray-300 break-words">{item.actionSummary}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rejection Reason */}
              {actionDetails.rejectionReason && (
                <div className="relative bg-red-900/20 border-2 border-red-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                  <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                  <h4 className="text-lg font-bold text-red-400 mb-4 flex items-center">
                    <AlertTriangle size={18} className="mr-3" />
                    Why Was This Rejected?
                  </h4>
                  <div className="bg-gray-900/60 rounded-xl border border-red-700/50 p-4">
                    <p className="text-sm text-red-300 leading-relaxed">
                      {actionDetails.rejectionReason}
                    </p>
                  </div>
                </div>
              )}

              {/* Rejected Draft */}
              {actionDetails.originalDraft && (
                <div className="relative bg-red-900/20 border-2 border-red-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                  <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                  <h4 className="text-lg font-bold text-red-400 mb-4 flex items-center">
                    <Trash2 size={18} className="mr-3" />
                    What Was Rejected
                  </h4>
                  <div className="bg-gray-900/60 rounded-xl border border-red-700/50 p-4 max-h-48 overflow-y-auto shadow-inner">
                    <div className="whitespace-pre-wrap text-sm text-gray-200 leading-relaxed">
                      {actionDetails.originalDraft}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );

        case 'EMAIL_SNOOZED':
          return (
            <div className="space-y-6">
              {/* Email Details */}
              <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                <h4 className="text-lg font-bold text-blue-400 mb-4 flex items-center">
                  <Mail size={18} className="mr-3" />
                  Snoozed Email
                </h4>
                <div className="flex flex-col space-y-4 sm:grid sm:grid-cols-2 sm:space-y-0 sm:gap-4 text-sm">
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">From:</span>
                      <span className="text-gray-200 break-all">{getDetail(actionDetails, 'emailFrom')}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Subject:</span>
                      <span className="text-gray-200 break-words">{getDetail(actionDetails, 'emailSubject')}</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Action:</span>
                      <span className="text-gray-300 break-words">{item.actionSummary}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">Snooze Duration:</span>
                      <span className="text-gray-300">{getDetail(actionDetails, 'snoozeDuration', 'Not specified')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );

        case 'MASTER_PROMPT_UPDATED':
          return (
            <div className="space-y-6">
              {/* Prompt Update Details */}
              <div className="relative bg-purple-900/20 border-2 border-purple-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                <h4 className="text-lg font-bold text-purple-400 mb-4 flex items-center">
                  <Settings size={18} className="mr-3" />
                  AI Settings Updated
                </h4>
                <div className="space-y-4 text-sm">
                  <div className="flex flex-col">
                    <span className="text-gray-400 font-medium">What Changed:</span>
                    <span className="text-gray-200">{item.actionSummary}</span>
                  </div>
                  {actionDetails.promptVersion && (
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">New Version:</span>
                      <span className="text-gray-200">{actionDetails.promptVersion}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* New Prompt Content */}
              {actionDetails.newPrompt && (
                <div className="relative bg-purple-900/20 border-2 border-purple-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                  <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                  <h4 className="text-lg font-bold text-purple-400 mb-4 flex items-center">
                    <Settings size={18} className="mr-3" />
                    New AI Instructions
                  </h4>
                  <div className="bg-gray-900/60 rounded-xl border border-purple-700/50 p-4 max-h-64 overflow-y-auto shadow-inner">
                    <div className="whitespace-pre-wrap text-sm text-gray-200 leading-relaxed">
                      {actionDetails.newPrompt}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );

        default:
          return (
            <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
              <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
              <h4 className="text-lg font-bold text-gray-400 mb-4 flex items-center">
                <AlertTriangle size={18} className="mr-3" />
                Action Details
              </h4>
              <div className="space-y-4 text-sm">
                <div className="flex flex-col">
                  <span className="text-gray-400 font-medium">What Happened:</span>
                  <span className="text-gray-200">{item.actionSummary}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-400 font-medium">Action Type:</span>
                  <span className="text-gray-200">{item.actionType.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          );
      }
    };

    const modalContent = (
      <div 
        className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[99999] p-0 sm:p-6 transition-all duration-200 ease-out overflow-hidden"
        style={{ overscrollBehavior: 'none' }}
        onClick={onClose}
      >
        <div className="relative group w-full h-full sm:max-w-6xl sm:w-full sm:max-h-[90vh] transition-all duration-200 ease-out transform">
          <div className="hidden sm:block absolute -inset-6 bg-gradient-to-r from-purple-500/10 via-purple-400/15 to-purple-500/10 rounded-3xl blur-3xl"></div>
          
          <div 
            className="relative bg-black border-0 sm:border-2 border-gray-800/60 rounded-none sm:rounded-3xl p-4 sm:p-8 backdrop-blur-xl shadow-2xl transition-all duration-200 ease-out flex flex-col h-full overflow-hidden"
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
            <div className="flex justify-between items-start mb-6 sm:mb-8 flex-shrink-0 min-w-0">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-2 flex items-start">
                  <span className="flex-shrink-0">{getActionIcon(item.actionType)}</span>
                  <span className="ml-2 sm:ml-3 break-words">Action Details - {item.actionType.replace('_', ' ')}</span>
                </h3>
                <p className="text-xs sm:text-sm text-gray-400 break-words">Review the complete details of this action</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-gray-800/50 rounded-xl transition-all duration-300 border border-gray-700/50 hover:border-gray-600/60 cursor-pointer flex-shrink-0">
                <X size={16} className="text-gray-400 hover:text-gray-200 transition-colors" />
              </button>
            </div>
            
            <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent mb-8 flex-shrink-0"></div>
            
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto space-y-6 modal-scrollable-content">
              {/* Action Details */}
              {renderActionDetails()}

              {/* Quick Info Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* When */}
                <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-w-0">
                  <GlowingEffect blur={0} borderWidth={1} spread={20} glow={true} disabled={false} proximity={40} inactiveZone={0.02} movementDuration={1.5} />
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-blue-900/40 border border-blue-700/50 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Clock size={16} className="text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 font-medium">When</p>
                      <p className="text-sm text-white font-semibold truncate">{new Date(item.timestamp).toLocaleDateString()}</p>
                      <p className="text-xs text-gray-300 truncate">{new Date(item.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>

                {/* Action Type */}
                <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-w-0">
                  <GlowingEffect blur={0} borderWidth={1} spread={20} glow={true} disabled={false} proximity={40} inactiveZone={0.02} movementDuration={1.5} />
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-purple-900/40 border border-purple-700/50 rounded-xl flex items-center justify-center flex-shrink-0">
                      {getActionIcon(item.actionType)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 font-medium">Action</p>
                      <p className="text-sm text-white font-semibold truncate">{item.actionType.replace('_', ' ')}</p>
                    </div>
                  </div>
                </div>

                {/* Confidence */}
                {typeof item.confidence === 'number' && (
                  <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-w-0">
                    <GlowingEffect blur={0} borderWidth={1} spread={20} glow={true} disabled={false} proximity={40} inactiveZone={0.02} movementDuration={1.5} />
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-8 sm:w-10 h-8 sm:h-10 bg-emerald-900/40 border border-emerald-700/50 rounded-xl flex items-center justify-center flex-shrink-0">
                        <CheckCircle size={16} className="text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-gray-400 font-medium">AI Confidence</p>
                        <p className="text-sm text-white font-semibold truncate">{(item.confidence * 100).toFixed(0)}%</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Additional Details */}
              <div className="relative bg-gray-900/60 border-2 border-gray-700/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
                <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                <h4 className="text-lg font-bold text-gray-400 mb-4 flex items-center">
                  <Settings size={18} className="mr-3" />
                  Additional Details
                </h4>
                <div className="flex flex-col space-y-4 sm:grid sm:grid-cols-2 sm:space-y-0 sm:gap-4 text-sm">
                  <div className="space-y-3">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-medium">AI Version Used:</span>
                      <span className="text-gray-200 break-words">{item.promptState}</span>
                    </div>
                    {item.emailReference && (
                      <div className="flex flex-col">
                        <span className="text-gray-400 font-medium">Email ID:</span>
                        <span className="text-gray-200 text-xs break-all">{item.emailReference}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    {item.feedback && item.feedback !== 'No additional details' && (
                      <div className="flex flex-col">
                        <span className="text-gray-400 font-medium">Notes:</span>
                        <span className="text-gray-200 break-words">{item.feedback}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Enhanced Feedback Section */}
              {renderFeedbackSection()}
            </div>

            {/* Close Button */}
            <div className="mt-8 flex justify-end flex-shrink-0">
              <LiquidButton 
                onClick={onClose}
                minWidth="md"
                responsive
                variant="default"
                size="lg"
                className={LIQUID_BUTTON_BASE_CLASS}
                type="button"
              >
                Close
              </LiquidButton>
            </div>
          </div>
        </div>
      </div>
    );

    return createPortal(modalContent, document.body);
  };


  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Mobile Header - Fixed */}
      <MobileHeader title="Activity History">
        <LiquidButton
          onClick={() => fetchHistoryItems(true)}
          minWidth="none"
          size="icon"
          className="h-8 w-8 rounded-full text-sky-100"
          aria-label="Refresh history"
          variant="default"
          type="button"
        >
          <RefreshCw size={14} />
        </LiquidButton>
      </MobileHeader>

      <div className="flex-1 space-y-6 sm:space-y-8 w-full max-w-none p-4 sm:p-8 pt-24 sm:pt-8 relative z-10 overflow-x-hidden">
        {/* Header */}
        <PageHeader
          title="Activity History"
          subtitle="Review all your email actions and decisions over time."
          icon={Activity}
          iconColor="text-purple-400"
        />

        {/* Enhanced Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-gray-500/10 via-gray-400/15 to-gray-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-gray-400/20 group-hover:via-gray-300/25 group-hover:to-gray-400/20"></div>
            <div className="relative bg-black/80 border-2 border-gray-800/50 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-gray-700/60 min-w-0">
              <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
              <div className="flex items-center justify-between mb-3 min-w-0">
                <span className="text-xs sm:text-sm text-gray-400 font-medium truncate">Total Actions</span>
                <CheckCircle className="h-4 w-4 text-gray-500 flex-shrink-0" />
              </div>
              <p className="text-xl sm:text-2xl font-bold text-white truncate">{filteredHistory.length}</p>
            </div>
          </div>
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/10 via-emerald-400/15 to-emerald-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-emerald-400/20 group-hover:via-emerald-300/25 group-hover:to-emerald-400/20"></div>
            <div className="relative bg-black/80 border-2 border-emerald-800/50 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-emerald-700/60 min-w-0">
              <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
              <div className="flex items-center justify-between mb-3 min-w-0">
                <span className="text-xs sm:text-sm text-gray-400 font-medium truncate">Approved</span>
                <ShieldCheck className="h-4 w-4 text-emerald-500 flex-shrink-0" />
              </div>
              <p className="text-xl sm:text-2xl font-bold text-emerald-400 truncate">{filteredHistory.filter(item => item.actionType === 'EMAIL_SENT').length}</p>
            </div>
          </div>
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-blue-400/20 group-hover:via-blue-300/25 group-hover:to-blue-400/20"></div>
            <div className="relative bg-black/80 border-2 border-blue-800/50 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-blue-700/60 min-w-0">
              <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
              <div className="flex items-center justify-between mb-3 min-w-0">
                <span className="text-xs sm:text-sm text-gray-400 font-medium truncate">Edited</span>
                <Edit3 className="h-4 w-4 text-blue-500 flex-shrink-0" />
              </div>
              <p className="text-xl sm:text-2xl font-bold text-blue-400 truncate">{filteredHistory.filter(item => item.actionType === 'EMAIL_EDITED').length}</p>
            </div>
          </div>
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-500/10 via-red-400/15 to-red-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-red-400/20 group-hover:via-red-300/25 group-hover:to-red-400/20"></div>
            <div className="relative bg-black/80 border-2 border-red-800/50 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-red-700/60 min-w-0">
              <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
              <div className="flex items-center justify-between mb-3 min-w-0">
                <span className="text-xs sm:text-sm text-gray-400 font-medium truncate">Rejected</span>
                <Trash2 className="h-4 w-4 text-red-500 flex-shrink-0" />
              </div>
              <p className="text-xl sm:text-2xl font-bold text-red-400 truncate">{filteredHistory.filter(item => item.actionType === 'EMAIL_REJECTED').length}</p>
            </div>
          </div>
        </div>

        {/* Enhanced Filter Tabs */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg transition-all duration-500 group-hover:from-blue-400/20 group-hover:via-blue-300/25 group-hover:to-blue-400/20"></div>
          <div className="relative bg-black/80 border-2 border-gray-800/50 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-gray-700/60 overflow-hidden">
            <GlowingEffect blur={0} borderWidth={1} spread={40} glow={true} disabled={false} proximity={70} inactiveZone={0.02} movementDuration={1.5} />
            <div className="flex flex-col space-y-4 lg:space-y-0 lg:flex-row lg:items-center lg:gap-6">
              <div className="flex items-center space-x-3">
                <Clock className="h-4 sm:h-5 w-4 sm:w-5 text-purple-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-300">Time Period:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['1', '7', '30'] as const).map((period) => (
                  <button
                    key={period}
                    onClick={() => setFilter(period)}
                    className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl transition-all duration-300 border-2 ${
                      filter === period
                        ? 'bg-purple-600/20 text-purple-400 border-purple-600/50 shadow-lg shadow-purple-900/30'
                        : 'bg-gray-800/60 text-gray-400 border-gray-700/50 hover:bg-gray-700/80 hover:text-gray-300 hover:border-gray-600/60'
                    }`}
                  >
                    {period === '1' ? 'Today' : period === '7' ? '7 days' : '30 days'}
                  </button>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 lg:ml-auto">
                <span className="text-sm font-medium text-gray-300">Action Type:</span>
                <select
                  value={actionTypeFilter}
                  onChange={(e) => setActionTypeFilter(e.target.value)}
                  className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-gray-800/60 border-2 border-gray-700/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 text-gray-300 transition-all duration-200 backdrop-blur-sm"
                >
                  <option value="all">All Actions</option>
                  <option value="EMAIL_SENT">Sent/Replied</option>
                  <option value="EMAIL_EDITED">Edited</option>
                  <option value="EMAIL_REJECTED">Rejected</option>
                  <option value="EMAIL_SNOOZED">Snoozed</option>
                  <option value="MASTER_PROMPT_UPDATED">Prompt Updated</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Enhanced History List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center">
              <Activity className="h-6 w-6 mr-3 text-purple-400" />
              Recent Activity
            </h2>
            <div className="text-sm text-gray-400">
              Showing {filteredHistory.length} {filteredHistory.length === 1 ? 'action' : 'actions'}
            </div>
          </div>
          
          {loading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <div className="relative w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 sm:mb-6">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 border-2 border-gray-700 border-t-purple-500 rounded-full animate-spin"></div>
                </div>
                <p className="text-base sm:text-lg font-medium text-gray-200">Loading activity history...</p>
                <p className="text-xs sm:text-sm text-gray-400 mt-2">Retrieving past actions</p>
              </div>
            </div>
          ) : filteredHistory.length > 0 ? (
            <div className="space-y-4">
              {filteredHistory.map(item => (
                <div key={item.id} className="relative group">
                  <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/8 via-purple-400/12 to-purple-500/8 rounded-2xl blur-lg transition-all duration-500 group-hover:from-purple-400/15 group-hover:via-purple-300/20 group-hover:to-purple-400/15"></div>
                  <div 
                    className="relative bg-black/80 border-2 border-gray-800/50 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md transition-all duration-500 group-hover:border-gray-700/60 cursor-pointer transform hover:scale-[1.01] overflow-hidden"
                    onClick={() => setShowHistoryViewer(item)}
                  >
                    <GlowingEffect blur={0} borderWidth={1} spread={30} glow={true} disabled={false} proximity={60} inactiveZone={0.02} movementDuration={1.5} />
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between space-y-4 sm:space-y-0 min-w-0">
                      <div className="flex items-start space-x-4 flex-1 min-w-0">
                        <div className="flex items-center justify-center w-10 sm:w-12 h-10 sm:h-12 bg-gray-800/60 border border-gray-700/50 rounded-xl group-hover:bg-gray-700/80 group-hover:border-gray-600/60 transition-all duration-300 flex-shrink-0">
                          {getActionIcon(item.actionType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-200 group-hover:text-purple-400 transition-colors mb-2 text-sm sm:text-base lg:text-lg break-words">
                            {item.actionSummary}
                          </h3>
                          <div className="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-4 text-xs sm:text-sm text-gray-400">
                            <span className="flex items-center">
                              <Clock size={12} className="mr-2 flex-shrink-0" />
                              <span className="truncate">{formatTimestamp(item.timestamp)}</span>
                            </span>
                            <span className="flex items-center capitalize">
                              {getActionIcon(item.actionType)}
                              <span className="ml-2 truncate">{item.actionType.replace('_', ' ').toLowerCase()}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-end space-x-3 flex-shrink-0">
                        <div className="text-xs sm:text-sm text-purple-400 font-medium flex items-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                          <span className="hidden sm:inline">View details</span>
                          <span className="sm:hidden">View</span>
                          <ArrowRight size={12} className="ml-1 sm:ml-2 transition-transform duration-200 ease-in-out group-hover:translate-x-1" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 sm:py-16">
              <div className="relative group">
                <div className="absolute -inset-4 bg-gradient-to-r from-purple-500/8 via-purple-400/12 to-purple-500/8 rounded-3xl blur-2xl transition-all duration-700"></div>
                <div className="relative rounded-3xl border border-gray-800/50 bg-black/80 backdrop-blur-md shadow-2xl p-12 max-w-md mx-auto">
                  <GlowingEffect blur={0} borderWidth={2} spread={60} glow={true} disabled={false} proximity={80} inactiveZone={0.02} movementDuration={1.5} />
                  <div className="relative bg-black/70 border-2 border-gray-800/70 rounded-2xl backdrop-blur-sm shadow-inner p-8">
                    <Clock size={48} className="mx-auto text-gray-600 mb-6" />
                    <h3 className="text-xl font-bold text-gray-200 mb-3">No History Found</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      {searchTerm ? 'Try adjusting your search term.' : 'No actions recorded in the selected time period.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Modals */}
      {showHistoryViewer && (
        <HistoryViewer 
          item={showHistoryViewer} 
          onClose={() => setShowHistoryViewer(null)} 
        />
      )}
      
    </div>
  );
}; 
