'use client';

import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, 
  ArrowLeft,
  Edit3, 
  Plus,
  ChevronDown,
  ChevronUp,
  X,
  Check,
  Trash2,
  Mail,
  AlertCircle
} from 'lucide-react';
import { LoaderFive } from '../ui/loader';
import { GlowingEffect } from '../ui/glowing-effect';
import { SparklesCore } from '../ui/sparkles';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';

interface FolderEditorPageProps {
  onNext: (data: any) => void;
  onBack: () => void;
  mockMode?: boolean;
  initialFolders?: EditorFolder[];
}

interface EditorFolder {
  id: string;
  name: string;
  icon: string;
  description: string;
  instruction: string;
  color: string;
  examples: EmailExample[];
  hardRules: HardRule[];
  isSystemFolder: boolean;
  confidence?: number;
}

interface EmailExample {
  from: string;
  subject: string;
  snippet: string;
  date?: string;
}

interface HardRule {
  id: string;
  condition: 'sender' | 'domain' | 'subject' | 'contains' | 'attachment';
  value: string;
  action: 'move_to_folder';
  targetFolderId: string;
}

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

const mockFolders: EditorFolder[] = [
  {
    id: 'newsletters',
    name: 'Newsletters',
    icon: '📧',
    description: 'Marketing emails and newsletters',
    instruction: 'Put all newsletters and marketing blasts here. Look for unsubscribe links, promotional language, and mass-marketing patterns.',
    color: '#3B82F6',
    isSystemFolder: true,
    confidence: 92,
    examples: [
      { from: 'news@forbes.com', subject: 'Forbes Daily: Tech Trends', snippet: 'Good morning, here are today\'s top tech stories...' },
      { from: 'sales@ikea.com', subject: '10% OFF Everything!', snippet: 'Don\'t miss our biggest sale of the year...' },
      { from: 'updates@substack.com', subject: 'New post from Tech Weekly', snippet: 'Your favorite newsletter has a new post...' }
    ],
    hardRules: []
  },
  {
    id: 'financials',
    name: 'Financials',
    icon: '💰',
    description: 'Receipts, invoices, and financial documents',
    instruction: 'All financial documents including receipts, invoices, bank statements, and payment confirmations.',
    color: '#F59E0B',
    isSystemFolder: true,
    confidence: 88,
    examples: [
      { from: 'receipts@stripe.com', subject: 'Payment Receipt - $49.99', snippet: 'Thank you for your payment. Receipt attached...' },
      { from: 'statements@chase.com', subject: 'Your Monthly Statement', snippet: 'Your credit card statement is now available...' },
      { from: 'billing@aws.amazon.com', subject: 'AWS Billing Statement', snippet: 'Your AWS bill for March is ready...' }
    ],
    hardRules: [
      { id: 'rule-1', condition: 'domain', value: '@stripe.com', action: 'move_to_folder', targetFolderId: 'financials' }
    ]
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: '✈️',
    description: 'Travel bookings and itineraries',
    instruction: 'Travel confirmations, flight bookings, hotel reservations, and trip itineraries.',
    color: '#8B5CF6',
    isSystemFolder: true,
    confidence: 85,
    examples: [
      { from: 'confirmations@united.com', subject: 'Flight Confirmation - SFO to NYC', snippet: 'Your flight is confirmed for March 15th...' },
      { from: 'reservations@airbnb.com', subject: 'Your Reservation is Confirmed', snippet: 'Get ready for your stay in Brooklyn...' }
    ],
    hardRules: []
  },
  {
    id: 'notifications',
    name: 'Notifications',
    icon: '🔔',
    description: 'Automated alerts and system notifications',
    instruction: 'Automated notifications from apps, services, and platforms like GitHub, Slack, etc.',
    color: '#10B981',
    isSystemFolder: true,
    confidence: 90,
    examples: [
      { from: 'notifications@github.com', subject: 'Pull Request Review Required', snippet: 'A new pull request needs your review...' },
      { from: 'alerts@figma.com', subject: 'Comment on Design File', snippet: 'Someone commented on your design...' }
    ],
    hardRules: []
  },
  {
    id: 'action-needed',
    name: 'Action Needed',
    icon: '📝',
    description: 'Emails requiring your response or action',
    instruction: 'Emails that clearly need your reply, decision, or action. Usually from real people asking questions or requesting something.',
    color: '#EF4444',
    isSystemFolder: true,
    confidence: 78,
    examples: [
      { from: 'ceo@acme.com', subject: 'Quick question about the proposal', snippet: 'Hey, can you clarify the timeline in section 3?' },
      { from: 'sarah@client.com', subject: 'Meeting reschedule needed', snippet: 'Can we move our Thursday meeting to Friday?' }
    ],
    hardRules: []
  },
  {
    id: 'review',
    name: 'Review',
    icon: '👀',
    description: 'Emails that need manual review',
    instruction: 'Catch-all for emails that don\'t clearly fit into other categories or when I\'m unsure.',
    color: '#6B7280',
    isSystemFolder: true,
    confidence: 100,
    examples: [],
    hardRules: []
  }
];

