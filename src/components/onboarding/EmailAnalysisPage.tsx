'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, CheckCircle, Users } from 'lucide-react';
import { LoaderFive } from '../ui/loader';
import { GlowingEffect } from '../ui/glowing-effect';
import { SparklesCore } from '../ui/sparkles';
import { generateColorForFolder } from '@/lib/utils/iconGenerator';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';

// Function to map folder names to appropriate icons
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

interface EmailAnalysisPageProps {
  onNext: () => void;
  onBack?: () => void;
  mockMode?: boolean;
  mockAnalysisData?: EmailAnalysisData;
  preProcessedData?: EmailCategorizationResult; // Data from LLMProcessingPage
}

interface EmailAnalysisData {
  totalEmails: number;
  categories: Array<{
    name: string;
    percentage: number;
    topSources: string[];
    color: string;
    icon: string;
  }>;
  topContacts: string[];
}

interface CategorizedEmail {
  emailAddress: string;
  senderName?: string;
  frequency: number;
  suggestedFolder: string;
  confidence: number;
  reasoning: string;
  sampleSubjects: string[];
  sampleSnippets: string[];
}

interface FolderSuggestion {
  name: string;
  description: string;
  color: string;
  emailCount: number;
  topSenders: string[];
}

interface EmailCategorizationResult {
  categorizedEmails: CategorizedEmail[];
  folderSuggestions: FolderSuggestion[];
  totalEmailsAnalyzed: number;
  categorizationTimeMs: number;
}

const mockData: EmailAnalysisData = {
  totalEmails: 500,
  categories: [
    {
      name: 'Newsletters',
      percentage: 55,
      topSources: ['Walmart Canada', 'AppSumo', 'Product Hunt Daily', 'MotoGP™ | Merchandising'],
      color: 'text-blue-400',
      icon: '📬'
    },
    {
      name: 'Notifications',
      percentage: 27,
      topSources: ['LinkedIn', 'Google', 'Indeed', 'Walmart Delivery Pass'],
      color: 'text-purple-400',
      icon: '🔔'
    },
    {
      name: 'Financials',
      percentage: 10,
      topSources: ['Scotia InfoAlerts', 'Tim Hortons', 'Apple', 'Coinbase'],
      color: 'text-yellow-400',
      icon: '💳'
    },
    {
      name: 'Travel',
      percentage: 2,
      topSources: ['Orbitz', 'Cathay', 'VacationsToGo.com'],
      color: 'text-cyan-400',
      icon: '✈️'
    },
    {
      name: 'Action Needed',
      percentage: 2,
      topSources: ['API OAuth Dev Verification', 'Team Tony Robbins', 'npm', 'The Residency'],
      color: 'text-red-400',
      icon: '📝'
    },
    {
      name: 'Review',
      percentage: 2,
      topSources: ['Ali from Taskformer', 'Dylan Wilson', 'Blommaert Jenn', 'Tushar Kapil'],
      color: 'text-green-400',
      icon: '👀'
    },
    {
      name: 'Community Updates',
      percentage: 3,
      topSources: ['AI Automation Agency Hub', 'TCYBA'],
      color: 'text-orange-400',
      icon: '🗣️'
    }
  ],
  topContacts: [
    'infoalerts@scotiabank.com',
    'offers@e.walmart.ca',
    'support@appsumo.com',
    'invitations@linkedin.com',
    'hello@digest.producthunt.com',
    'motogp@my.motogp.com',
    'no-reply@accounts.google.com'
  ]
};

