'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { PageType } from '@/types';
import { AppSidebar } from '@/components/sidebar-components/app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar/sidebar';
import { MobileSidebarToggle } from '@/components/ui/MobileSidebarToggle';
import { QueuePage } from '@/components/pages/QueuePage';
import { LabelQueuePage } from '@/components/pages/LabelQueuePage';
import { HistoryPage } from '@/components/pages/HistoryPage';
import { MetricsPage } from '@/components/pages/MetricsPage';
import { VoiceRulesPage } from '@/components/pages/VoiceRulesPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { FeedbackPage } from '@/components/pages/FeedbackPage';
import { FolderManagementPage } from '@/components/pages/FolderManagementPage';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { GmailScopeUpgradeBanner } from '@/components/ui/GmailScopeUpgrade';
import { PageDataProvider } from '@/contexts/PageDataContext';
import { LoaderFive } from '@/components/ui/loader';
import { OnboardingStatusBanner } from '@/components/ui/OnboardingStatusBanner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import type { TextChannelsSettingsSnapshot } from '@/lib/services/textChannelsSettings';

type SettingsSection = 'account-privacy' | 'assistant-replies' | 'folders-labels' | 'text-channels' | 'inboxes' | 'mcp-connections';

interface CliraAppProps {
  initialTextChannelsSettings?: TextChannelsSettingsSnapshot | null;
}

const CliraAppContent: React.FC<CliraAppProps> = ({ initialTextChannelsSettings = null }) => {
  const { data: session } = useSession();
  const [activePage, setActivePage] = useState<PageType>('queue');
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);    
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ page: PageType; labelId?: string | null } | null>(null);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>('account-privacy'); 
  const [isAutoFetching, setIsAutoFetching] = useState(false);
  const [autoFetchCompleted, setAutoFetchCompleted] = useState(false);
  const [initializationStarted, setInitializationStarted] = useState(false);
  const { 
    status, 
    isOnboardingComplete, 
    loading: onboardingLoading, 
    isRefreshing: onboardingRefreshing
  } = useOnboardingStatus();

  // Note: Onboarding routing is handled by the signin page (/signin/page.tsx)
  // CliraApp should only render for users who are supposed to be in the main app

  // Auto-fetch emails and ensure prompts AFTER labeling is completed and user reaches app
  useEffect(() => {
    const autoFetchEmails = async () => {
      if (!session?.userId || autoFetchCompleted || isAutoFetching || initializationStarted) return;
      // Only start prompt generation after labeling is complete and at least one prompt is missing
      if (!status?.labelingOnboardingGenerated) return;
      const promptsDone = !!status?.masterPromptGenerated;
      if (promptsDone) return;
      
      setInitializationStarted(true);

      try {
        setIsAutoFetching(true);
        
        // Start the background onboarding process (email fetch + master prompt generation)
        const response = await fetch('/api/auto-fetch-emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const data = await response.json();
        
        if (data.skipped) {
          setAutoFetchCompleted(true);
        } else if (response.ok && response.status === 202) {
          // Background job started successfully
          setAutoFetchCompleted(true);
          console.log(`🎯 Onboarding job ${data.jobId} started successfully`);
        } else {
          // Handle error case
          setAutoFetchCompleted(true);
        }
      } catch (error) {
        console.error('Error during auto-fetch:', error);
        setAutoFetchCompleted(true);
      } finally {
        setIsAutoFetching(false);
      }
    };

    // Only run initialization once when conditions are met (labeling done, prompts pending)
    if (session?.userId && !autoFetchCompleted && !isAutoFetching && !initializationStarted && status?.labelingOnboardingGenerated) {
      console.log('🚀 Starting Clira initialization for user:', session.userId);
      autoFetchEmails();
    }
  }, [session?.userId, autoFetchCompleted, isAutoFetching, initializationStarted, status]);

  // Smooth page transition handler
  const handlePageTransition = useCallback((newPage: PageType, labelId?: string) => {
    if (newPage === activePage && labelId === activeLabelId) return;

    // Start fade-out; switch content on transition end (no setTimeout)
    setPendingNav({ page: newPage, labelId: labelId ?? null });
    setIsTransitioning(true);
  }, [activePage, activeLabelId]);

  const handleTransitionEnd = useCallback((e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (!isTransitioning) return;

    if (pendingNav) {
      const { page, labelId } = pendingNav;
      if (page === 'label-queue') {
        setActiveLabelId(labelId ?? null);
      } else {
        setActiveLabelId(null);
      }
      setActivePage(page);
      setPendingNav(null);
    }
    // Trigger fade-in after content switch
    setIsTransitioning(false);
  }, [isTransitioning, pendingNav]);

  // Redirect from label-queue to queue if labelId is missing
  useEffect(() => {
    if (activePage === 'label-queue' && !activeLabelId) {
      handlePageTransition('queue');
    }
  }, [activePage, activeLabelId, handlePageTransition]);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        page: PageType;
        labelId?: string | null;
        settingsSection?: SettingsSection;
      }>;
      const detail = customEvent.detail;
      if (!detail?.page) return;

      if (detail.page === 'settings' && detail.settingsSection) {
        setActiveSettingsSection(detail.settingsSection);
      }
      handlePageTransition(detail.page, detail.labelId ?? undefined);
    };

    window.addEventListener('clira:navigate', handler as EventListener);
    return () => {
      window.removeEventListener('clira:navigate', handler as EventListener);
    };
  }, [handlePageTransition]);

  const renderPage = () => {
    switch (activePage) {
      case 'queue':
        return <QueuePage 
          useMockData={process.env.NEXT_PUBLIC_USE_MOCK_DATA_QUEUE === 'true'} //in env.local
        />;
      case 'label-queue':
        if (!activeLabelId) {
          // Redirect will be handled by useEffect. Render null to avoid flicker or errors.
          return null;
        }
        return <LabelQueuePage 
          labelId={activeLabelId} 
          onBackToQueue={() => handlePageTransition('queue')}
          onNavigateHome={() => handlePageTransition('queue')}
          useMockData={process.env.NEXT_PUBLIC_USE_MOCK_DATA_LABEL_QUEUE === 'true'} //in env.local
        />;
      case 'history':
        return <HistoryPage />;
      case 'metrics':
        return <MetricsPage />;
      case 'voice':
        return <VoiceRulesPage />;
      case 'settings':
        return (
          <SettingsPage
            activeSection={activeSettingsSection}
            initialTextChannelsSettings={initialTextChannelsSettings}
          />
        );
      case 'feedback':
        return <FeedbackPage />;
      case 'folders':
        return <FolderManagementPage />;
      default:
        return <QueuePage />;
    }
  };

  if (!session) return null;

  // Show loading only when onboarding status is being fetched
  if (onboardingLoading && !status) {
    return (
      <div className="min-h-screen w-full bg-black text-gray-100 font-inter flex items-center justify-center">
        <div className="text-center">
          <LoaderFive text="Loading your workspace..." />
          <p className="text-sm text-gray-400 mt-4">Setting things up for you</p>
        </div>
      </div>
    );
  }

  // Preferences onboarding overlay removed entirely

  return (
    <div className="flex min-h-[100svh] min-h-[100dvh] w-full bg-black text-gray-100 font-inter overscroll-none overflow-hidden">
      <SidebarProvider>
        <SidebarLayout
          activePage={activePage}
          setActivePage={handlePageTransition}
          activeLabelId={activeLabelId}
          activeSettingsSection={activeSettingsSection}
          setActiveSettingsSection={setActiveSettingsSection}
          renderPage={renderPage}
          isTransitioning={isTransitioning}
          onboardingRefreshing={onboardingRefreshing}
          onTransitionEnd={handleTransitionEnd}
        />
      </SidebarProvider>
    </div>
  );
};