export const FolderEditorPage: React.FC<FolderEditorPageProps> = ({ 
  onNext, 
  onBack,
  mockMode = false,
  initialFolders = mockFolders
}) => {
  const [folders, setFolders] = useState<EditorFolder[]>(mockMode ? initialFolders : []);
  const [loading, setLoading] = useState(!mockMode);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingExamplesFor, setViewingExamplesFor] = useState<EditorFolder | null>(null);

  useEffect(() => {
    if (mockMode) {
      setFolders(initialFolders);
      setLoading(false);
      return;
    }
    
    fetchFolders();
  }, [mockMode, initialFolders]);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use the same endpoint as FolderPreviewPage to get consistent data
      const response = await fetch('/api/onboarding/email-categorization');
      const data = await response.json();
      
      if (data.success && data.result) {
        // Transform API data to match the editor format, using the same structure as preview page
        const { folderSuggestions, categorizedEmails } = data.result;
        
        // Group categorized emails by folder to create examples
        const emailsByFolder = categorizedEmails.reduce((acc: any, email: any) => {
          if (email.suggestedFolder) {
            if (!acc[email.suggestedFolder]) {
              acc[email.suggestedFolder] = [];
            }
            
            // Create multiple examples per sender if they have multiple subjects/snippets
            const maxExamples = Math.min(email.frequency, email.sampleSubjects.length, 3); // Limit to 3 examples per sender
            for (let i = 0; i < maxExamples; i++) {
              acc[email.suggestedFolder].push({
                from: email.senderName || email.emailAddress,
                subject: email.sampleSubjects[i] || 'No subject',
                snippet: (email.sampleSnippets[i] || 'No preview available').substring(0, 120) + '...',
                date: new Date().toISOString() // Placeholder date
              });
            }
          }
          return acc;
        }, {});
        
        const editorFolders = folderSuggestions.map((folder: any) => ({
          id: folder.name.toLowerCase().replace(/\s+/g, '-'),
          name: folder.name,
          icon: getIconForFolder(folder.name),
          description: folder.description,
          instruction: folder.description || `Emails related to ${folder.name}`,
          color: folder.color,
          examples: (emailsByFolder[folder.name] || []).slice(0, 12), // Limit examples to 12 per folder
          hardRules: [], // Hard rules would come from a different source
          isSystemFolder: true, // These are system-generated folders
          confidence: Math.round(85 + Math.random() * 10) // Random confidence between 85-95
        }));
        
        setFolders(editorFolders);
      } else {
        throw new Error(data.error || 'Failed to fetch folder data');
      }
      
    } catch (error) {
      console.error('Error fetching folders:', error);
      setError(error instanceof Error ? error.message : 'Failed to load folders');
      // Fallback to mock data
      setFolders(mockFolders);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    onNext({ folders });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LoaderFive text="Loading Folder Editor..." />
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
          <h2 className="text-xl font-semibold text-white mb-2">Editor Failed to Load</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          <div className="flex space-x-3">
            <button
              onClick={fetchFolders}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <span>Try Again</span>
            </button>
            <button
              onClick={() => onNext({ folders: mockFolders })}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
            >
              Continue with Defaults
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-6 relative overflow-hidden">
      {/* Sparkles Background */}
      <div className="fixed inset-0 w-screen h-screen">
        <SparklesCore
          id="foldereditorsparkles"
          background="transparent" 
          minSize={0.6}
          maxSize={1.4}
          particleDensity={40}
          className="w-full h-full"
          particleColor="#3b82f6"
          speed={0.5}
        />
      </div>
      
      {/* Content */}
      <div className="max-w-6xl mx-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-10">
            <div className="relative">
              <div className="absolute -inset-3 bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-600 rounded-full blur-lg opacity-50"></div>
              <div className="relative w-24 h-24 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-full flex items-center justify-center shadow-2xl border-2 border-blue-300/30">
                <Edit3 className="w-14 h-14 text-white drop-shadow-lg" />
              </div>
            </div>
          </div>
          <h1 className="text-6xl font-black text-white mb-8 tracking-tight">
            <span className="bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent drop-shadow-2xl">
              Customize Your Folders
            </span>
          </h1>
          <div className="w-64 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent mx-auto mb-10 rounded-full"></div>
          <p className="text-gray-100 text-xl max-w-4xl mx-auto leading-relaxed font-semibold">
            <span className="text-2xl font-bold text-white">Perfect!</span> Fine-tune how emails are sorted into each folder.<br />
            <span className="text-gray-200 font-medium">Edit instructions, add hard rules, and see examples that match each folder.</span>
          </p>
        </div>

        {/* Folder Cards */}
        <div className="space-y-4 mb-8 max-w-5xl mx-auto">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              expanded={expandedFolder === folder.id}
              onToggleExpand={() => setExpandedFolder(expandedFolder === folder.id ? null : folder.id)}
              onUpdate={(updatedFolder) => {
                setFolders(prev => prev.map(f => f.id === folder.id ? updatedFolder : f));
              }}
              onDelete={(folderId) => {
                setFolders(prev => prev.filter(f => f.id !== folderId));
              }}
              onShowExamples={() => setViewingExamplesFor(folder)}
            />
          ))}
        </div>

        {/* Add Folder */}
        <div className="mb-12">
          <div className="relative group">
            {/* Subtle glow for add button */}
            <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/5 via-blue-400/8 to-blue-500/5 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
            
            <button
              onClick={() => setShowAddFolder(true)}
              className="relative w-full py-6 border-2 border-dashed border-gray-700 hover:border-gray-600 rounded-xl flex items-center justify-center space-x-3 text-gray-400 hover:text-gray-200 transition-all duration-300 backdrop-blur-sm hover:bg-gray-800/30 hover:border-blue-500/30"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-800/50 border border-gray-600 flex items-center justify-center group-hover:bg-gray-700/60 group-hover:border-gray-500 transition-all duration-300">
                <Plus className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
              </div>
              <span className="font-bold text-lg text-gray-100">Add Custom Folder</span>
            </button>
          </div>
        </div>

        {/* Add Folder Modal */}
        {showAddFolder && (
          <AddFolderModal
            onClose={() => setShowAddFolder(false)}
            onAdd={(newFolder) => {
              setFolders(prev => [...prev, newFolder]);
              setShowAddFolder(false);
            }}
          />
        )}

        {/* Navigation */}
        <div className="flex justify-between items-center">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-gray-700/20 via-gray-600/30 to-gray-700/20 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
            <button
              onClick={onBack}
              className="relative px-8 py-4 bg-gray-800/60 hover:bg-gray-700/80 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-xl transition-all duration-300 flex items-center space-x-3 backdrop-blur-sm shadow-lg hover:shadow-xl"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-semibold">Back</span>
            </button>
          </div>

          <div className="text-center">
            <p className="text-gray-100 text-lg font-semibold mb-2">Next: Set up VIPs & rules</p>
            <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-gray-500 to-transparent mx-auto"></div>
          </div>

          <div className="relative group flex justify-center">
            <HoverBorderGradient
              containerClassName="rounded-full"
              as="button"
              className="bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 hover:from-blue-600 hover:via-blue-700 hover:to-blue-800 text-white flex items-center space-x-3 px-10 py-4 text-lg font-bold transition-all duration-300 hover:scale-105 shadow-2xl border border-blue-400/20 backdrop-blur-sm cursor-pointer"
              onClick={handleNext}
            >
              <span>Continue</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </HoverBorderGradient>
          </div>
        </div>
        
        {/* Sample Emails Modal */}
        {viewingExamplesFor && (
          <SampleEmailsModal
            folder={viewingExamplesFor}
            onClose={() => setViewingExamplesFor(null)}
          />
        )}
      </div>
    </div>
  );
};

