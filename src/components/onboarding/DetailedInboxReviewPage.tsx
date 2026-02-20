'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  ArrowRight, 
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Mail,
  Edit3,
  Check,
  X,
  AlertCircle,
  Eye,
  Settings,
  Loader2,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Zap,
  TrendingUp,
  Target,
  Brain,
  Sparkles as SparklesIcon,
  ArrowUpDown,
  SlidersHorizontal,
  Inbox,
  Archive,
  ExternalLink
} from 'lucide-react';
import { LoaderFive } from '../ui/loader';
import { GlowingEffect } from '../ui/glowing-effect';
import { SparklesCore } from '../ui/sparkles';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';
import { getFolderIconWithFallback } from '@/lib/utils/folderIconHelper';
import { EmailViewModal } from './EmailViewModal';

interface DetailedInboxReviewPageProps {
  onNext: (data: any) => void;
  onBack: () => void;
  userName?: string;
  folders?: ReviewFolder[];
  mockMode?: boolean;
  maxEmailsToShow?: number;
}

interface ReviewFolder {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  emails: EmailPreview[];
  confidence: number;
}

interface EmailPreview {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body?: string; // Full email body content
  date: string;
  suggestedFolder: string;
  confidence: number;
  gmailCategories?: string[];
  isRead?: boolean;
  hasAttachment?: boolean;
  priority?: 'high' | 'medium' | 'low';
  originalData?: any;
}

interface EmailCorrection {
  emailId: string;
  emailFrom: string;
  fromFolder: string;
  toFolder: string;
  shouldLearn: boolean;
  reason?: string;
  batchSuggestion?: BatchSuggestion;
}

interface BatchSuggestion {
  pattern: string;
  similarEmails: string[];
  suggestedRule: string;
  affectedCount: number;
  confidence: number;
}

interface FilterOptions {
  search: string;
  confidence: 'all' | 'high' | 'medium' | 'low';
  folders: string[];
  hasAttachment: 'all' | 'yes' | 'no';
  priority: 'all' | 'high' | 'medium' | 'low';
}

interface SortOptions {
  field: 'date' | 'confidence' | 'from' | 'subject';
  direction: 'asc' | 'desc';
}

// Enhanced mock data with more emails and variety
const generateMockReviewData = (): ReviewFolder[] => [
  {
    id: 'newsletters',
    name: 'Newsletters',
    icon: '📧',
    description: 'Marketing emails, newsletters, and promotional content',
    color: '#3B82F6',
    confidence: 92,
    emails: [
      {
        id: '1',
        from: 'news@forbes.com',
        subject: 'Forbes Daily: Tech Trends Shaping 2025',
        snippet: 'Good morning, here are today\'s top tech stories that every entrepreneur should know about AI, blockchain, and emerging markets...',
        body: `Good morning,

Here are today's top tech stories that every entrepreneur should know about AI, blockchain, and emerging markets.

The AI revolution continues to accelerate with new breakthroughs in machine learning and natural language processing. Companies are increasingly adopting AI solutions to streamline operations and gain competitive advantages.

Blockchain technology is also evolving rapidly, with new use cases emerging beyond cryptocurrency. From supply chain management to digital identity verification, blockchain is proving its value across industries.

Emerging markets are becoming hotbeds of innovation, with startups in regions like Southeast Asia and Latin America attracting significant investment.

Stay tuned for more updates on these exciting developments.

Best regards,
The Forbes Tech Team`,
        date: '2024-01-15T09:30:00Z',
        suggestedFolder: 'newsletters',
        confidence: 95,
        gmailCategories: ['PROMOTIONS'],
        isRead: false,
        hasAttachment: false,
        priority: 'medium'
      },
      {
        id: '2',
        from: 'hello@morningbrew.com',
        subject: 'Morning Brew: Market Updates & Business News',
        snippet: 'Rise and grind! Here\'s what happened in business news while you were sleeping. Tesla stock soars, crypto markets fluctuate...',
        body: `Rise and grind!

Here's what happened in business news while you were sleeping:

Tesla stock soared 8% in pre-market trading after announcing record Q4 deliveries. The electric vehicle maker delivered over 484,000 vehicles, exceeding analyst expectations.

Crypto markets continue to fluctuate as Bitcoin hovers around $45,000. Analysts predict increased volatility as institutional adoption grows.

The Federal Reserve is expected to maintain current interest rates at their next meeting, providing stability for markets.

In other news, several tech startups announced major funding rounds, signaling continued investor confidence in the sector.

Have a great day!

Cheers,
The Morning Brew Team`,
        date: '2024-01-15T06:00:00Z',
        suggestedFolder: 'newsletters',
        confidence: 98,
        isRead: true,
        hasAttachment: false,
        priority: 'low'
      },
      {
        id: '3',
        from: 'digest@techcrunch.com',
        subject: 'TC Daily Roundup: Startup Funding Hits Record High',
        snippet: 'Today\'s top stories: OpenAI announces new model, venture capital reaches all-time high, and more startup news...',
        body: `Today's Top Stories

OpenAI announces new model with enhanced capabilities for natural language processing and code generation. The company claims significant improvements in reasoning and safety.

Venture capital funding reaches all-time high in Q4 2024, with over $150 billion invested globally. Early-stage startups continue to attract significant interest from investors.

Several fintech startups announce major funding rounds, signaling continued growth in the financial technology sector.

Stay tuned for more updates on these exciting developments in the startup ecosystem.

Best regards,
The TechCrunch Team`,
        date: '2024-01-14T18:45:00Z',
        suggestedFolder: 'newsletters',
        confidence: 94,
        isRead: false,
        hasAttachment: true,
        priority: 'medium'
      },
      {
        id: '4',
        from: 'updates@substack.com',
        subject: 'Your weekly digest from favorite creators',
        snippet: 'New posts from the writers you follow: "The Future of Remote Work" by Sarah Chen, "Investment Strategies" by Mark Johnson...',
        date: '2024-01-14T10:00:00Z',
        suggestedFolder: 'newsletters',
        confidence: 89,
        isRead: true,
        hasAttachment: false,
        priority: 'low'
      }
    ]
  },
  {
    id: 'financials',
    name: 'Financials',
    icon: '💰',
    description: 'Receipts, invoices, banking, and financial documents',
    color: '#F59E0B',
    confidence: 96,
    emails: [
      {
        id: '5',
        from: 'receipts@stripe.com',
        subject: 'Payment Receipt - $299.99 - Pro Plan Upgrade',
        snippet: 'Thank you for your payment. Your subscription has been upgraded to Pro. Receipt #INV-2024-001234 is attached for your records...',
        body: `Thank you for your payment!

Your subscription has been successfully upgraded to Pro Plan.

PAYMENT DETAILS:
- Amount: $299.99
- Receipt #: INV-2024-001234
- Date: January 15, 2024
- Payment Method: Visa ending in 4242

Your Pro Plan benefits are now active and include:
- Advanced analytics
- Priority support
- Custom integrations
- Unlimited API calls

A detailed receipt is attached to this email for your records.

If you have any questions about this payment, please don't hesitate to contact our support team.

Best regards,
The Stripe Team`,
        date: '2024-01-15T14:22:00Z',
        suggestedFolder: 'financials',
        confidence: 99,
        isRead: false,
        hasAttachment: true,
        priority: 'high'
      },
      {
        id: '6',
        from: 'noreply@chase.com',
        subject: 'Your Chase Account Statement is Ready',
        snippet: 'Your monthly statement for account ending in 1234 is now available. Sign in to view your statement and recent transactions...',
        date: '2024-01-14T08:15:00Z',
        suggestedFolder: 'financials',
        confidence: 97,
        isRead: true,
        hasAttachment: true,
        priority: 'medium'
      },
      {
        id: '7',
        from: 'billing@aws.amazon.com',
        subject: 'AWS Billing Statement - December 2024',
        snippet: 'Your AWS bill for December 2024 is $127.45. View detailed usage breakdown and optimize your costs with our recommendations...',
        date: '2024-01-13T12:30:00Z',
        suggestedFolder: 'financials',
        confidence: 98,
        isRead: false,
        hasAttachment: true,
        priority: 'high'
      }
    ]
  },
  {
    id: 'notifications',
    name: 'Notifications',
    icon: '🔔',
    description: 'System alerts, automated notifications, and status updates',
    color: '#10B981',
    confidence: 88,
    emails: [
      {
        id: '8',
        from: 'notifications@github.com',
        subject: '[clira-app] Pull Request #47 requires your review',
        snippet: 'A new pull request "Implement email categorization service" needs your review. 15 files changed, 234 additions, 67 deletions...',
        date: '2024-01-15T16:45:00Z',
        suggestedFolder: 'notifications',
        confidence: 91,
        isRead: false,
        hasAttachment: false,
        priority: 'high'
      },
      {
        id: '9',
        from: 'no-reply@linear.app',
        subject: 'Task assigned: Fix email parsing bug',
        snippet: 'Alex Patel assigned you to "Fix email parsing bug in production". Priority: High. Due date: Tomorrow...',
        date: '2024-01-15T15:20:00Z',
        suggestedFolder: 'notifications',
        confidence: 85,
        isRead: true,
        hasAttachment: false,
        priority: 'high'
      },
      {
        id: '10',
        from: 'alerts@vercel.com',
        subject: 'Deployment successful: clira-app-production',
        snippet: 'Your deployment to production was successful. Build time: 2m 34s. All systems operational. View deployment logs...',
        date: '2024-01-15T11:10:00Z',
        suggestedFolder: 'notifications',
        confidence: 89,
        isRead: true,
        hasAttachment: false,
        priority: 'medium'
      },
      {
        id: '11',
        from: 'security@google.com',
        subject: 'New sign-in from Chrome on Mac',
        snippet: 'We noticed a new sign-in to your Google Account from Chrome on Mac. If this was you, you can ignore this email...',
        date: '2024-01-14T20:30:00Z',
        suggestedFolder: 'notifications',
        confidence: 82,
        isRead: false,
        hasAttachment: false,
        priority: 'medium'
      }
    ]
  },
  {
    id: 'work',
    name: 'Work',
    icon: '💼',
    description: 'Professional communications and work-related emails',
    color: '#8B5CF6',
    confidence: 91,
    emails: [
      {
        id: '12',
        from: 'sarah.chen@company.com',
        subject: 'Q1 Planning Meeting - Thursday 2PM',
        snippet: 'Hi team, let\'s schedule our Q1 planning session for Thursday at 2PM PST. We\'ll cover roadmap priorities, resource allocation, and key metrics...',
        body: `Hi team,

I hope everyone had a great holiday break! Let's schedule our Q1 planning session for Thursday at 2PM PST.

Agenda:
- Review Q4 performance and key learnings
- Discuss Q1 roadmap priorities
- Resource allocation planning
- Key metrics and success criteria
- Team goals and objectives

Please come prepared with your thoughts on priorities and any blockers you'd like to discuss.

I've attached the Q4 performance report and Q1 planning template for your review.

Looking forward to a productive session!

Best regards,
Sarah Chen
Product Manager`,
        date: '2024-01-15T13:45:00Z',
        suggestedFolder: 'work',
        confidence: 94,
        isRead: false,
        hasAttachment: true,
        priority: 'high'
      },
      {
        id: '13',
        from: 'hr@company.com',
        subject: 'Annual Review Process - Action Required',
        snippet: 'It\'s time for your annual performance review. Please complete your self-evaluation by January 20th. Login to the HR portal to get started...',
        date: '2024-01-14T16:00:00Z',
        suggestedFolder: 'work',
        confidence: 96,
        isRead: true,
        hasAttachment: true,
        priority: 'high'
      },
      {
        id: '14',
        from: 'legal@company.com',
        subject: 'Contract Review: NDA with TechCorp',
        snippet: 'Please review the attached NDA with TechCorp. Key changes highlighted in yellow. Legal approval needed by EOD Friday...',
        date: '2024-01-14T09:15:00Z',
        suggestedFolder: 'work',
        confidence: 88,
        isRead: false,
        hasAttachment: true,
        priority: 'high'
      }
    ]
  },
  {
    id: 'review',
    name: 'Review',
    icon: '👀',
    description: 'Emails that need manual review and careful attention',
    color: '#6B7280',
    confidence: 100,
    emails: [
      {
        id: '15',
        from: 'partnerships@newstartup.co',
        subject: 'Partnership Opportunity: AI Email Management',
        snippet: 'We\'d love to explore a strategic partnership between our companies. Our AI-powered analytics could complement your email management platform...',
        date: '2024-01-13T14:20:00Z',
        suggestedFolder: 'review',
        confidence: 65,
        isRead: false,
        hasAttachment: true,
        priority: 'medium'
      },
      {
        id: '16',
        from: 'unknown.sender@randomdomain.io',
        subject: 'Investment Opportunity - Time Sensitive',
        snippet: 'Hello, I represent a group of investors interested in your company. We\'d like to discuss a potential Series A investment...',
        date: '2024-01-12T10:45:00Z',
        suggestedFolder: 'review',
        confidence: 45,
        isRead: false,
        hasAttachment: false,
        priority: 'low'
      }
    ]
  }
];