export const EmailAnalysisPage: React.FC<EmailAnalysisPageProps> = ({ 
  onNext, 
  onBack,
  mockMode = false,
  mockAnalysisData = mockData,
  preProcessedData
}) => {
  const [analysisData, setAnalysisData] = useState<EmailAnalysisData | null>(
    mockMode ? mockAnalysisData : null
  );
  const [loading, setLoading] = useState(!mockMode && !preProcessedData);
  const [showStats, setShowStats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);
  const [loadingMessage, setLoadingMessage] = useState('Analyzing Your Email Patterns...');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchAnalysisData = useCallback(async (isMounted = true) => {
    // Prevent duplicate calls
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

    let progressIntervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    try {
      if (!isMounted) return;
      setLoading(true);
      setError(null);
      setLoadingProgress(0);
      setLoadingMessage('Analyzing Your Email Patterns...');

      console.log('Starting API call to /api/onboarding/email-categorization');

      // Create AbortController for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Add timeout to prevent hanging
      timeoutId = setTimeout(() => {
        abortController.abort();
      }, 300000); // 5 minutes timeout

      // Start progress animation
      progressIntervalId = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 90) return prev; // Don't go to 100% until we get response
          const next = prev + Math.random() * 15;
          const messages = [
            'Analyzing Your Email Patterns...',
            'Processing email content...',
            'Identifying patterns and categories...',
            'Generating folder suggestions...',
            'Almost done...'
          ];
          const currentIndex = Math.floor(next / 20);
          setLoadingMessage(messages[Math.min(currentIndex, messages.length - 1)]);
          return next;
        });
      }, 1000);

      const response = await fetch('/api/onboarding/email-categorization', {
        signal: abortController.signal
      });
      
      console.log('API response received:', { status: response.status, ok: response.ok });
      
      // Check if request was aborted or component unmounted
      if (!isMounted || abortController.signal.aborted) {
        return;
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API response not ok:', { status: response.status, statusText: response.statusText, errorText });
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log('API response data:', data);
      
      if (!data.success) {
        if (data.timeout) {
          throw new Error('Analysis is taking longer than expected. Please try again in a few moments.');
        }
        throw new Error(data.error || 'Failed to analyze emails');
      }

      // Set progress to 100% when we get the response
      setLoadingProgress(100);

      // Transform the API response into our expected format
      const categorizationResult: EmailCategorizationResult = data.result;
      
      // Create analysis data from categorization result
      const transformedData: EmailAnalysisData = {
        totalEmails: categorizationResult.totalEmailsAnalyzed,
        categories: categorizationResult.folderSuggestions.map((folder: FolderSuggestion) => ({
          name: folder.name,
          percentage: Math.round((folder.emailCount / categorizationResult.totalEmailsAnalyzed) * 100),
          topSources: folder.topSenders,
          color: folder.color,
          icon: getIconForFolder(folder.name) // Use proper icon mapping
        })),
        topContacts: categorizationResult.categorizedEmails
          .sort((a: CategorizedEmail, b: CategorizedEmail) => b.frequency - a.frequency)
          .slice(0, 7)
          .map((e: CategorizedEmail) => e.emailAddress)
      };
      
      if (isMounted && !abortController.signal.aborted) {
        setAnalysisData(transformedData);
        // Trigger animations without setTimeout; rely on CSS transition delays
        setShowStats(true);
      }
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      
      console.error('Error fetching email analysis:', error);
      
      if (isMounted) {
        setError(error instanceof Error ? error.message : 'Failed to analyze emails');
        // Don't fallback to mock data automatically - let user decide
      }
    } finally {
      if (isMounted) {
        setLoading(false);
      }

      isFetchingRef.current = false;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (progressIntervalId) {
        clearInterval(progressIntervalId);
      }
      
      abortControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    if (mockMode) {
      if (isMounted) {
        setAnalysisData(mockAnalysisData);
        setLoading(false);
        // Trigger animations without setTimeout
        setShowStats(true);
      }
      return () => {
        isMounted = false;
      };
    }
    
    // Check if we have pre-processed data from LLMProcessingPage
    if (preProcessedData && !analysisData && isMounted) {
      console.log('Using pre-processed data from LLMProcessingPage');
      
      // Transform the pre-processed categorization result into analysis data
      const transformedData: EmailAnalysisData = {
        totalEmails: preProcessedData.totalEmailsAnalyzed,
        categories: preProcessedData.folderSuggestions.map((folder: FolderSuggestion) => ({
          name: folder.name,
          percentage: Math.round((folder.emailCount / preProcessedData.totalEmailsAnalyzed) * 100),
          topSources: folder.topSenders,
          color: folder.color,
          icon: getIconForFolder(folder.name)
        })),
        topContacts: preProcessedData.categorizedEmails
          .sort((a: CategorizedEmail, b: CategorizedEmail) => b.frequency - a.frequency)
          .slice(0, 7)
          .map((e: CategorizedEmail) => e.emailAddress)
      };
      
      setAnalysisData(transformedData);
      setLoading(false);
      setShowStats(true);
      
      return () => {
        isMounted = false;
      };
    }
    
    // For real mode without pre-processed data, fetch data (fallback)
    if (isMounted && !analysisData && !preProcessedData) {
      console.log('No pre-processed data available, fetching from API (fallback)');
      setLoading(true);
      fetchAnalysisData(isMounted);
    }
    
    return () => {
      isMounted = false;
      // Cancel any ongoing requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [mockMode, mockAnalysisData, analysisData, preProcessedData, fetchAnalysisData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 max-w-md mx-auto text-center">
          <div className="relative">
            <div className="w-24 h-24 border-4 border-gray-700 rounded-full">
              <div 
                className="w-24 h-24 border-4 border-blue-500 rounded-full animate-spin"
                style={{
                  borderTopColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderBottomColor: 'transparent'
                }}
              />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 bg-blue-500 rounded-full animate-pulse" />
            </div>
          </div>
          
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-white">{loadingMessage}</h2>
            <p className="text-gray-400 text-sm">
              This usually takes 30-60 seconds as we analyze your email patterns
            </p>
            
            {/* Progress bar */}
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="text-blue-400 text-sm font-medium">{Math.round(loadingProgress)}%</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center max-w-md mx-auto">
          <div className="mb-6">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Analysis Failed</h2>
            <p className="text-gray-300 text-sm">{error}</p>
          </div>
          
          <div className="space-y-3">
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                fetchAnalysisData();
              }}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-medium"
            >
              Try Again
            </button>
            
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNext();
              }}
              className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors font-medium"
            >
              Continue with Sample Data
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!analysisData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center max-w-md mx-auto">
          <div className="w-16 h-16 bg-gray-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Data Available</h2>
          <p className="text-gray-300 text-sm mb-6">Unable to load email analysis data</p>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNext();
            }}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-medium"
          >
            Continue Anyway
          </button>
        </div>
      </div>
    );
  }

  const categoryData = analysisData.categories.map(cat => {
    const folderIcon = getIconForFolder(cat.name);
    const colors = generateColorForFolder(cat.name);

    return {
      name: cat.name,
      percentage: cat.percentage,
      sources: cat.topSources,
      folderIcon,
      color: colors.textColor,
      // Use darker black/grey background for all cards
      bgColor: 'bg-black/90 border-gray-900/80',
      // Store the accent color for elements inside
      accentColor: colors.textColor,
    };
  });


  return (
    <div className="min-h-screen bg-black p-8 relative overflow-hidden">
      {/* Sparkles Background - Full width */}
      <div className="fixed inset-0 w-screen h-screen">
        <SparklesCore
          id="tsparticlesfullpage"
          background="transparent" 
          minSize={0.6}
          maxSize={1.4}
          particleDensity={50}
          className="w-full h-full"
          particleColor="#3b82f6"
          speed={0.5}
        />
      </div>
      
      {/* Content */}
      <div className="max-w-8xl mx-auto relative z-10">
        {/* Header & Navigation */}
        <div className="flex items-center justify-between mb-12">
          <button 
            onClick={onBack}
            className="flex items-center space-x-3 text-gray-400 hover:text-white transition-all duration-300 px-6 py-3 rounded-xl hover:bg-gray-800/50 backdrop-blur-sm border border-transparent hover:border-gray-700"
            disabled={!onBack}
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="font-semibold">Back</span>
          </button>
          
          <div className="text-center px-8 py-4 bg-gray-800/60 border border-gray-600 rounded-xl backdrop-blur-sm shadow-lg">
            <span className="text-sm font-bold text-gray-200 tracking-wider">Step 2 of 5</span>
          </div>
          
          <button className="flex items-center space-x-3 text-gray-500 transition-all duration-300 px-6 py-3 rounded-xl opacity-50 cursor-not-allowed border border-transparent">
            <span className="font-semibold">Forward</span>
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Title Section */}
        <div className="text-center mb-20">
          <div className="flex items-center justify-center mb-10">
            <div className="relative">
              <div className="absolute -inset-3 bg-gradient-to-r from-green-600 via-green-400 to-emerald-600 rounded-full blur-lg opacity-50"></div>
              <div className="relative w-24 h-24 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-2xl border-2 border-green-300/30">
                <CheckCircle className="w-14 h-14 text-white drop-shadow-lg" />
              </div>
            </div>
          </div>
          <h1 className="text-7xl font-black text-white mb-8 tracking-tight">
            <span className="bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent drop-shadow-2xl">
              Email Analysis Complete!
            </span>
          </h1>
          <div className="w-64 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent mx-auto mb-10 rounded-full"></div>
          <p className="text-gray-300 text-xl max-w-4xl mx-auto leading-relaxed font-medium">
            <span className="text-2xl font-bold text-white">Great!</span> I've analyzed your last <span className="text-blue-400 font-bold">{analysisData.totalEmails.toLocaleString()}</span> emails.<br />
            <span className="text-gray-400">Here's a breakdown of your inbox to create your perfect organization system.</span>
          </p>
        </div>

        {/* Analysis Summary Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 mb-20">
          {categoryData.map((category, index) => {
            // Extract color name for reliable bullet points and progress bars
            const colorName = category.accentColor.replace('text-', '');
            const bgColorClass = `bg-${colorName}`;
            
            return (
              <div
                key={category.name}
                className={`relative transition-all duration-700 ease-out group ${
                  showStats
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-8'
                }`}
                style={{ 
                  transitionDelay: `${index * 100}ms`,
                  animationDelay: `${index * 100}ms`
                }}
                              >
                <div className="relative h-full rounded-3xl border border-gray-800/50 p-3 bg-gradient-to-br from-gray-900/60 to-gray-950/90 backdrop-blur-md shadow-2xl transition-all duration-500 group-hover:border-gray-700/60 group-hover:shadow-3xl">
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
                  <div className={`relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-2xl p-8 ${category.bgColor} backdrop-blur-sm border-2 shadow-inner transition-all duration-500 group-hover:bg-black/95 group-hover:border-gray-800/90`}>
                    <div className="relative flex flex-1 flex-col justify-between gap-6">
                      {/* Icon Section */}
                      <div className="flex items-center justify-between">
                        <div className="w-16 h-16 rounded-2xl border-2 border-gray-800/60 bg-black/70 backdrop-blur-sm flex items-center justify-center shadow-lg transition-all duration-500 group-hover:scale-105 group-hover:border-gray-700/70 group-hover:bg-gray-900/80 group-hover:shadow-xl">
                          <span className="text-2xl transition-all duration-300 group-hover:scale-110">{category.folderIcon}</span>
                        </div>
                        {/* Removed duplicate percentage text */}
                      </div>

                      {/* Title and Percentage */}
                      <div className="space-y-3">
                        <h3 className="text-2xl font-bold text-white tracking-tight leading-tight transition-all duration-300 group-hover:text-gray-100 group-hover:translate-x-1">
                          {category.name}
                        </h3>
                        <div className="text-center">
                          <div className={`text-5xl font-black ${category.accentColor} mb-2 drop-shadow-lg transition-all duration-300 group-hover:scale-105`}>
                            {category.percentage}%
                          </div>
                          <p className="text-gray-400 text-sm font-medium transition-all duration-300 group-hover:text-gray-300">
                            {Math.round((category.percentage / 100) * analysisData.totalEmails)} emails analyzed
                          </p>
                        </div>
                      </div>

                      {/* Sources */}
                      <div className="space-y-3">
                        <p className="text-sm font-bold text-gray-300 uppercase tracking-wider transition-all duration-300 group-hover:text-gray-200">Top Sources:</p>
                        <div className="space-y-2">
                          {category.sources.slice(0, 4).map((source, idx) => (
                            <div 
                              key={idx} 
                              className="flex items-center space-x-3 hover-group transition-all duration-300 group-hover:translate-x-1"
                            >
                              <div 
                                className={`w-3 h-3 ${bgColorClass} rounded-full shadow-lg border border-gray-600 hover-group-hover:scale-125 transition-all duration-200`}
                                style={{
                                  backgroundColor: category.accentColor.includes('blue') ? '#60a5fa' :
                                                 category.accentColor.includes('purple') ? '#a78bfa' :
                                                 category.accentColor.includes('yellow') ? '#facc15' :
                                                 category.accentColor.includes('cyan') ? '#22d3ee' :
                                                 category.accentColor.includes('green') ? '#4ade80' :
                                                 category.accentColor.includes('red') ? '#f87171' :
                                                 category.accentColor.includes('orange') ? '#fb923c' :
                                                 category.accentColor.includes('pink') ? '#f472b6' :
                                                 category.accentColor.includes('indigo') ? '#818cf8' :
                                                 '#9ca3af'
                                }}
                              ></div>
                              <span className="text-sm text-gray-200 font-semibold hover-group-hover:text-white hover-group-hover:translate-x-1 transition-all duration-200">
                                {source}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider transition-all duration-300 group-hover:text-gray-300">Progress</span>
                          <span className={`text-sm font-bold ${category.accentColor} transition-all duration-300 group-hover:scale-105`}>{category.percentage}%</span>
                        </div>
                        <div className="w-full bg-gray-800/60 rounded-full h-3 overflow-hidden border border-gray-700 transition-all duration-300 group-hover:border-gray-600">
                          <div 
                            className={`h-full rounded-full transition-all duration-1500 ease-out shadow-lg relative overflow-hidden`}
                            style={{ 
                              width: showStats ? `${Math.min(100, Math.max(0, category.percentage))}%` : '0%',
                              transitionDelay: `${index * 150 + 500}ms`,
                              backgroundColor: category.accentColor.includes('blue') ? '#60a5fa' :
                                             category.accentColor.includes('purple') ? '#a78bfa' :
                                             category.accentColor.includes('yellow') ? '#facc15' :
                                             category.accentColor.includes('cyan') ? '#22d3ee' :
                                             category.accentColor.includes('green') ? '#4ade80' :
                                             category.accentColor.includes('red') ? '#f87171' :
                                             category.accentColor.includes('orange') ? '#fb923c' :
                                             category.accentColor.includes('pink') ? '#f472b6' :
                                             category.accentColor.includes('indigo') ? '#818cf8' :
                                             '#9ca3af'
                            }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Most Frequent Contacts Section */}
        <div 
          className={`relative transition-all duration-700 ease-out mb-20 ${
            showStats
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-4'
            }`}
          style={{ transitionDelay: '900ms' }}
        >
          {/* Removed blue glow for contacts section */}
          
          <div className="relative rounded-3xl border border-gray-800/50 p-3 bg-gradient-to-br from-gray-900/60 to-gray-950/90 backdrop-blur-md shadow-2xl group hover:border-gray-700/60 hover:shadow-3xl transition-all duration-500">
            <GlowingEffect
              blur={0}
              borderWidth={2}
              spread={40}
              glow={true}
              disabled={false}
              proximity={60}
              inactiveZone={0.05}
              movementDuration={2}
            />
            <div className="relative bg-black/90 border-2 border-gray-800/70 rounded-2xl p-10 backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:bg-black/95 group-hover:border-gray-800/90">
              <div className="flex items-center space-x-5 mb-10">
                <div className="w-14 h-14 bg-black/70 border-2 border-gray-800/60 rounded-xl flex items-center justify-center shadow-lg transition-all duration-500 group-hover:bg-gray-900/80 group-hover:border-gray-700/70">
                  <Users className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="text-4xl font-bold text-white tracking-tight">
                  Your Most Frequent Contacts
                </h3> 
              </div>
              
              <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent mb-8"></div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {analysisData.topContacts.map((contact, idx) => (
                  <div 
                    key={idx} 
                    className="relative group"
                  >
                    {/* 3D Glassy Glow Effect */}
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 via-cyan-500/30 to-blue-500/20 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-400/10 via-cyan-400/15 to-blue-400/10 rounded-xl blur-md opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
                    
                    <div className="relative flex items-center space-x-4 p-5 bg-black/70 border border-gray-800/50 rounded-xl hover:bg-gray-900/80 hover:border-gray-700/60 transition-all duration-500 backdrop-blur-sm hover:transform hover:translate-y-[-2px] hover:shadow-2xl group-hover:shadow-blue-500/10">
                      <div className="w-4 h-4 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full shadow-lg group-hover:scale-125 transition-transform border border-blue-300/30 group-hover:shadow-blue-400/50"></div>
                      <span className="text-gray-100 font-mono text-sm font-bold group-hover:text-white transition-colors flex-1">
                        {contact}
                      </span>
                      <div className="w-8 h-8 bg-gray-800/70 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 border border-gray-700/50 group-hover:border-gray-600/60 group-hover:bg-gray-700/80">
                        <span className="text-xs text-gray-300 font-bold">{idx + 1}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer & CTA Section */}
        <div 
          className={`relative transition-all duration-700 ease-out ${
            showStats
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-4'
            }`}
          style={{ transitionDelay: '1000ms' }}
        >
          {/* Removed blue glow for footer section */}
          
          <div className="relative rounded-3xl border border-gray-800/50 p-3 bg-gradient-to-br from-black/90 to-gray-900/95 backdrop-blur-md shadow-2xl group hover:border-gray-800/60 hover:shadow-3xl transition-all duration-500">
            <GlowingEffect
              blur={0}
              borderWidth={3}
              spread={80}
              glow={true}
              disabled={false}
              proximity={100}
              inactiveZone={0.1}
              movementDuration={1.8}
            />
            <div className="relative bg-gradient-to-br from-black/90 to-gray-900/95 border-2 border-gray-800/70 rounded-2xl p-12 text-center backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:from-gray-900/95 group-hover:to-black/95 group-hover:border-gray-800/90">
              <div className="mb-10">
                <div className="flex items-center justify-center mb-6">
                  <CheckCircle className="w-16 h-16 text-green-400 drop-shadow-lg" />
                </div>
                <h3 className="text-4xl font-bold text-white mb-6 tracking-tight">
                  Ready to organize!
                </h3>
                <div className="w-32 h-px bg-gradient-to-r from-transparent via-gray-500 to-transparent mx-auto mb-8"></div>
                <p className="text-gray-300 text-xl max-w-3xl mx-auto leading-relaxed font-medium">
                  Based on this analysis, I've prepared smart folder suggestions and automatic sorting rules.<br />
                  <span className="text-blue-400 font-semibold">You can review and customize them next.</span>
                </p>
              </div>

              <div className="relative group flex justify-center">
                <HoverBorderGradient
                  containerClassName="rounded-full"
                  as="button"
                  className="bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 hover:from-blue-600 hover:via-blue-700 hover:to-blue-800 text-white flex items-center space-x-4 px-12 py-5 text-xl font-bold transition-all duration-300 hover:scale-105 shadow-2xl border border-blue-400/20 backdrop-blur-sm cursor-pointer"
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNext();
                  }}
                >
                  <span>Let's See the Folders</span>
                  <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                </HoverBorderGradient>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
