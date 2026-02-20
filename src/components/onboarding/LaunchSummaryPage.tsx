'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowRight, 
  CheckCircle2,
  MessageCircle,
  Clock, 
  FolderOpen,
  Users,
  Settings,
  Crown,
  Sparkles,
  Loader2,
  Eye,
  Search
} from 'lucide-react';

interface LaunchSummaryPageProps {
  onComplete: (action: 'dashboard' | 'chat' | 'review') => void;
  userName?: string;
  folders?: SummaryFolder[];
  vips?: SummaryVIP[];
  settings?: {
    batchSchedule?: string;
    totalRules?: number;
  };
  mockMode?: boolean;
}

interface SummaryFolder {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
}

interface SummaryVIP {
  identifier: string;
  priority: string;
}

const mockFolders: SummaryFolder[] = [
  {
    id: 'newsletters',
    name: 'Newsletters',
    icon: '📧',
    description: 'all mass-marketing & digests',
    color: '#3B82F6'
  },
  {
    id: 'financials', 
    name: 'Financials',
    icon: '💰',
    description: 'receipts, invoices & bank statements',
    color: '#F59E0B'
  },
  {
    id: 'travel',
    name: 'Travel', 
    icon: '✈️',
    description: 'bookings & itineraries',
    color: '#8B5CF6'
  },
  {
    id: 'notifications',
    name: 'Notifications',
    icon: '🔔', 
    description: 'automated alerts (GitHub, Asana)',
    color: '#10B981'
  },
  {
    id: 'action-needed',
    name: 'Action Needed',
    icon: '📝',
    description: 'emails that clearly need your reply/decision', 
    color: '#EF4444'
  },
  {
    id: 'review',
    name: 'Review',
    icon: '👀',
    description: 'anything I\'m unsure about',
    color: '#6B7280'
  }
];

const mockVIPs: SummaryVIP[] = [
  { identifier: 'ceo@acme.com', priority: 'urgent' },
  { identifier: '@board.acme.com', priority: 'urgent' }
];