// Separate component that can use the sidebar hook
const SidebarLayout: React.FC<{
  activePage: PageType;
  setActivePage: (page: PageType, labelId?: string) => void;
  activeLabelId: string | null;
  activeSettingsSection: SettingsSection;
  setActiveSettingsSection: (section: SettingsSection) => void;
  renderPage: () => React.ReactNode;
  isTransitioning: boolean;
  onboardingRefreshing: boolean;
  onTransitionEnd: (e: React.TransitionEvent<HTMLDivElement>) => void;
}> = ({ 
  activePage, 
  setActivePage, 
  activeLabelId,
  activeSettingsSection, 
  setActiveSettingsSection, 
  renderPage, 
  isTransitioning,
  onboardingRefreshing,
  onTransitionEnd
}) => {
  return (
    <>
      <AppSidebar 
        activePage={activePage} 
        setActivePage={setActivePage}
        activeLabelId={activeLabelId}
        activeSettingsSection={activeSettingsSection}
        setActiveSettingsSection={setActiveSettingsSection}
      />
      {/* Global mobile-only sidebar toggle (no desktop impact) */}
      <MobileSidebarToggle />
      <main
        className="flex-1 h-[100svh] h-[100dvh] flex flex-col transition-all duration-100 ease-in-out overscroll-none overflow-hidden"
      >
        {/* Fixed rounded container with reduced left margin and increased width */}
        <div className="w-full h-full md:ml-0 md:mr-2 md:mb-1 md:mt-1 overscroll-none relative">
          <div className="h-full md:h-[calc(100%-8px)] bg-black md:bg-black md:shadow-2xl overscroll-none relative md:border md:border-gray-800/50 md:rounded-xl">

            {/* Background refresh indicator */}
            {onboardingRefreshing && (
              <div className="absolute top-4 right-4 z-50">
                <div className="bg-gray-800/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center space-x-2">
                  <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs text-gray-300">Syncing...</span>
                </div>
              </div>
            )}

            {/* Scrollable content area */}
            <div
              className="h-full overflow-auto overscroll-none relative md:rounded-xl"
              style={{ contain: 'paint' }}
              onWheel={(e) => {
                // Prevent scroll propagation to parent elements
                const target = e.currentTarget;
                const isAtTop = target.scrollTop === 0;
                const isAtBottom = target.scrollHeight - target.scrollTop === target.clientHeight;

                if ((e.deltaY < 0 && isAtTop) || (e.deltaY > 0 && isAtBottom)) {
                  e.stopPropagation();
                }
              }}
            >
              <GmailScopeUpgradeBanner />
              <OnboardingStatusBanner />

              {/* Page transition container */}
              <div className="relative w-full min-h-full">
                <div
                  className={`transition-all duration-100 ease-out ${
                    isTransitioning
                      ? 'opacity-0 translate-y-1'
                      : 'opacity-100 translate-y-0'
                  }`}
                  onTransitionEnd={onTransitionEnd}
                >
                  {renderPage()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      
     
    </>
  );
};

// Main component wrapped with providers
export const CliraApp: React.FC<CliraAppProps> = ({
  initialTextChannelsSettings = null,
}) => {
  return (
    <ErrorBoundary>
      <PageDataProvider>
          <CliraAppContent initialTextChannelsSettings={initialTextChannelsSettings} />
      </PageDataProvider>
    </ErrorBoundary>
  );
};