// Folder Card Component
interface FolderCardProps {
  folder: EditorFolder;
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (folder: EditorFolder) => void;
  onDelete: (folderId: string) => void;
  onShowExamples: (folder: EditorFolder) => void;
}

const FolderCard: React.FC<FolderCardProps> = ({ 
  folder, 
  expanded, 
  onToggleExpand, 
  onUpdate, 
  onDelete,
  onShowExamples
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [editInstruction, setEditInstruction] = useState(folder.instruction);
  const [exampleOffset, setExampleOffset] = useState(0);
  const [showAddRule, setShowAddRule] = useState(false);

  // Reset edit state when expanding/collapsing
  useEffect(() => {
    if (!expanded && isEditing) {
      setIsEditing(false);
      setEditName(folder.name);
      setEditInstruction(folder.instruction);
    }
  }, [expanded, isEditing, folder.name, folder.instruction]);

  const handleAddRule = (newRule: HardRule) => {
    const updatedFolder = {
      ...folder,
      hardRules: [...folder.hardRules, newRule]
    };
    onUpdate(updatedFolder);
    setShowAddRule(false);
  };

  const handleRemoveRule = (ruleId: string) => {
    const updatedFolder = {
      ...folder,
      hardRules: folder.hardRules.filter(rule => rule.id !== ruleId)
    };
    onUpdate(updatedFolder);
  };

  const handleSave = () => {
    onUpdate({
      ...folder,
      name: editName.trim(),
      instruction: editInstruction.trim()
    });
    setIsEditing(false);
  };

  const getVisibleExamples = () => {
    const examples = folder.examples || [];
    return examples.slice(exampleOffset, exampleOffset + 3);
  };

  const canShowMore = () => {
    return folder.examples && folder.examples.length > exampleOffset + 3;
  };

  // Get most frequent emails for this folder
  const getFrequentEmails = () => {
    const examples = folder.examples || [];
    // Group by sender and count frequency
    const emailCounts = examples.reduce((acc: any, example) => {
      acc[example.from] = (acc[example.from] || 0) + 1;
      return acc;
    }, {});
    
    // Sort by frequency and get top 5
    return Object.entries(emailCounts)
      .sort(([,a]: any, [,b]: any) => b - a)
      .slice(0, 5)
      .map(([email, count]: any) => ({ email, count }));
  };

  const frequentEmails = getFrequentEmails();

  return (
    <div className="relative group">
      {/* Enhanced blue glow behind card */}
      <div className="absolute -inset-3 bg-gradient-to-r from-blue-500/8 via-blue-400/12 to-blue-500/8 rounded-3xl blur-2xl transition-all duration-700 group-hover:from-blue-400/15 group-hover:via-blue-300/20 group-hover:to-blue-400/15 group-hover:blur-3xl"></div>
      <div className="absolute -inset-1 bg-blue-500/3 rounded-3xl blur-lg transition-all duration-500 group-hover:bg-blue-400/8"></div>
      
      <div className="relative rounded-3xl border border-gray-800/50 p-3 bg-black/80 backdrop-blur-md shadow-2xl transition-all duration-500 group-hover:border-gray-700/60 group-hover:shadow-3xl min-h-[120px]">
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
        <div className="relative bg-black/70 border-2 border-gray-800/70 rounded-2xl p-6 backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:bg-black/80 group-hover:border-gray-700/80">
          
          {/* Collapsed State - Made clickable */}
          {!expanded && (
            <div 
              className="flex items-center justify-between cursor-pointer hover:bg-gray-800/20 rounded-xl p-2 transition-all duration-200"
              onClick={onToggleExpand}
            >
              <div className="flex items-center space-x-4 flex-1">
                <div className="text-2xl">{folder.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: folder.color }}
                    />
                    <h3 className="text-lg font-bold text-white">{folder.name}</h3>
                    {folder.examples && folder.examples.length > 0 && (
                      <span className="text-xs text-gray-200 bg-gray-800 px-2 py-1 rounded font-medium">
                        {folder.examples.length} examples
                      </span>
                    )}
                    {folder.hardRules && folder.hardRules.length > 0 && (
                      <span className="text-xs text-blue-300 bg-blue-900/30 px-2 py-1 rounded font-medium">
                        {folder.hardRules.length} rules
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-200 line-clamp-1 font-medium">
                    {folder.instruction}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowExamples(folder);
                  }}
                  className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm font-medium hover:bg-gray-700 hover:border-gray-600 transition-all duration-200 cursor-pointer"
                >
                  See examples
                </button>
                <div className="p-2 hover:bg-gray-800 rounded-lg transition-colors group-hover:scale-105 duration-200">
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            </div>
          )}

          {/* Expanded State - Smooth animation */}
          <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'opacity-100' : 'opacity-0'}`}>
            <div 
              className={`transform transition-all duration-300 ease-out ${
                expanded 
                  ? 'translate-y-0 scale-100' 
                  : '-translate-y-4 scale-95'
              }`}
              style={{
                transitionDelay: expanded ? '50ms' : '0ms'
              }}
            >
              {expanded && (
                <div className="pt-4 space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="text-2xl">{folder.icon}</div>
                      <div>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="text-lg font-semibold text-white bg-gray-800 border border-gray-600 rounded-lg px-3 py-1 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all cursor-text"
                          />
                        ) : (
                          <h3 className="text-lg font-bold text-white">{folder.name}</h3>
                        )}
                        <p className="text-sm text-gray-200 font-medium">{folder.description}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={handleSave}
                            className="px-3 py-1.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg text-sm hover:from-green-600 hover:to-green-700 transition-all flex items-center space-x-1 cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>Save</span>
                          </button>
                          <button
                            onClick={() => {
                              setIsEditing(false);
                              setEditName(folder.name);
                              setEditInstruction(folder.instruction);
                            }}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setIsEditing(true);
                              setEditName(folder.name);
                              setEditInstruction(folder.instruction);
                            }}
                            className="px-3 py-1.5 bg-blue-900/30 border border-blue-700 rounded-lg text-blue-400 text-sm hover:bg-blue-900/50 transition-colors cursor-pointer"
                          >
                            Edit
                          </button>
                          {!folder.isSystemFolder && (
                            <button
                              onClick={() => onDelete(folder.id)}
                              className="px-3 py-1.5 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm hover:bg-red-900/50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={onToggleExpand}
                            className="p-2 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer"
                          >
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Frequent Emails Section */}
                  {frequentEmails.length > 0 && (
                    <div className="p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-800/30 rounded-xl hover:from-blue-900/30 hover:to-purple-900/30 transition-all duration-300">
                      <h4 className="text-sm font-semibold text-blue-200 mb-3 flex items-center">
                        <Mail className="w-4 h-4 mr-2" />
                        Most frequent senders in this folder:
                      </h4>
                      <div className="space-y-2">
                        {frequentEmails.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-gray-950/40 rounded-lg border border-gray-700/50 hover:bg-gray-700/50 hover:border-gray-600/50 transition-all duration-200">
                            <span className="text-sm text-gray-100 truncate font-medium">{item.email}</span>
                            <span className="text-xs text-blue-300 bg-blue-900/30 px-2 py-1 rounded font-medium">
                              {item.count} emails
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Instruction Editing */}
                  {isEditing && (
                    <div className="p-4 bg-gray-950/40 border border-gray-700/50 rounded-xl">
                      <label className="block text-sm font-semibold text-gray-100 mb-2 cursor-text">
                        Instruction (describe what emails should go here):
                      </label>
                      <textarea
                        value={editInstruction}
                        onChange={(e) => setEditInstruction(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded-xl p-4 text-white placeholder-gray-300 resize-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all cursor-text"
                        rows={4}
                        placeholder="Describe what types of emails should go in this folder..."
                      />
                      <p className="text-xs text-gray-200 mt-2 font-medium">
                        This instruction will be used directly by the AI to sort emails into this folder.
                      </p>
                    </div>
                  )}

                  {/* Current Instruction */}
                  {!isEditing && (
                    <div className="p-4 bg-gray-950/30 border border-gray-700 rounded-xl">
                      <h4 className="text-sm font-semibold text-gray-100 mb-2">Current instruction:</h4>
                      <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-line font-medium">
                        {folder.instruction}
                      </p>
                    </div>
                  )}

                  {/* Sample Emails */}
                  {folder.examples && folder.examples.length > 0 && (
                    <div className="p-4 bg-gray-950/20 border border-gray-700/50 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-gray-100">Sample emails that match:</h4>
                        <button
                          onClick={() => onShowExamples(folder)}
                          className="text-xs text-blue-300 hover:text-blue-200 transition-colors cursor-pointer font-medium"
                        >
                          View all {folder.examples.length}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {getVisibleExamples().map((example, idx) => (
                          <div key={idx} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50 hover:bg-gray-700/50 transition-colors">
                            <div className="text-xs text-blue-300 mb-1 truncate font-medium">{example.from}</div>
                            <div className="text-sm text-white mb-1 line-clamp-1 font-medium">{example.subject}</div>
                            <div className="text-xs text-gray-200 line-clamp-2 font-medium">{example.snippet}</div>
                          </div>
                        ))}
                      </div>
                      {canShowMore() && (
                        <button
                          onClick={() => setExampleOffset(prev => prev + 3)}
                          className="mt-3 text-xs text-blue-300 hover:text-blue-200 transition-colors cursor-pointer font-medium"
                        >
                          Show 3 more
                        </button>
                      )}
                      {exampleOffset > 0 && (
                        <button
                          onClick={() => setExampleOffset(0)}
                          className="mt-3 ml-4 text-xs text-gray-200 hover:text-gray-100 transition-colors cursor-pointer font-medium"
                        >
                          Reset to first 3
                        </button>
                      )}
                    </div>
                  )}

                  {/* Hard Rules */}
                  <div className="p-4 bg-gray-950/20 border border-gray-700/50 rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-100">Hard rules for this folder:</h4>
                      <button 
                        onClick={() => setShowAddRule(true)}
                        className="px-3 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-100 hover:bg-gray-700 transition-colors cursor-pointer font-medium"
                      >
                        + Add rule
                      </button>
                    </div>
                    {folder.hardRules && folder.hardRules.length > 0 ? (
                      <div className="space-y-2">
                        {folder.hardRules.map((rule) => (
                          <div key={rule.id} className="flex items-center justify-between p-3 bg-gray-900/30 border border-gray-700 rounded-lg">
                            <span className="text-sm text-gray-100 font-medium">
                              IF {rule.condition} contains "{rule.value}" → Move to {folder.name}
                            </span>
                            <button 
                              onClick={() => handleRemoveRule(rule.id)}
                              className="text-red-300 hover:text-red-200 transition-colors cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-300 italic font-medium">No hard rules set for this folder</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Add Rule Modal */}
          {showAddRule && (
            <AddRuleModal
              folderName={folder.name}
              onClose={() => setShowAddRule(false)}
              onAdd={handleAddRule}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// Sample Emails Modal Component
interface SampleEmailsModalProps {
  folder: EditorFolder;
  onClose: () => void;
}

const SampleEmailsModal: React.FC<SampleEmailsModalProps> = ({ folder, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-6">
      <div className="relative group">
        {/* Enhanced blue glow behind modal - matching folder pills */}
        <div className="absolute -inset-3 bg-gradient-to-r from-blue-500/8 via-blue-400/12 to-blue-500/8 rounded-3xl blur-2xl transition-all duration-700 group-hover:from-blue-400/15 group-hover:via-blue-300/20 group-hover:to-blue-400/15 group-hover:blur-3xl"></div>
        <div className="absolute -inset-1 bg-blue-500/3 rounded-3xl blur-lg transition-all duration-500 group-hover:bg-blue-400/8"></div>
        
        <div className="relative rounded-3xl border border-gray-800/50 p-3 bg-black/80 backdrop-blur-md shadow-2xl transition-all duration-500 group-hover:border-gray-700/60 group-hover:shadow-3xl max-w-3xl w-full max-h-[85vh] flex flex-col">
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
          <div className="relative bg-black/70 border-2 border-gray-800/70 rounded-2xl p-6 backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:bg-black/80 group-hover:border-gray-700/80 flex flex-col h-full min-h-0">
            
            {/* Static Header */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-gray-900/60 border-2 border-gray-700/60 rounded-xl flex items-center justify-center shadow-lg">
                  <span className="text-2xl">{folder.icon}</span>
                </div>
                <h3 className="text-2xl font-bold text-white tracking-tight">{folder.name} Examples</h3>
              </div>
              <button
                onClick={onClose}
                className="p-3 hover:bg-gray-800/50 rounded-xl transition-all duration-300 border border-gray-700/50 hover:border-gray-600/60 cursor-pointer"
              >
                <X className="w-5 h-5 text-gray-400 hover:text-gray-200 transition-colors" />
              </button>
            </div>
            
            <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent mb-6 flex-shrink-0"></div>
            
            {/* Scrollable Email Content */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 min-h-0">
              {folder.examples.map((example, idx) => (
                <div key={idx} className="relative group">
                  {/* Subtle glow for each email */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-cyan-500/15 to-blue-500/10 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                  
                  <div className="relative bg-gray-900/60 border border-gray-700/50 rounded-xl p-5 hover:bg-gray-800/60 hover:border-gray-600/60 transition-all duration-300 backdrop-blur-sm">
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="w-8 h-8 bg-blue-900/40 border border-blue-700/50 rounded-lg flex items-center justify-center">
                        <Mail className="w-4 h-4 text-blue-400" />
                      </div>
                      <span className="text-sm font-semibold text-blue-400">{example.from}</span>
                    </div>
                    <h4 className="text-base font-bold text-white mb-3 leading-tight">{example.subject}</h4>
                    <p className="text-sm text-gray-300 leading-relaxed">{example.snippet}</p>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Static Footer */}
            <div className="mt-6 text-center flex-shrink-0">
              <div className="relative group inline-block">
                <div className="absolute -inset-1 bg-gradient-to-r from-gray-600/20 via-gray-500/30 to-gray-600/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
                <button
                  onClick={onClose}
                  className="relative px-8 py-3 bg-gray-900/60 hover:bg-gray-800/80 text-gray-300 hover:text-white rounded-xl transition-all duration-300 border border-gray-700/50 hover:border-gray-600/60 font-semibold backdrop-blur-sm cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Add Rule Modal Component
interface AddRuleModalProps {
  folderName: string;
  onClose: () => void;
  onAdd: (rule: HardRule) => void;
}

const AddRuleModal: React.FC<AddRuleModalProps> = ({ folderName, onClose, onAdd }) => {
  const [condition, setCondition] = useState<'sender' | 'domain' | 'subject' | 'contains' | 'attachment'>('sender');
  const [value, setValue] = useState('');

  const handleAdd = () => {
    if (!value.trim()) return;

    const newRule: HardRule = {
      id: `rule-${Date.now()}`,
      condition,
      value: value.trim(),
      action: 'move_to_folder',
      targetFolderId: '' // This will be set by the parent
    };

    onAdd(newRule);
  };

  const getConditionDescription = (cond: string) => {
    switch (cond) {
      case 'sender': return 'sender email address';
      case 'domain': return 'sender domain (e.g., @company.com)';
      case 'subject': return 'email subject line';
      case 'contains': return 'email body content';
      case 'attachment': return 'attachment type';
      default: return 'field';
    }
  };

  const getPlaceholder = (cond: string) => {
    switch (cond) {
      case 'sender': return 'e.g., noreply@company.com';
      case 'domain': return 'e.g., @stripe.com';
      case 'subject': return 'e.g., URGENT';
      case 'contains': return 'e.g., unsubscribe';
      case 'attachment': return 'e.g., .pdf';
      default: return 'Enter value...';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-6">
      <div className="relative">
        {/* Enhanced glow for add rule modal */}
        <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/10 via-purple-400/15 to-cyan-500/10 rounded-3xl blur-2xl"></div>
        
        <div className="relative bg-gradient-to-br from-gray-900/95 to-gray-950/95 border-2 border-gray-700/60 rounded-3xl p-8 max-w-2xl w-full backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Add Hard Rule</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="p-4 bg-blue-900/20 border border-blue-800 rounded-lg">
            <p className="text-sm text-blue-300">
              <span className="font-medium">IF</span> {getConditionDescription(condition)} contains "{value || '...'}"
              <br />
              <span className="font-medium text-green-400">THEN</span> move to {folderName}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as any)}
              className="w-full bg-gray-800 border border-gray-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
            >
              <option value="sender">Sender email contains</option>
              <option value="domain">Sender domain contains</option>
              <option value="subject">Subject contains</option>
              <option value="contains">Email body contains</option>
              <option value="attachment">Has attachment type</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Value</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-xl p-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
              placeholder={getPlaceholder(condition)}
            />
          </div>

          <div className="text-xs text-gray-400">
            <p><strong>Examples:</strong></p>
            <ul className="mt-1 space-y-1">
              <li>• Domain: "@stripe.com" matches any email from Stripe</li>
              <li>• Subject: "URGENT" matches emails with URGENT in subject</li>
              <li>• Contains: "unsubscribe" matches newsletters</li>
            </ul>
          </div>
        </div>
        
        <div className="flex items-center space-x-3 mt-6">
          <button
            onClick={handleAdd}
            disabled={!value.trim()}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Rule
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
        </div>
      </div>
    </div>
  );
};

// Add Folder Modal Component
interface AddFolderModalProps {
  onClose: () => void;
  onAdd: (folder: EditorFolder) => void;
}

const AddFolderModal: React.FC<AddFolderModalProps> = ({ onClose, onAdd }) => {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState('#6B7280');
  const [description, setDescription] = useState('');

  const colorOptions = [
    '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', 
    '#EF4444', '#06B6D4', '#EC4899', '#84CC16'
  ];

  const iconOptions = [
    '📁', '📧', '💼', '🏠', '💰', '✈️', '🛒', '🎵', 
    '📚', '🎮', '🏥', '🚗', '🍕', '📱', '💻', '⚽'
  ];

  const handleAdd = () => {
    if (!name.trim()) return;

    const newFolder: EditorFolder = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      icon,
      description: description.trim() || `Custom folder for ${name.trim()}`,
      instruction: `Emails related to ${name.trim()}`,
      color,
      examples: [],
      hardRules: [],
      isSystemFolder: false
    };

    onAdd(newFolder);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-6">
      <div className="relative">
        {/* Enhanced glow for add folder modal */}
        <div className="absolute -inset-4 bg-gradient-to-r from-green-500/10 via-emerald-400/15 to-green-500/10 rounded-3xl blur-2xl"></div>
        
        <div className="relative bg-gradient-to-br from-gray-900/95 to-gray-950/95 border-2 border-gray-700/60 rounded-3xl p-8 max-w-2xl w-full backdrop-blur-md shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Add Custom Folder</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Folder Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-xl p-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
              placeholder="e.g., Family, Events, Projects..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Icon</label>
            <div className="grid grid-cols-8 gap-2">
              {iconOptions.map((iconOption) => (
                <button
                  key={iconOption}
                  onClick={() => setIcon(iconOption)}
                  className={`p-2 text-xl border rounded-lg transition-all ${
                    icon === iconOption 
                      ? 'border-blue-500 bg-blue-900/30' 
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  {iconOption}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Color</label>
            <div className="flex space-x-2">
              {colorOptions.map((colorOption) => (
                <button
                  key={colorOption}
                  onClick={() => setColor(colorOption)}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${
                    color === colorOption 
                      ? 'border-white scale-110' 
                      : 'border-gray-600 hover:border-gray-500 hover:scale-105'
                  }`}
                  style={{ backgroundColor: colorOption }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-xl p-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
              placeholder="Brief description of what goes in this folder"
            />
          </div>
        </div>
        
        <div className="flex items-center space-x-3 mt-6">
          <button
            onClick={handleAdd}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Folder
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
        </div>
      </div>
    </div>
  );
};