// Removed - now using getFolderIconWithFallback from helper

const ITEMS_PER_PAGE = 10;

// Helper function to format snippet as email body (fallback when no body is available)
const formatSnippetAsEmailBody = (snippet: string, senderName: string): string => {
  if (!snippet || snippet === 'No preview available') {
    return `Hi there,

This is a sample email from ${senderName}.

Best regards,
${senderName}`;
  }

  // Split the snippet into sentences and format as a proper email
  const sentences = snippet.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  if (sentences.length === 0) {
    return `Hi there,

${snippet}

Best regards,
${senderName}`;
  }

  // Create a more realistic email structure
  let body = `Hi there,

${sentences[0].trim()}.`;

  // Add remaining sentences as separate paragraphs
  for (let i = 1; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    if (sentence.length > 0) {
      body += `\n\n${sentence}.`;
    }
  }

  body += `\n\nBest regards,\n${senderName}`;
  
  return body;
};

export const DetailedInboxReviewPage: React.FC<DetailedInboxReviewPageProps> = ({ 
  onNext, 
  onBack,
  userName,
  folders = [],
  mockMode = false,
  maxEmailsToShow = 50
}) => {
  // State management
  const [reviewData, setReviewData] = useState<ReviewFolder[]>(mockMode ? generateMockReviewData() : []);
  const [loading, setLoading] = useState(!mockMode);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['notifications', 'work'])); // Start with some folders expanded
  const [corrections, setCorrections] = useState<EmailCorrection[]>([]);
  const [showContent, setShowContent] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailPreview | null>(null);
  const [showQuickAdjust, setShowQuickAdjust] = useState(false);
  const [showEmailView, setShowEmailView] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showBatchSuggestion, setShowBatchSuggestion] = useState(false);
  const [currentBatchSuggestion, setCurrentBatchSuggestion] = useState<BatchSuggestion | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState<Record<string, number>>({});
  const [processing, setProcessing] = useState(false);

  // Filtering and sorting state
  const [filters, setFilters] = useState<FilterOptions>({
    search: '',
    confidence: 'all',
    folders: [],
    hasAttachment: 'all',
    priority: 'all'
  });
  const [sort, setSort] = useState<SortOptions>({
    field: 'date',
    direction: 'desc'
  });
  const [showFilters, setShowFilters] = useState(false);

  // Statistics
  const [stats, setStats] = useState({
    totalEmails: 0,
    foldersCount: 0,
    averageConfidence: 0,
    highConfidenceCount: 0,
    reviewNeededCount: 0,
    correctionsCount: 0
  });

  // define calculateStats before using in effects to satisfy eslint and TS ordering
  const calculateStats = useCallback((folders: ReviewFolder[]) => {
    const allEmails = folders.flatMap(folder => folder.emails);
    const totalEmails = allEmails.length;
    const totalConfidence = allEmails.reduce((sum, email) => sum + email.confidence, 0);
    const highConfidenceCount = allEmails.filter(email => email.confidence >= 90).length;
    const reviewNeededCount = allEmails.filter(email => email.confidence < 70).length;
    setStats({
      totalEmails,
      foldersCount: folders.length,
      averageConfidence: totalEmails > 0 ? Math.round(totalConfidence / totalEmails) : 0,
      highConfidenceCount,
      reviewNeededCount,
      correctionsCount: corrections.length
    });
  }, [corrections.length]);

  const fetchReviewData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/onboarding/email-categorization`);
      const data = await response.json();

      if (data.success && data.result) {
        const { folderSuggestions, categorizedEmails } = data.result;

        const emailsByFolderName = new Map<string, EmailPreview[]>();

        // Process categorized email senders
        // Group by suggested folder
        const folderGroups = new Map<string, { count: number, ids: string[], subjects: string[] }>();
        
        for (const sender of categorizedEmails) {
          if (!sender.suggestedFolder) {
            continue;
          }
          
          const existing = folderGroups.get(sender.suggestedFolder) || { count: 0, ids: [], subjects: [] };
          existing.count += sender.frequency;
          existing.ids.push(...sender.sampleSubjects.map((_: any, index: number) => `email-${sender.emailAddress}-${index}`));
          existing.subjects.push(...sender.sampleSubjects);
          folderGroups.set(sender.suggestedFolder, existing);
        }

        for (const sender of categorizedEmails) {
          if (!sender.suggestedFolder) {
            continue;
          }

          if (!emailsByFolderName.has(sender.suggestedFolder)) {
            emailsByFolderName.set(sender.suggestedFolder, []);
          }

          const subjects = sender.sampleSubjects || [];
          const snippets = sender.sampleSnippets || [];
          const bodies = sender.sampleBodies || [];
          const dates = sender.sampleDates || [];
          const ids: string[] = Array.isArray((sender as any).sampleMessageIds) ? (sender as any).sampleMessageIds : [];

          // CRITICAL FIX: Don't drop emails without message IDs - create previews anyway
          const count = Math.max(1, ids.length > 0
            ? Math.min(subjects.length, snippets.length, bodies.length, dates.length, ids.length)
            : Math.min(subjects.length, snippets.length, Math.max(1, bodies.length), Math.max(1, dates.length)));


          
          // Ensure we have at least some preview data even if messageIds are missing
          for (let i = 0; i < count; i++) {
            const snippet = sender.sampleSnippets[i] || 'No preview available';
            // Use the actual email body if available, otherwise create from snippet
            const body = sender.sampleBodies && sender.sampleBodies[i] 
              ? sender.sampleBodies[i] 
              : formatSnippetAsEmailBody(snippet, sender.senderName || sender.emailAddress);
            
            const emailPreview: EmailPreview = {
              id: `${sender.emailAddress}-${i}`,
              from: sender.senderName || sender.emailAddress,
              subject: sender.sampleSubjects[i] || 'No Subject',
              snippet: snippet,
              body: body,
              date: sender.sampleDates && sender.sampleDates[i] 
                ? (typeof sender.sampleDates[i] === 'string' ? sender.sampleDates[i] : new Date(sender.sampleDates[i]).toISOString())
                : new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(), // Use actual date if available, fallback to random
              suggestedFolder: sender.suggestedFolder,
              confidence: sender.confidence,
              gmailCategories: [], 
              isRead: Math.random() > 0.5,
              hasAttachment: Math.random() > 0.2,
              priority: 'medium',
              originalData: {
                gmailMessageId: Array.isArray(ids) ? ids[i] : undefined,
                emailAddress: sender.emailAddress
              }
            };
            emailsByFolderName.get(sender.suggestedFolder)!.push(emailPreview);
          }
        }

        const reviewFolders: ReviewFolder[] = folderSuggestions.map((folderSugg: any) => {
          const emails = emailsByFolderName.get(folderSugg.name) || [];
          const folderId = folderSugg.name.toLowerCase().replace(/\s+/g, '-');
          
          emails.forEach(email => email.suggestedFolder = folderId);
          
          const confidence = emails.length > 0
            ? Math.round(emails.reduce((sum, email) => sum + email.confidence, 0) / emails.length)
            : 100;

          return {
            id: folderId,
            name: folderSugg.name,
            icon: getFolderIconWithFallback(folderSugg.name, folderSugg.description),
            description: folderSugg.description,
            color: folderSugg.color,
            emails: emails,
            confidence: confidence
          };
        });

        setReviewData(reviewFolders);
        calculateStats(reviewFolders);
        setShowContent(true);
      } else {
        throw new Error(data.error || 'Failed to fetch review data');
      }
    } catch (error) {
      console.error('Error fetching review data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load inbox preview');
      const mockData = generateMockReviewData();
      setReviewData(mockData);
      calculateStats(mockData);
      setShowContent(true);
    } finally {
      setLoading(false);
    }
  }, [calculateStats]); // Add calculateStats dependency

  useEffect(() => {
    if (mockMode) {
      const data = generateMockReviewData();
      setReviewData(data);
      calculateStats(data);
      setLoading(false);
      setShowContent(true);
      return;
    }
    
    fetchReviewData();
  }, [mockMode, calculateStats, fetchReviewData]);

  // calculateStats moved above to satisfy lint rule ordering

  // Memoized filtered and sorted emails
  const filteredAndSortedFolders = useMemo(() => {
    return reviewData.map(folder => {
      let filteredEmails = folder.emails;

      // Apply search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        filteredEmails = filteredEmails.filter(email =>
          email.from.toLowerCase().includes(searchTerm) ||
          email.subject.toLowerCase().includes(searchTerm) ||
          email.snippet.toLowerCase().includes(searchTerm)
        );
      }

      // Apply confidence filter
      if (filters.confidence !== 'all') {
        filteredEmails = filteredEmails.filter(email => {
          if (filters.confidence === 'high') return email.confidence >= 90;
          if (filters.confidence === 'medium') return email.confidence >= 70 && email.confidence < 90;
          if (filters.confidence === 'low') return email.confidence < 70;
          return true;
        });
      }

      // Apply attachment filter
      if (filters.hasAttachment !== 'all') {
        filteredEmails = filteredEmails.filter(email => {
          if (filters.hasAttachment === 'yes') return email.hasAttachment;
          if (filters.hasAttachment === 'no') return !email.hasAttachment;
          return true;
        });
      }

      // Apply priority filter
      if (filters.priority !== 'all') {
        filteredEmails = filteredEmails.filter(email => email.priority === filters.priority);
      }

      // Apply folder filter
      if (filters.folders.length > 0) {
        if (!filters.folders.includes(folder.id)) {
          filteredEmails = [];
        }
      }

      // Sort emails
      filteredEmails.sort((a, b) => {
        let aValue: any = a[sort.field as keyof EmailPreview];
        let bValue: any = b[sort.field as keyof EmailPreview];

        if (sort.field === 'date') {
          aValue = new Date(aValue).getTime();
          bValue = new Date(bValue).getTime();
        }

        if (typeof aValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (sort.direction === 'asc') {
          return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        } else {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        }
      });

      return {
        ...folder,
        emails: filteredEmails
      };
    }); // REMOVED: Don't filter out folders with 0 emails - show all folders
  }, [reviewData, filters, sort]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleModalTransition = (fromModal: 'emailView' | 'quickAdjust', toModal: 'emailView' | 'quickAdjust', email: EmailPreview) => {
    // Immediate transition - no delay, no flickering
    if (fromModal === 'emailView') {
      setShowEmailView(false);
    } else {
      setShowQuickAdjust(false);
    }
    
    // Use microtask for immediate execution
    Promise.resolve().then(() => {
      if (toModal === 'emailView') {
        setShowEmailView(true);
      } else {
        setShowQuickAdjust(true);
      }
    });
  };

  const handleEmailCorrection = async (email: EmailPreview, newFolderId: string, shouldLearn: boolean = false, reason?: string, ruleType?: 'specific' | 'domain' | 'general') => {
    setProcessing(true);
    
    try {
      // Handle specific and domain rules - create hard rules directly
      if (shouldLearn && (ruleType === 'specific' || ruleType === 'domain')) {
        try {
          const condition = ruleType === 'domain' ? 'domain' : 'sender';
          const value = ruleType === 'domain' ? `@${email.from.split('@')[1]}` : email.from;
          
          // Create hard rule using the same system as FolderEditorPage
          const ruleResponse = await fetch('/api/onboarding/inbox-review/learn-rule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ruleType: 'email_mapping',
              condition,
              value,
              targetFolderId: newFolderId,
              emailContext: email,
              confidence: 95
            })
          });

          if (!ruleResponse.ok) {
            console.error('Failed to create hard rule');
          } else {
    
          }
        } catch (error) {
          console.error('Error creating hard rule:', error);
        }
      }

      // Generate batch suggestion if shouldLearn is true (for general learnings)
      let batchSuggestion: BatchSuggestion | undefined = undefined;
      
      if (shouldLearn && ruleType === 'general') {
        // Call API to get batch suggestions
        try {
          const suggestionResponse = await fetch('/api/onboarding/inbox-review/batch-suggestion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              emailFrom: email.from,
              targetFolderId: newFolderId,
              suggestionType: email.from.includes('@') ? 'domain' : 'sender'
            })
          });

          if (suggestionResponse.ok) {
            const suggestionData = await suggestionResponse.json();
            if (suggestionData.success && suggestionData.suggestion.affectedCount > 1) {
              batchSuggestion = suggestionData.suggestion;
            }
          }
        } catch (error) {
          console.error('Error fetching batch suggestion:', error);
        }
      }

      const correction: EmailCorrection = {
        emailId: email.id,
        emailFrom: email.from,
        fromFolder: email.suggestedFolder,
        toFolder: newFolderId,
        shouldLearn: shouldLearn && ruleType === 'general', // Only general learnings go to EmailLearningService
        reason,
        batchSuggestion
      };

      setCorrections(prev => [...prev, correction]);

      // Update the email in the review data
      setReviewData(prev => {
        const updated = prev.map(folder => ({
          ...folder,
          emails: folder.emails.map(e => 
            e.id === email.id ? { ...e, suggestedFolder: newFolderId } : e
          )
        }));

        // Move email to new folder
        const emailToMove = prev
          .flatMap(f => f.emails)
          .find(e => e.id === email.id);

        if (emailToMove) {
          return updated.map(folder => {
            if (folder.id === newFolderId) {
              return {
                ...folder,
                emails: [...folder.emails.filter(e => e.id !== email.id), { ...emailToMove, suggestedFolder: newFolderId }]
              };
            } else {
              return {
                ...folder,
                emails: folder.emails.filter(e => e.id !== email.id)
              };
            }
          });
        }

        return updated;
      });

      // Show batch suggestion modal if applicable
      if (batchSuggestion) {
        setCurrentBatchSuggestion(batchSuggestion);
        setShowBatchSuggestion(true);
      }

    } catch (error) {
      console.error('Error processing correction:', error);
    } finally {
      setProcessing(false);
    }
  };

  const handleBatchCorrection = async (batchSuggestion: BatchSuggestion, apply: boolean) => {
    if (!apply) {
      setShowBatchSuggestion(false);
      setCurrentBatchSuggestion(undefined);
      return;
    }

    setProcessing(true);
    
    try {
      // Apply batch correction
      const response = await fetch('/api/onboarding/inbox-review/batch-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchSuggestion,
          apply: true
        })
      });

      if (response.ok) {
        // Update UI to reflect batch changes

      }
    } catch (error) {
      console.error('Error applying batch correction:', error);
    } finally {
      setProcessing(false);
      setShowBatchSuggestion(false);
      setCurrentBatchSuggestion(undefined);
    }
  };

  // Add ref to prevent duplicate handleContinue calls
  const isProcessingRef = useRef(false);

  const handleContinue = async () => {
    // Prevent duplicate calls - multiple layers of protection
    if (isProcessingRef.current || processing) {
      console.log('🚫 handleContinue already running, ignoring duplicate call');
      return;
    }
    
    isProcessingRef.current = true;
    
    try {
      setProcessing(true);
      console.log('🚀 Starting onboarding completion process...');
      
      if (corrections.length > 0) {
        // Process corrections with learning feedback
        const learningResponse = await fetch('/api/onboarding/learning/process-feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections })
        });

        if (!learningResponse.ok) {
          console.warn('Failed to process learning feedback, continuing anyway');
        }

        // Apply regular corrections
        const correctionResponse = await fetch('/api/onboarding/inbox-review/correct-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections })
        });

        if (!correctionResponse.ok) {
          throw new Error('Failed to apply corrections');
        }
      }

      // Mark onboarding as complete in the database
      try {
        const completeResponse = await fetch('/api/onboarding/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            step: 'detailed_inbox_review',
            corrections: corrections.length,
            stats,
            reviewedFolders: reviewData
          })
        });

        if (!completeResponse.ok) {
          console.warn('Failed to mark onboarding complete, continuing anyway');
        } else {
  
        }
      } catch (error) {
        console.error('Error marking onboarding complete:', error);
      }

      // Queue master prompt generation job
      // This must come AFTER onboarding completion since it requires labelingOnboardingGenerated: true
      try {
        console.log('🎯 Queueing prompt generation job...');
        const promptResponse = await fetch('/api/auto-fetch-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (promptResponse.ok) {
          const data = await promptResponse.json();
          if (data.jobId) {
            console.log(`🎯 Prompt generation job queued successfully: ${data.jobId}`);
          } else if (data.message && data.message.includes('already completed')) {
            console.log('✅ All prompts already generated, skipping job queue');
          } else if (data.message && data.message.includes('already in progress')) {
            console.log('⏳ Prompt generation already in progress, continuing');
          } else {
            console.log(`🎯 Prompt generation job queued: ${data.message || 'No specific message'}`);
          }
        } else {
          const errorData = await promptResponse.json().catch(() => ({}));
          console.warn(`⚠️ Failed to queue prompt generation job (${promptResponse.status}): ${errorData.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.warn('⚠️ Error queueing prompt generation job, continuing anyway:', error);
      }

      console.log('📤 Calling onNext with data (success path)...');
      onNext({ 
        reviewedFolders: reviewData,
        corrections,
        stats,
        filters,
        sort
      });
      
      console.log('✅ Onboarding completion process finished successfully');
    } catch (error) {
      console.error('Error applying corrections:', error);
      console.log('📤 Calling onNext with data (error path)...');
      onNext({ 
        reviewedFolders: reviewData,
        corrections,
        stats,
        filters,
        sort
      });
    } finally {
      setProcessing(false);
      isProcessingRef.current = false;
      console.log('🔄 Processing state reset, ready for next action');
    }
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      confidence: 'all',
      folders: [],
      hasAttachment: 'all',
      priority: 'all'
    });
    setCurrentPage({});
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 90) return 'text-emerald-400 bg-emerald-900/20 border-emerald-800';
    if (confidence >= 70) return 'text-yellow-400 bg-yellow-900/20 border-yellow-800';
    return 'text-red-400 bg-red-900/20 border-red-800';
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'text-red-400 bg-red-900/20 border-red-800';
      case 'medium': return 'text-yellow-400 bg-yellow-900/20 border-yellow-800';
      case 'low': return 'text-gray-400 bg-gray-900/20 border-gray-600';
      default: return 'text-gray-400 bg-gray-900/20 border-gray-600';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 0) return 'In the future'; // Handle edge case
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${Math.floor(diffInHours)}h ago`;
    if (diffInHours < 48) return 'Yesterday';
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`; // Days ago
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <LoaderFive text="Analyzing your inbox..." />
          <div className="text-center">
            <p className="text-gray-300 text-lg mb-2">Loading email preview</p>
            <p className="text-gray-500 text-sm">This may take a moment for large inboxes</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-red-900/40 border border-red-500/30 rounded-2xl flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Preview Failed to Load</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          <div className="flex space-x-3">
            <button
              onClick={fetchReviewData}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Try Again</span>
            </button>
            <button
              onClick={processing ? undefined : handleContinue}
              disabled={processing}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue Anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Enhanced Sparkles Background */}
      <div className="fixed inset-0 w-screen h-screen">
        <SparklesCore
          id="inboxreviewsparkles"
          background="transparent" 
          minSize={0.4}
          maxSize={1.2}
          particleDensity={25}
          className="w-full h-full"
          particleColor="#3b82f6"
          speed={0.3}
        />
      </div>

      {/* Main Content */}
      <div className="relative z-10">
        {/* Enhanced Header */}
        <div 
          className={`bg-black/80 backdrop-blur-xl border-b border-gray-800/50 sticky top-0 z-20 transition-all duration-1000 ease-out ${
            showContent ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
          }`}
        >
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <div className="absolute -inset-2 bg-gradient-to-r from-blue-600/20 via-blue-400/30 to-cyan-600/20 rounded-full blur-md"></div>
                  <div className="relative w-12 h-12 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-full flex items-center justify-center shadow-xl border border-blue-300/30">
                    <Eye className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white mb-1">Inbox Review</h1>
                  <p className="text-gray-400 text-sm">Review and adjust email sorting decisions</p>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="flex items-center space-x-6 text-sm">
                <div className="flex items-center space-x-2">
                  <Inbox className="w-4 h-4 text-blue-400" />
                  <span className="text-gray-300">{stats.totalEmails} emails</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Target className="w-4 h-4 text-emerald-400" />
                  <span className="text-gray-300">{stats.averageConfidence}% avg confidence</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Edit3 className="w-4 h-4 text-orange-400" />
                  <span className="text-gray-300">{corrections.length} corrections</span>
                </div>
              </div>
            </div>

            {/* Enhanced Search and Filters */}
            <div className="flex items-center space-x-4 mb-4">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search emails by sender, subject, or content..."
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="w-full bg-gray-900/50 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                />
              </div>

              {/* Filter Toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-all ${
                  showFilters 
                    ? 'bg-blue-900/30 border-blue-600 text-blue-400' 
                    : 'bg-gray-900/50 border-gray-700 text-gray-300 hover:border-gray-600'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Filters</span>
                {(filters.confidence !== 'all' || filters.folders.length > 0 || filters.hasAttachment !== 'all' || filters.priority !== 'all') && (
                  <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                )}
              </button>

              {/* Sort Options */}
              <div className="flex items-center space-x-2">
                <ArrowUpDown className="w-4 h-4 text-gray-400" />
                <select
                  value={`${sort.field}-${sort.direction}`}
                  onChange={(e) => {
                    const [field, direction] = e.target.value.split('-') as [typeof sort.field, typeof sort.direction];
                    setSort({ field, direction });
                  }}
                  className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="confidence-desc">Highest confidence</option>
                  <option value="confidence-asc">Lowest confidence</option>
                  <option value="from-asc">Sender A-Z</option>
                  <option value="from-desc">Sender Z-A</option>
                </select>
              </div>

              {/* Clear Filters */}
              {(filters.search || filters.confidence !== 'all' || filters.folders.length > 0 || filters.hasAttachment !== 'all' || filters.priority !== 'all') && (
                <button
                  onClick={clearFilters}
                  className="flex items-center space-x-2 px-3 py-2 text-gray-400 hover:text-gray-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                  <span className="text-sm">Clear</span>
                </button>
              )}
            </div>

            {/* Expandable Filters Panel */}
            {showFilters && (
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Confidence Filter */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Confidence Level</label>
                    <select
                      value={filters.confidence}
                      onChange={(e) => setFilters(prev => ({ ...prev, confidence: e.target.value as any }))}
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                    >
                      <option value="all">All confidence levels</option>
                      <option value="high">High (90%+)</option>
                      <option value="medium">Medium (70-89%)</option>
                      <option value="low">Low (&lt;70%)</option>
                    </select>
                  </div>

                  {/* Priority Filter */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Priority</label>
                    <select
                      value={filters.priority}
                      onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value as any }))}
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                    >
                      <option value="all">All priorities</option>
                      <option value="high">High priority</option>
                      <option value="medium">Medium priority</option>
                      <option value="low">Low priority</option>
                    </select>
                  </div>

                  {/* Attachment Filter */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Attachments</label>
                    <select
                      value={filters.hasAttachment}
                      onChange={(e) => setFilters(prev => ({ ...prev, hasAttachment: e.target.value as any }))}
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                    >
                      <option value="all">All emails</option>
                      <option value="yes">With attachments</option>
                      <option value="no">Without attachments</option>
                    </select>
                  </div>

                  {/* Folder Filter */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Folders</label>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {reviewData.map(folder => (
                        <label key={folder.id} className="flex items-center space-x-2 text-sm">
                          <input
                            type="checkbox"
                            checked={filters.folders.includes(folder.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFilters(prev => ({ ...prev, folders: [...prev.folders, folder.id] }));
                              } else {
                                setFilters(prev => ({ ...prev, folders: prev.folders.filter(id => id !== folder.id) }));
                              }
                            }}
                            className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                          />
                          <span className="text-gray-300">{folder.icon} {folder.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Enhanced Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center mb-1">
                  <Archive className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-lg font-bold text-white">{stats.totalEmails}</div>
                <div className="text-xs text-gray-400">Total Emails</div>
              </div>
              
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center mb-1">
                  <Settings className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-lg font-bold text-white">{stats.foldersCount}</div>
                <div className="text-xs text-gray-400">Folders</div>
              </div>
              
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center mb-1">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-lg font-bold text-white">{stats.averageConfidence}%</div>
                <div className="text-xs text-gray-400">Avg Confidence</div>
              </div>
              
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-lg font-bold text-white">{stats.highConfidenceCount}</div>
                <div className="text-xs text-gray-400">High Confidence</div>
              </div>
              
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center mb-1">
                  <AlertCircle className="w-4 h-4 text-yellow-400" />
                </div>
                <div className="text-lg font-bold text-white">{stats.reviewNeededCount}</div>
                <div className="text-xs text-gray-400">Need Review</div>
              </div>
              
              <div className="bg-gray-900/30 border border-gray-700 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center mb-1">
                  <Edit3 className="w-4 h-4 text-orange-400" />
                </div>
                <div className="text-lg font-bold text-white">{corrections.length}</div>
                <div className="text-xs text-gray-400">Corrections</div>
              </div>
            </div>
          </div>
        </div>

        {/* Email Folders */}
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div 
            className={`space-y-6 transition-all duration-1000 delay-200 ease-out ${
              showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
              {filteredAndSortedFolders.map((folder, index) => (
                <EnhancedFolderSection
                  key={folder.id}
                  folder={folder}
                  expanded={expandedFolders.has(folder.id)}
                  onToggle={() => toggleFolder(folder.id)}
                  onEmailCorrection={handleEmailCorrection}
                  onViewEmail={(email) => {
                    setSelectedEmail(email);
                    setShowEmailView(true);
                  }}
                  onOpenQuickAdjust={(email) => {
                    setSelectedEmail(email);
                    setShowQuickAdjust(true);
                  }}
                  allFolders={reviewData}
                  animationDelay={300 + index * 100}
                  showContent={showContent}
                  currentPage={currentPage[folder.id] || 0}
                  onPageChange={(page) => setCurrentPage(prev => ({ ...prev, [folder.id]: page }))}
                  itemsPerPage={ITEMS_PER_PAGE}
                  processing={processing}
                  formatDate={formatDate}
                  getConfidenceColor={getConfidenceColor}
                  getPriorityColor={getPriorityColor}
                />
              ))}
            </div>

            {/* Enhanced Corrections Summary */}
            {corrections.length > 0 && (
              <div 
                className={`mt-8 transition-all duration-1000 delay-800 ease-out ${
                  showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
              >
                <div className="bg-gradient-to-r from-blue-900/20 via-blue-800/20 to-purple-900/20 border border-blue-700/50 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <Brain className="w-6 h-6 text-blue-400" />
                      <h3 className="text-xl font-semibold text-blue-400">Learning from Your Corrections</h3>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-blue-300">
                      <SparklesIcon className="w-4 h-4" />
                      <span>{corrections.filter(c => c.shouldLearn).length} will create new rules</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-black/20 rounded-lg p-4">
                      <div className="text-lg font-bold text-white mb-1">{corrections.length}</div>
                      <div className="text-sm text-gray-300">Total corrections made</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-4">
                      <div className="text-lg font-bold text-white mb-1">{corrections.filter(c => c.shouldLearn).length}</div>
                      <div className="text-sm text-gray-300">Rules to be created</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-4">
                      <div className="text-lg font-bold text-white mb-1">{new Set(corrections.map(c => c.fromFolder)).size}</div>
                      <div className="text-sm text-gray-300">Folders improved</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Enhanced Navigation */}
            <div 
              className={`flex justify-between items-center mt-12 mb-6 transition-all duration-1000 delay-1000 ease-out ${
                showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-gray-700/20 via-gray-600/30 to-gray-700/20 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                <button
                  onClick={onBack}
                  disabled={processing}
                  className="relative px-8 py-4 bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-xl transition-all duration-300 flex items-center space-x-3 backdrop-blur-sm shadow-lg hover:shadow-xl disabled:opacity-50"
                >
                  <ArrowLeft className="w-5 h-5" />
                  <span className="font-semibold">Back to Summary</span>
                </button>
              </div>

              <div className="text-center">
                <p className="text-gray-100 text-lg font-semibold mb-2">
                  {stats.totalEmails} emails reviewed • {corrections.length} corrections made
                </p>
                <div className="w-32 h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent mx-auto"></div>
              </div>

              <div className="relative group flex justify-center">
                <div className="relative group">
                  <HoverBorderGradient
                    containerClassName="rounded-full"
                    as="button"
                    className="bg-gradient-to-r from-emerald-500 via-emerald-600 to-emerald-700 hover:from-emerald-600 hover:via-emerald-700 hover:to-emerald-800 text-white flex items-center space-x-3 px-10 py-4 text-lg font-bold transition-all duration-300 hover:scale-105 shadow-2xl border border-emerald-400/20 backdrop-blur-sm cursor-pointer"
                    onClick={processing ? undefined : handleContinue}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <span>Start Sorting</span>
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </HoverBorderGradient>
                  {processing && (
                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                      <div className="opacity-50 pointer-events-none">
                        <Loader2 className="w-5 h-5 animate-spin text-white" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      
      {/* Modals */}
      {showQuickAdjust && selectedEmail && (
        <EnhancedQuickAdjustModal
          email={selectedEmail}
          folders={reviewData}
          onClose={() => {
            setShowQuickAdjust(false);
            setSelectedEmail(null);
          }}
          onCorrect={handleEmailCorrection}
          processing={processing}
        />
      )}

      {showBatchSuggestion && currentBatchSuggestion && (
        <BatchSuggestionModal
          batchSuggestion={currentBatchSuggestion}
          onClose={() => setShowBatchSuggestion(false)}
          onApply={(apply) => handleBatchCorrection(currentBatchSuggestion, apply)}
          processing={processing}
        />
      )}

      {showEmailView && selectedEmail && (
        <EmailViewModal
          email={selectedEmail}
          onClose={() => {
            setShowEmailView(false);
            setSelectedEmail(null);
          }}
          onQuickAdjust={() => {
            handleModalTransition('emailView', 'quickAdjust', selectedEmail!);
          }}
        />
      )}
    </div>
  );
};

// Enhanced Folder Section Component
interface EnhancedFolderSectionProps {
  folder: ReviewFolder;
  expanded: boolean;
  onToggle: () => void;
  onEmailCorrection: (email: EmailPreview, newFolderId: string, shouldLearn: boolean, reason?: string, ruleType?: 'specific' | 'domain' | 'general') => void;
  onViewEmail: (email: EmailPreview) => void;
  onOpenQuickAdjust: (email: EmailPreview) => void;
  allFolders: ReviewFolder[];
  animationDelay: number;
  showContent: boolean;
  currentPage: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
  processing: boolean;
  formatDate: (date: string) => string;
  getConfidenceColor: (confidence: number) => string;
  getPriorityColor: (priority?: string) => string;
}

const EnhancedFolderSection: React.FC<EnhancedFolderSectionProps> = ({ 
  folder, 
  expanded, 
  onToggle, 
  onEmailCorrection,
  onViewEmail,
  onOpenQuickAdjust,
  allFolders,
  animationDelay,
  showContent,
  currentPage,
  onPageChange,
  itemsPerPage,
  processing,
  formatDate,
  getConfidenceColor,
  getPriorityColor
}) => {
  // Pagination logic
  const totalPages = Math.ceil(folder.emails.length / itemsPerPage);
  const startIndex = currentPage * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentEmails = folder.emails.slice(startIndex, endIndex);

  const handleQuickAdjust = (email: EmailPreview) => {
    onOpenQuickAdjust(email);
  };

// Removed - now handled by parent component

  const nextPage = () => {
    if (currentPage < totalPages - 1) {
      onPageChange(currentPage + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 0) {
      onPageChange(currentPage - 1);
    }
  };

  return (
    <div 
      className={`relative group transition-all duration-500 ${
        showContent ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
      }`}
      style={{ transitionDelay: `${animationDelay}ms` }}
    >
      {/* Enhanced glow effect */}
      <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/8 via-blue-400/12 to-blue-500/8 rounded-3xl blur-2xl transition-all duration-700 group-hover:from-blue-400/15 group-hover:via-blue-300/20 group-hover:to-blue-400/15 group-hover:blur-3xl"></div>
      <div className="absolute -inset-1 bg-blue-500/5 rounded-3xl blur-lg transition-all duration-500 group-hover:bg-blue-400/10"></div>
      
      <div className="relative rounded-3xl border border-gray-800/50 bg-black/80 backdrop-blur-md shadow-2xl transition-all duration-500 group-hover:border-gray-700/60 group-hover:shadow-3xl overflow-hidden">
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
        
        <div className="relative bg-black/70 border-2 border-gray-800/70 rounded-2xl backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:bg-black/80 group-hover:border-gray-700/80 overflow-hidden">
          
          {/* Enhanced Folder Header */}
          <div 
            className="flex items-center justify-between cursor-pointer hover:bg-gray-800/20 rounded-xl p-6 transition-all duration-200"
            onClick={onToggle}
          >
            <div className="flex items-center space-x-4 flex-1">
              <div className="text-3xl" style={{ textShadow: '0 0 20px rgba(59, 130, 246, 0.5)' }}>
                {folder.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <div 
                    className="w-4 h-4 rounded-full shadow-lg"
                    style={{ backgroundColor: folder.color, boxShadow: `0 0 10px ${folder.color}40` }}
                  />
                  <h3 className="text-2xl font-bold text-white">{folder.name}</h3>
                  <span className="text-sm text-gray-200 bg-gray-800/60 px-3 py-1 rounded-full font-medium border border-gray-700">
                    {folder.emails.length} emails
                  </span>
                  <span className={`text-sm px-3 py-1 rounded-full border font-medium ${getConfidenceColor(folder.confidence)}`}>
                    {folder.confidence}% confident
                  </span>
                  {folder.emails.some(e => e.priority === 'high') && (
                    <span className="text-sm px-2 py-1 rounded-full bg-red-900/30 border border-red-700 text-red-400 font-medium">
                      High Priority
                    </span>
                  )}
                </div>
                <p className="text-base text-gray-200 leading-relaxed font-medium">
                  {folder.description}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {folder.emails.length > itemsPerPage && expanded && (
                <div className="text-sm text-gray-400">
                  Page {currentPage + 1} of {totalPages}
                </div>
              )}
              <div className="p-3 hover:bg-gray-800 rounded-lg transition-colors group-hover:scale-105 duration-200">
                {expanded ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </div>
            </div>
          </div>

          {/* Enhanced Email List */}
          {expanded && (
            <div className="px-6 pb-6 overflow-hidden">
              {/* Email Grid */}
              <div className="space-y-4 mb-6 w-full overflow-hidden">
                {currentEmails.map((email, index) => (
                  <EnhancedEmailPreviewCard
                    key={email.id}
                    email={email}
                    onQuickAdjust={() => handleQuickAdjust(email)}
                    onViewEmail={() => onViewEmail(email)}
                    animationDelay={index * 50}
                    processing={processing}
                    formatDate={formatDate}
                    getConfidenceColor={getConfidenceColor}
                    getPriorityColor={getPriorityColor}
                  />
                ))}
              </div>

              {/* Enhanced Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between bg-gray-900/30 border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center space-x-2 text-sm text-gray-400">
                    <span>Showing {startIndex + 1}-{Math.min(endIndex, folder.emails.length)} of {folder.emails.length} emails</span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={prevPage}
                      disabled={currentPage === 0}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Previous</span>
                    </button>
                    
                    <div className="flex items-center space-x-1">
                      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                        const pageNum = currentPage < 3 ? i : currentPage - 2 + i;
                        if (pageNum >= totalPages) return null;
                        
                        return (
                          <button
                            key={pageNum}
                            onClick={() => onPageChange(pageNum)}
                            className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                              pageNum === currentPage
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'
                            }`}
                          >
                            {pageNum + 1}
                          </button>
                        );
                      })}
                    </div>
                    
                    <button
                      onClick={nextPage}
                      disabled={currentPage === totalPages - 1}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>


    </div>
  );
};