export const LaunchSummaryPage: React.FC<LaunchSummaryPageProps> = ({ 
  onComplete,
  userName = 'there',
  folders = mockFolders,
  vips = mockVIPs,
  settings = { batchSchedule: "Every 3 hours", totalRules: 0 },
  mockMode = false
}) => {
  const [showContent, setShowContent] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchAction, setLaunchAction] = useState<'dashboard' | 'chat' | 'review' | null>(null);
  const [actualFolders, setActualFolders] = useState<SummaryFolder[]>(folders);
  const [loading, setLoading] = useState(!mockMode);

  const fetchFolderData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/onboarding/email-categorization');
      const data = await response.json();
      
      if (data.success && data.result) {
        // Transform API folders to summary format
        const summaryFolders = data.result.folderSuggestions.map((folder: any) => ({
          id: folder.name.toLowerCase().replace(/\s+/g, '-'),
          name: folder.name,
          icon: getIconForFolder(folder.name),
          description: folder.description,
          color: folder.color
        }));
        
        setActualFolders(summaryFolders);
      } else {
        // Fallback to provided folders or mock data
        setActualFolders(folders);
      }
      
      // Trigger fade-in animation without setTimeout
      setShowContent(true);
      
    } catch (error) {
      console.error('Error fetching folder data:', error);
      // Fallback to provided folders or mock data
      setActualFolders(folders);
      setShowContent(true);
    } finally {
      setLoading(false);
    }
  }, [folders]);

  useEffect(() => {
    if (mockMode) {
      setActualFolders(folders);
      setLoading(false);
      setShowContent(true);
      return;
    }
    
    fetchFolderData();
  }, [mockMode, folders, fetchFolderData]);

  // Function to map folder names to appropriate icons (same as other pages)
  const getIconForFolder = (folderName: string): string => {
    const name = folderName.toLowerCase();
    if (name.includes('newsletter') || name.includes('marketing')) return '📧';
    if (name.includes('financial') || name.includes('money') || name.includes('payment') || name.includes('bill')) return '💰';
    if (name.includes('travel') || name.includes('booking') || name.includes('flight')) return '✈️';
    if (name.includes('notification') || name.includes('alert')) return '🔔';
    if (name.includes('action') || name.includes('todo') || name.includes('task')) return '📝';
    if (name.includes('review') || name.includes('check')) return '👀';
    if (name.includes('work') || name.includes('business')) return '💼';
    if (name.includes('personal') || name.includes('family')) return '🏠';
    if (name.includes('shopping') || name.includes('order')) return '🛒';
    if (name.includes('health') || name.includes('medical')) return '🏥';
    if (name.includes('education') || name.includes('learning')) return '📚';
    return '📁'; // Default folder icon
  };

  const handleStartSorting = async () => {
    setLaunching(true);
    setLaunchAction('dashboard');
    
    try {
      // Trigger the first batch sorting
      const response = await fetch('/api/onboarding/folders/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folders: actualFolders,
          vips,
          settings,
          triggerFirstBatch: true
        })
      });

      const data = await response.json();
      
      if (data.success) {
        onComplete('dashboard');
      } else {
        console.error('Failed to finalize setup:', data.error);
        onComplete('dashboard');
      }
    } catch (error) {
      console.error('Error launching email sorting:', error);
      onComplete('dashboard');
    }
  };

  const handleOpenChat = () => {
    setLaunchAction('chat');
    onComplete('chat');
  };

  const handleReviewEmails = () => {
    setLaunchAction('review');
    onComplete('review');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <span className="text-gray-300">Loading your personalized setup...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header with Animation */}
        <div 
          className={`text-center mb-8 transition-all duration-1000 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-emerald-900/40 border border-emerald-500/30 rounded-2xl flex items-center justify-center relative">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <div className="absolute inset-0 border-2 border-emerald-500/20 rounded-2xl animate-ping"></div>
            </div>
          </div>
          
          <h1 className="text-4xl font-bold text-white mb-4">
            All set, {userName}! 🎉
          </h1>
          <p className="text-xl text-gray-300">
            Your personalized email management system is ready to go.
          </p>
        </div>

        {/* Progress indicator - completed */}
        <div 
          className={`mb-8 transition-all duration-1000 delay-200 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-300">Setup Progress</span>
            <span className="text-sm font-medium text-emerald-400">Complete!</span>
          </div>
          <div className="w-full bg-gray-800 border border-gray-700/50 rounded-full h-2">
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 h-2 rounded-full w-full transition-all duration-1000"></div>
          </div>
        </div>

        {/* Email Management Summary */}
        <div 
          className={`mb-8 transition-all duration-1000 delay-400 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
            <div className="flex items-center space-x-3 mb-6">
              <FolderOpen className="w-6 h-6 text-blue-400" />
              <h2 className="text-2xl font-semibold text-white">
                Here's how I'll manage your emails:
              </h2>
            </div>
            
            <div className="space-y-3 mb-6">
              {actualFolders.map((folder, index) => (
                <div 
                  key={folder.id}
                  className={`flex items-center space-x-4 p-3 bg-gray-800/30 rounded-lg transition-all duration-500 ${
                    showContent ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
                  }`}
                  style={{ transitionDelay: `${600 + index * 100}ms` }}
                >
                  <div className="text-2xl">{folder.icon}</div>
                  <div className="flex-1">
                    <span className="text-white font-medium">{folder.name}</span>
                    <span className="text-gray-400 mx-2">→</span>
                    <span className="text-gray-300">{folder.description}</span>
                  </div>
                  <div 
                    className="w-3 h-3 rounded-full opacity-60"
                    style={{ backgroundColor: folder.color }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* VIPs Section */}
        {vips.length > 0 && (
          <div 
            className={`mb-8 transition-all duration-1000 delay-700 ease-out ${
              showContent 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-4'
            }`}
          >
            <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Crown className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold text-blue-400">VIPs:</h3>
              </div>
              <p className="text-gray-300">
                {vips.map(vip => vip.identifier).join(', ')} will always come to your attention.
              </p>
            </div>
          </div>
        )}

        {/* System Info */}
        <div 
          className={`mb-8 transition-all duration-1000 delay-800 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 bg-emerald-900/40 border border-emerald-500/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Clock className="w-6 h-6 text-emerald-400" />
                </div>
                <h4 className="text-white font-medium mb-1">Batch Schedule</h4>
                <p className="text-sm text-gray-300">{settings.batchSchedule}</p>
              </div>
              
              <div className="text-center">
                <div className="w-12 h-12 bg-emerald-900/40 border border-emerald-500/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Settings className="w-6 h-6 text-emerald-400" />
                </div>
                <h4 className="text-white font-medium mb-1">Smart Processing</h4>
                <p className="text-sm text-gray-300">AI-powered sorting</p>
              </div>
              
              <div className="text-center">
                <div className="w-12 h-12 bg-emerald-900/40 border border-emerald-500/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-emerald-400" />
                </div>
                <h4 className="text-white font-medium mb-1">Always Adjustable</h4>
                <p className="text-sm text-gray-300">Customize anytime</p>
              </div>
            </div>
          </div>
        </div>

        {/* Review Option */}
        <div 
          className={`text-center mb-8 transition-all duration-1000 delay-900 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-6">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <Search className="w-5 h-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-blue-400">Want a closer look before I sort your inbox?</h3>
            </div>
            <p className="text-gray-300 mb-6">
              You can quickly review all emails and easily adjust any mistakes.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={handleReviewEmails}
                disabled={launching}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg transition-all duration-300 flex items-center justify-center space-x-2 shadow-lg font-medium hover:scale-105 disabled:opacity-50"
              >
                <Eye className="w-4 h-4" />
                <span>Review Emails in Detail</span>
              </button>
              
              <div className="flex items-center justify-center text-gray-400 px-4">
                <span className="text-sm">or</span>
              </div>
              
              <button
                onClick={handleStartSorting}
                disabled={launching}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-all duration-300 flex items-center justify-center space-x-2 font-medium hover:scale-105 disabled:opacity-50"
              >
                <span>No, I'm good! Start Sorting</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Reassurance Message */}
        <div 
          className={`text-center mb-8 transition-all duration-1000 delay-1000 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-center space-x-2 mb-3">
              <Sparkles className="w-5 h-5 text-yellow-400" />
              <p className="text-lg text-gray-300">
                You can adjust anything later—or just chat with me any time.
              </p>
            </div>
            <p className="text-sm text-gray-400">
              Your email organization will improve as I learn your preferences.
            </p>
          </div>
        </div>

        {/* Alternative Action - Chat */}
        <div 
          className={`flex justify-center transition-all duration-1000 delay-1100 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4'
          }`}
        >
          <button
            onClick={handleOpenChat}
            disabled={launching}
            className="px-6 py-3 bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-gray-300 rounded-lg transition-all duration-300 flex items-center justify-center space-x-2 text-sm font-medium hover:scale-105 disabled:opacity-50 border border-gray-600"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Or chat with Clira EA instead</span>
          </button>
        </div>

        {/* Footer Message */}
        <div 
          className={`text-center mt-8 transition-all duration-1000 delay-1200 ease-out ${
            showContent 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-4'
          }`}
        >
          <p className="text-sm text-gray-400">
            Welcome to smarter email management! 🚀
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        
        .animate-ping {
          animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
};