// Enhanced Email Preview Card Component
interface EnhancedEmailPreviewCardProps {
  email: EmailPreview;
  onQuickAdjust: () => void;
  onViewEmail: () => void;
  animationDelay: number;
  processing: boolean;
  formatDate: (date: string) => string;
  getConfidenceColor: (confidence: number) => string;
  getPriorityColor: (priority?: string) => string;
}

const EnhancedEmailPreviewCard: React.FC<EnhancedEmailPreviewCardProps> = ({ 
  email, 
  onQuickAdjust,
  onViewEmail, 
  animationDelay,
  processing,
  formatDate,
  getConfidenceColor,
  getPriorityColor
}) => {
  return (
    <div 
      className="group relative bg-gradient-to-r from-gray-900/50 via-gray-900/60 to-gray-900/50 border border-gray-700/50 rounded-xl p-5 hover:from-gray-800/60 hover:via-gray-800/70 hover:to-gray-800/60 hover:border-gray-600/50 transition-all duration-300 hover:shadow-lg hover:scale-[1.01] cursor-pointer w-full overflow-hidden"
      style={{ animationDelay: `${animationDelay}ms` }}
      onClick={onViewEmail}
    >
      {/* Priority Indicator */}
      {email.priority === 'high' && (
        <div className="absolute top-3 left-3 w-2 h-2 bg-red-400 rounded-full animate-pulse shadow-lg"></div>
      )}
      
      <div className="flex items-start justify-between w-full overflow-hidden">
        <div className="flex-1 min-w-0 pr-4 overflow-hidden">
          {/* Header Row */}
          <div className="flex items-center space-x-3 mb-3 w-full overflow-hidden">
            <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden">
              <Mail className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-blue-400 truncate">{email.from}</span>
            </div>
            
            <div className="flex items-center space-x-2 flex-shrink-0">
              <span className={`text-xs px-2 py-1 rounded-full border font-medium ${getConfidenceColor(email.confidence)}`}>
                {email.confidence}%
              </span>
              {email.priority && (
                <span className={`text-xs px-2 py-1 rounded-full border font-medium ${getPriorityColor(email.priority)}`}>
                  {email.priority}
                </span>
              )}
              {email.hasAttachment && (
                <div className="w-2 h-2 bg-green-400 rounded-full" title="Has attachment"></div>
              )}
              {!email.isRead && (
                <div className="w-2 h-2 bg-blue-400 rounded-full" title="Unread"></div>
              )}
            </div>
          </div>

          {/* Subject */}
          <h4 className="text-base font-bold text-white mb-3 leading-tight line-clamp-2 group-hover:text-blue-100 transition-colors">
            {email.subject}
          </h4>
          
          {/* Snippet */}
          <p className="text-sm text-gray-300 leading-relaxed line-clamp-3 mb-4 group-hover:text-gray-200 transition-colors">
            {email.snippet}
          </p>
          
          {/* Footer Row */}
          <div className="flex items-center justify-between w-full overflow-hidden">
            <div className="flex items-center space-x-4 text-xs text-gray-400 min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center space-x-1 flex-shrink-0">
                <Clock className="w-3 h-3" />
                <span>{formatDate(email.date)}</span>
              </div>
              {email.gmailCategories && email.gmailCategories.length > 0 && (
                <div className="flex space-x-1 flex-wrap min-w-0 overflow-hidden">
                  {email.gmailCategories.slice(0, 3).map((category) => (
                    <span key={category} className="text-xs text-purple-300 bg-purple-900/30 px-2 py-1 rounded border border-purple-800 flex-shrink-0">
                      {category}
                    </span>
                  ))}
                  {email.gmailCategories.length > 3 && (
                    <span className="text-xs text-gray-400 flex-shrink-0">+{email.gmailCategories.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex flex-col space-y-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickAdjust();
            }}
            disabled={processing}
            className="group flex items-center space-x-2 px-4 py-2 bg-gray-800/60 border border-gray-700 rounded-lg text-gray-100 text-sm font-medium hover:bg-gray-700/80 hover:border-gray-600 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Edit3 className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span>Adjust</span>
          </button>
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewEmail();
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-900/40 border border-gray-700 rounded-lg text-gray-300 text-sm font-medium hover:bg-gray-800/60 hover:border-gray-600 transition-all duration-200"
            title="View full email"
          >
            <ExternalLink className="w-3 h-3" />
            <span>View</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// Enhanced Quick Adjust Modal Component
interface EnhancedQuickAdjustModalProps {
  email: EmailPreview;
  folders: ReviewFolder[];
  onClose: () => void;
  onCorrect: (email: EmailPreview, newFolderId: string, shouldLearn: boolean, reason?: string, ruleType?: 'specific' | 'domain' | 'general') => void;
  processing: boolean;
}

const EnhancedQuickAdjustModal: React.FC<EnhancedQuickAdjustModalProps> = ({ 
  email, 
  folders, 
  onClose, 
  onCorrect, 
  processing 
}) => {
  const [selectedFolderId, setSelectedFolderId] = useState(email.suggestedFolder);
  const [shouldLearn, setShouldLearn] = useState(true);
  const [ruleType, setRuleType] = useState<'specific' | 'domain' | 'general'>('specific');
  const [reason, setReason] = useState('');


  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const handleSave = () => {
    if (selectedFolderId !== email.suggestedFolder) {
      onCorrect(email, selectedFolderId, shouldLearn, reason.trim() || undefined, ruleType);
    }
    onClose();
  };

  const currentFolder = folders.find(f => f.id === email.suggestedFolder);
  const newFolder = folders.find(f => f.id === selectedFolderId);
  const hasChanges = selectedFolderId !== email.suggestedFolder;

  return (
    <div 
      className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[99999] p-6 transition-all duration-200 ease-out"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative group max-w-2xl w-full h-[85vh] transition-all duration-200 ease-out transform">
        {/* Enhanced glow for modal */}
        <div className="absolute -inset-6 bg-gradient-to-r from-blue-500/10 via-purple-400/15 to-cyan-500/10 rounded-3xl blur-3xl"></div>
        
        <div 
          className="relative bg-black border-2 border-gray-800/60 rounded-3xl p-8 backdrop-blur-xl shadow-2xl transition-all duration-200 ease-out transform hover:scale-[1.02] flex flex-col h-full"
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
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">Adjust Email Sorting</h3>
              <p className="text-gray-400">Fine-tune where this email should go and teach the AI</p>
            </div>
            <button
              onClick={onClose}
              disabled={processing}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto pr-1 min-h-0">
          
          {/* Enhanced Email Preview */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-8">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <Mail className="w-5 h-5 text-blue-400" />
                <div>
                  <div className="text-base font-semibold text-blue-400 mb-1">{email.from}</div>
                  <div className="text-sm text-gray-400">{email.date}</div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {email.hasAttachment && (
                  <div className="text-xs bg-green-900/30 border border-green-700 text-green-400 px-2 py-1 rounded">
                    Has attachment
                  </div>
                )}
                {email.priority && (
                  <div className={`text-xs px-2 py-1 rounded border ${
                    email.priority === 'high' ? 'bg-red-900/30 border-red-700 text-red-400' :
                    email.priority === 'medium' ? 'bg-yellow-900/30 border-yellow-700 text-yellow-400' :
                    'bg-gray-900/30 border-gray-700 text-gray-400'
                  }`}>
                    {email.priority} priority
                  </div>
                )}
              </div>
            </div>
            <h4 className="text-lg font-bold text-white mb-3">{email.subject}</h4>
            <p className="text-gray-300 leading-relaxed line-clamp-3">{email.snippet}</p>
          </div>

          {/* Current vs New Folder Comparison */}
          {hasChanges && (
            <div className="grid grid-cols-2 gap-4 p-6 bg-gradient-to-r from-blue-900/10 via-purple-900/10 to-blue-900/10 border border-blue-800/30 rounded-lg mb-8">
              <div>
                <div className="text-sm text-gray-400 mb-2">Currently assigned to:</div>
                <div className="flex items-center space-x-2">
                  <span className="text-lg">{currentFolder?.icon}</span>
                  <span className="text-white font-medium">{currentFolder?.name}</span>
                </div>
              </div>
              <div>
                <div className="text-sm text-emerald-300 mb-2">Will be moved to:</div>
                <div className="flex items-center space-x-2">
                  <span className="text-lg">{newFolder?.icon}</span>
                  <span className="text-emerald-400 font-medium">{newFolder?.name}</span>
                </div>
              </div>
            </div>
          )}

          {/* Enhanced Folder Selection */}
          <div className="mb-8">
            <label className="block text-base font-medium text-gray-300 mb-4">
              Choose the correct folder:
            </label>
            <div className="grid grid-cols-1 gap-3 max-h-[40vh] md:max-h-[60vh] lg:max-h-[80vh] overflow-y-auto">
              {folders.map(folder => (
                <label
                  key={folder.id}
                  className={`flex items-center space-x-4 p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedFolderId === folder.id
                      ? 'bg-blue-900/20 border-blue-600 ring-2 ring-blue-500/50'
                      : 'bg-gray-800/30 border-gray-700 hover:border-gray-600 hover:bg-gray-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="folder"
                    value={folder.id}
                    checked={selectedFolderId === folder.id}
                    onChange={(e) => {
                      setSelectedFolderId(e.target.value);
                      // Auto-scroll to Teach AI section in next microtask to avoid layout thrash
                      Promise.resolve().then(() => {
                        const teachAISection = document.querySelector('[data-teach-ai-section]');
                        if (teachAISection) {
                          teachAISection.scrollIntoView({ 
                            behavior: 'smooth', 
                            block: 'start' 
                          });
                        }
                      });
                    }}
                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 focus:ring-blue-500 focus:ring-2 cursor-pointer"
                  />
                  <div className="text-2xl">{folder.icon}</div>
                  <div className="flex-1">
                    <div className="font-medium text-white">{folder.name}</div>
                    <div className="text-sm text-gray-400">{folder.description}</div>
                  </div>
                  <div className="text-sm text-gray-400">
                    {folder.emails.length} emails
                  </div>
                </label>
              ))}
            </div>
          </div>

                      {/* Enhanced Learning Options */}
            {hasChanges && (
              <div className="mb-8" data-teach-ai-section>
                <div className="bg-gradient-to-r from-purple-900/20 via-blue-900/20 to-purple-900/20 border border-purple-700/30 rounded-lg p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <Brain className="w-6 h-6 text-purple-400" />
                  <h4 className="text-lg font-semibold text-purple-400">Teach the AI</h4>
                </div>
                
                <div className="space-y-4">
                  <label className="flex items-start space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shouldLearn}
                      onChange={(e) => setShouldLearn(e.target.checked)}
                      className="w-5 h-5 text-purple-600 bg-gray-800 border-gray-600 rounded focus:ring-purple-500 focus:ring-2 mt-0.5 cursor-pointer"
                    />
                    <div>
                      <span className="text-base font-medium text-white">Create a rule to prevent this in the future</span>
                      <p className="text-sm text-gray-400 mt-1">
                        This will help the AI learn from your correction and improve future sorting accuracy.
                      </p>
                    </div>
                  </label>

                  {shouldLearn && (
                    <div className="ml-8">
                      {/* Simple Rule Type Selection */}
                      <div className="mb-6">
                        <h4 className="text-sm font-semibold text-gray-200 mb-3">How should the AI handle future emails from this sender?</h4>
                        
                        <div className="grid grid-cols-1 gap-3">
                          {/* Specific Rule Option */}
                          <button
                            onClick={() => setRuleType('specific')}
                            className={`relative p-4 rounded-xl border-2 transition-all duration-200 text-left cursor-pointer ${
                              ruleType === 'specific'
                                ? 'border-blue-500 bg-blue-900/20 ring-2 ring-blue-500/30'
                                : 'border-gray-700 hover:border-gray-600 bg-gray-800/30 hover:bg-gray-800/50'
                            }`}
                          >
                            <div className="flex items-start space-x-3">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                                ruleType === 'specific' 
                                  ? 'border-blue-500 bg-blue-500' 
                                  : 'border-gray-600'
                              }`}>
                                {ruleType === 'specific' && <div className="w-2 h-2 bg-white rounded-full"></div>}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                  <span className="text-sm font-bold text-white">Always put emails from this sender here</span>
                                  <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-1 rounded font-medium">Strict Rule</span>
                                </div>
                                <p className="text-xs text-gray-400">Every email from "{email.from}" will go to {newFolder?.name}</p>
                              </div>
                            </div>
                          </button>

                          {/* Domain Rule Option */}
                          {email.from.includes('@') && (
                            <button
                              onClick={() => setRuleType('domain')}
                              className={`relative p-4 rounded-xl border-2 transition-all duration-200 text-left cursor-pointer ${
                                ruleType === 'domain'
                                  ? 'border-blue-500 bg-blue-900/20 ring-2 ring-blue-500/30'
                                  : 'border-gray-700 hover:border-gray-600 bg-gray-800/30 hover:bg-gray-800/50'
                              }`}
                            >
                              <div className="flex items-start space-x-3">
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                                  ruleType === 'domain' 
                                    ? 'border-blue-500 bg-blue-500' 
                                    : 'border-gray-600'
                                }`}>
                                  {ruleType === 'domain' && <div className="w-2 h-2 bg-white rounded-full"></div>}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <span className="text-sm font-bold text-white">Always put emails from this domain here</span>
                                    <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-1 rounded font-medium">Domain Rule</span>
                                  </div>
                                  <p className="text-xs text-gray-400">Every email from "@{email.from.split('@')[1]}" will go to {newFolder?.name}</p>
                                </div>
                              </div>
                            </button>
                          )}

                          {/* General Learning Option */}
                          <button
                            onClick={() => setRuleType('general')}
                            className={`relative p-4 rounded-xl border-2 transition-all duration-200 text-left cursor-pointer ${
                              ruleType === 'general'
                                ? 'border-purple-500 bg-purple-900/20 ring-2 ring-purple-500/30'
                                : 'border-gray-700 hover:border-gray-600 bg-gray-800/30 hover:bg-gray-800/50'
                            }`}
                          >
                            <div className="flex items-start space-x-3">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                                ruleType === 'general' 
                                  ? 'border-purple-500 bg-purple-500' 
                                  : 'border-gray-600'
                              }`}>
                                {ruleType === 'general' && <div className="w-2 h-2 bg-white rounded-full"></div>}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                  <span className="text-sm font-bold text-white">Teach AI to be smarter about this sender</span>
                                  <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-1 rounded font-medium">AI Learning</span>
                                </div>
                                <p className="text-xs text-gray-400">This sender sends different types of emails - AI will learn to analyze content</p>
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                      
                      {/* Why? Feedback Input - Only show for general learning */}
                      {ruleType === 'general' && (
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Help the AI understand this sender better:
                          </label>
                          <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g., This sender sends both work emails and newsletters, so you should look at content/subject to decide where to put future emails from them..."
                            rows={3}
                            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all resize-none"
                            maxLength={500}
                          />
                          <div className="text-xs text-gray-400 mt-1">
                            {reason.length}/500 characters - This helps the AI learn your preferences
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          </div> {/* End scrollable content */}
          
          {/* Action Buttons */}
          <div className="flex items-center space-x-4">
            <button
              onClick={handleSave}
              disabled={processing || !hasChanges}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:scale-100 flex items-center justify-center space-x-2 cursor-pointer"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>{hasChanges ? 'Save Changes' : 'No Changes'}</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              disabled={processing}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Batch Suggestion Modal Component
interface BatchSuggestionModalProps {
  batchSuggestion: BatchSuggestion;
  onClose: () => void;
  onApply: (apply: boolean) => void;
  processing: boolean;
}

const BatchSuggestionModal: React.FC<BatchSuggestionModalProps> = ({
  batchSuggestion,
  onClose,
  onApply,
  processing
}) => {
  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[99999] p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative group max-w-lg w-full">
        <div className="absolute -inset-6 bg-gradient-to-r from-yellow-500/10 via-orange-400/15 to-red-500/10 rounded-3xl blur-3xl"></div>
        
        <div 
          className="relative bg-gradient-to-br from-gray-900/95 via-gray-900/98 to-gray-950/95 border-2 border-yellow-700/60 rounded-3xl p-8 backdrop-blur-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Zap className="w-6 h-6 text-yellow-400" />
              <h3 className="text-xl font-bold text-yellow-400">Batch Suggestion</h3>
            </div>
            <button
              onClick={onClose}
              disabled={processing}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          
          <div className="mb-6">
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
              <p className="text-yellow-200 mb-2">
                <strong>Smart suggestion:</strong> {batchSuggestion.suggestedRule}
              </p>
              <p className="text-sm text-gray-300">
                This would affect <strong>{batchSuggestion.affectedCount}</strong> similar emails.
              </p>
              <div className="mt-3 text-xs text-gray-400">
                Confidence: {batchSuggestion.confidence}%
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => onApply(true)}
              disabled={processing}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg font-medium hover:from-yellow-600 hover:to-orange-600 transition-all disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Applying...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Apply to All</span>
                </>
              )}
            </button>
            <button
              onClick={() => onApply(false)}
              disabled={processing}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
