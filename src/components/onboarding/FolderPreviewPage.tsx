'use client';

import React, { useState, useEffect } from 'react';
import { ArrowRight, FolderOpen, Sparkles, ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react';
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



interface FolderPreviewPageProps {
  onNext: () => void;
  onBack?: () => void;
  mockMode?: boolean;
  suggestedFolders?: PreviewFolder[];
}

interface PreviewFolder {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  exampleCount?: number;
}

const defaultFolders: PreviewFolder[] = [
  {
    id: 'newsletters',
    name: 'Newsletters',
    icon: '📧',
    description: 'all mass-marketing & digests',
    color: '#3B82F6',
    exampleCount: 127
  },
  {
    id: 'financials',
    name: 'Financials',
    icon: '💰',
    description: 'receipts, invoices & bank statements',
    color: '#F59E0B',
    exampleCount: 43
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: '✈️',
    description: 'bookings & itineraries',
    color: '#8B5CF6',
    exampleCount: 18
  },
  {
    id: 'notifications',
    name: 'Notifications',
    icon: '🔔',
    description: 'automated alerts (GitHub, Asana)',
    color: '#10B981',
    exampleCount: 89
  },
  {
    id: 'action-needed',
    name: 'Action Needed',
    icon: '📝',
    description: 'emails that clearly need your reply/decision',
    color: '#EF4444',
    exampleCount: 31
  },
  {
    id: 'review',
    name: 'Review',
    icon: '👀',
    description: 'anything I\'m unsure about',
    color: '#6B7280',
    exampleCount: 12
  }
];

export const FolderPreviewPage: React.FC<FolderPreviewPageProps> = ({ 
  onNext, 
  onBack,
  mockMode = false,
  suggestedFolders = defaultFolders
}) => {
  const [showFolders, setShowFolders] = useState(false);
  const [loading, setLoading] = useState(!mockMode);
  const [folders, setFolders] = useState<PreviewFolder[]>(
    mockMode ? suggestedFolders : []
  );

  useEffect(() => {
    if (mockMode) {
      setFolders(suggestedFolders);
      setLoading(false);
      // Trigger animations without setTimeout
      setShowFolders(true);
      return;
    }
    
    fetchFolderSuggestions();
  }, [mockMode, suggestedFolders]);

  const fetchFolderSuggestions = async () => {
    try {
      setLoading(true);

      const response = await fetch('/api/onboarding/email-categorization');
      const data = await response.json();
      
      if (data.success && data.result) {
        // Transform API folders to preview format
        const previewFolders = data.result.folderSuggestions.map((folder: any) => ({
          id: folder.name.toLowerCase().replace(/\s+/g, '-'),
          name: folder.name,
          icon: getIconForFolder(folder.name), // Use the proper icon mapping
          description: folder.description,
          color: folder.color,
          exampleCount: folder.emailCount
        }));
        
        setFolders(previewFolders);
      } else {
        // Fallback to default folders
        setFolders(defaultFolders);
      }
      
      // Trigger animations without setTimeout
      setShowFolders(true);
      
    } catch (error) {
      console.error('Error fetching folder suggestions:', error);
      // Fallback to default folders
      setFolders(defaultFolders);
      setShowFolders(true);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LoaderFive text="Preparing Your Folder System..." />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-8 relative overflow-hidden">
      {/* Sparkles Background */}
      <div className="fixed inset-0 w-screen h-screen">
        <SparklesCore
          id="folderpreviewsparkles"
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
      <div className="max-w-6xl mx-auto relative z-10">
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
            <span className="text-sm font-bold text-gray-200 tracking-wider">Step 3 of 5</span>
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
              <div className="absolute -inset-3 bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-600 rounded-full blur-lg opacity-50"></div>
              <div className="relative w-24 h-24 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-full flex items-center justify-center shadow-2xl border-2 border-blue-300/30">
                <FolderOpen className="w-14 h-14 text-white drop-shadow-lg" />
              </div>
            </div>
          </div>
          <h1 className="text-7xl font-black text-white mb-8 tracking-tight">
            <span className="bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent drop-shadow-2xl">
              Smart Folder System
            </span>
          </h1>
          <div className="w-64 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent mx-auto mb-10 rounded-full"></div>
          <p className="text-gray-300 text-xl max-w-4xl mx-auto leading-relaxed font-medium">
            <span className="text-2xl font-bold text-white">Perfect!</span> Based on your email patterns, I've designed a smart organization system.<br />
            <span className="text-gray-400">Here's how I'll keep your inbox clean and organized automatically.</span>
          </p>
        </div>

        {/* Folders Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 mb-20">
          {folders.map((folder, index) => {
            // Generate folder-specific styling
            const folderIcon = getIconForFolder(folder.name);
            const colors = generateColorForFolder(folder.name);
            
            return (
              <div
                key={folder.id}
                className={`relative transition-all duration-700 ease-out group ${
                  showFolders
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-8'
                }`}
                style={{ 
                  transitionDelay: `${index * 100}ms`,
                  animationDelay: `${index * 100}ms`
                }}
              >
                {/* Enhanced blue glow behind card */}
                <div className="absolute -inset-3 bg-gradient-to-r from-blue-500/8 via-blue-400/12 to-blue-500/8 rounded-3xl blur-2xl transition-all duration-700 group-hover:from-blue-400/15 group-hover:via-blue-300/20 group-hover:to-blue-400/15 group-hover:blur-3xl"></div>
                <div className="absolute -inset-1 bg-blue-500/3 rounded-3xl blur-lg transition-all duration-500 group-hover:bg-blue-400/8"></div>
                
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
                  <div className="relative flex h-full flex-col gap-6 overflow-hidden rounded-2xl p-8 bg-black/90 border-2 border-gray-900/80 backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:bg-black/95 group-hover:border-gray-800/90">
                    
                    {/* Icon and Header Section */}
                    <div className="flex items-center justify-between">
                      <div className="w-16 h-16 rounded-2xl border-2 border-gray-800/60 bg-black/70 backdrop-blur-sm flex items-center justify-center shadow-lg transition-all duration-500 group-hover:scale-105 group-hover:border-gray-700/70 group-hover:bg-gray-900/80 group-hover:shadow-xl">
                        <span className="text-2xl transition-all duration-300 group-hover:scale-110">{folderIcon}</span>
                      </div>
                      {folder.exampleCount && folder.exampleCount > 0 && (
                        <div className="px-3 py-1 bg-black/70 border border-gray-800/50 rounded-lg transition-all duration-300 group-hover:bg-gray-900/80 group-hover:border-gray-700/60">
                          <span className="text-xs font-bold text-gray-300 group-hover:text-gray-200">
                            {folder.exampleCount} emails
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Title Section */}
                    <div className="space-y-3">
                      <div className="flex items-center space-x-3">
                        <div 
                          className="w-3 h-3 rounded-full shadow-lg border border-gray-600 transition-all duration-300 group-hover:scale-125"
                          style={{ backgroundColor: folder.color }}
                        />
                        <h3 className="text-2xl font-bold text-white tracking-tight leading-tight transition-all duration-300 group-hover:text-gray-100 group-hover:translate-x-1">
                          {folder.name}
                        </h3>
                      </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-3 flex-1">
                      <p className="text-sm font-bold text-gray-300 uppercase tracking-wider transition-all duration-300 group-hover:text-gray-200">Purpose:</p>
                      <p className="text-gray-200 text-sm leading-relaxed font-medium transition-all duration-300 group-hover:text-white group-hover:translate-x-1">
                        {folder.description}
                      </p>
                    </div>

                    {/* Visual Progress Indicator */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider transition-all duration-300 group-hover:text-gray-300">Auto-Sort Ready</span>
                        <CheckCircle className="w-4 h-4 text-green-400 transition-all duration-300 group-hover:scale-110" />
                      </div>
                      <div className="w-full bg-gray-800/60 rounded-full h-2 overflow-hidden border border-gray-700 transition-all duration-300 group-hover:border-gray-600">
                        <div 
                          className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-1000 ease-out shadow-lg"
                          style={{ 
                            width: showFolders ? '100%' : '0%',
                            transitionDelay: `${index * 150 + 800}ms`
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* How It Works Section */}
        <div 
          className={`relative transition-all duration-700 ease-out mb-20 ${
            showFolders
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-4'
            }`}
          style={{ transitionDelay: '800ms' }}
        >
          {/* Enhanced blue glow for info section */}
          <div className="absolute -inset-3 bg-gradient-to-r from-blue-500/6 via-blue-400/10 to-blue-500/6 rounded-3xl blur-2xl group-hover:from-blue-400/12 group-hover:via-blue-300/16 group-hover:to-blue-400/12 transition-all duration-700"></div>
          <div className="absolute -inset-1 bg-blue-500/2 rounded-3xl blur-lg transition-all duration-500"></div>
          
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
            <div className="relative bg-gray-900/80 border-2 border-gray-800/70 rounded-2xl p-10 backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:bg-gray-800/90 group-hover:border-gray-700/80">
              <div className="flex items-center space-x-5 mb-8">
                <div className="w-14 h-14 bg-gray-800/70 border-2 border-gray-700/60 rounded-xl flex items-center justify-center shadow-lg transition-all duration-500 group-hover:bg-gray-700/80 group-hover:border-gray-600/70">
                  <Sparkles className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="text-4xl font-bold text-white tracking-tight">
                  How Your Smart System Works
                </h3> 
              </div>
              
              <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent mb-8"></div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { icon: '🎯', title: 'Auto-Sort Incoming', desc: 'Each new email gets automatically sorted into the right folder' },
                  { icon: '✨', title: 'Clean Inbox', desc: 'Your main inbox stays focused on important messages only' },
                  { icon: '👀', title: 'Smart Review', desc: 'Anything unclear goes to "Review" for you to check' },
                  { icon: '⚙️', title: 'Fully Customizable', desc: 'You can customize these rules on the next screen' }
                ].map((item, idx) => (
                  <div 
                    key={idx}
                    className="relative group/item"
                  >
                    {/* Subtle glow effect for each item */}
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-cyan-500/15 to-blue-500/10 rounded-xl blur-lg opacity-0 group-hover/item:opacity-100 transition-all duration-500"></div>
                    
                    <div className="relative flex items-start space-x-4 p-5 bg-gray-900/60 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/60 transition-all duration-500 backdrop-blur-sm hover:transform hover:translate-y-[-1px] hover:shadow-xl">
                      <div className="text-2xl">{item.icon}</div>
                      <div className="flex-1">
                        <h4 className="text-lg font-bold text-white mb-2 group-hover/item:text-gray-100 transition-colors">
                          {item.title}
                        </h4>
                        <p className="text-gray-300 text-sm leading-relaxed group-hover/item:text-gray-200 transition-colors">
                          {item.desc}
                        </p>
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
            showFolders
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-4'
            }`}
          style={{ transitionDelay: '1000ms' }}
        >
          {/* Enhanced blue glow for footer section */}
          <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/8 via-blue-400/14 to-blue-500/8 rounded-3xl blur-3xl group-hover:from-blue-400/16 group-hover:via-blue-300/22 group-hover:to-blue-400/16 transition-all duration-700"></div>
          <div className="absolute -inset-2 bg-blue-500/4 rounded-3xl blur-xl transition-all duration-500"></div>
          
          <div className="relative rounded-3xl border border-gray-800/50 p-3 bg-gradient-to-br from-gray-900/60 to-gray-950/90 backdrop-blur-md shadow-2xl group hover:border-gray-700/60 hover:shadow-3xl transition-all duration-500">
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
            <div className="relative bg-gradient-to-br from-gray-900/80 to-gray-800/90 border-2 border-gray-800/70 rounded-2xl p-12 text-center backdrop-blur-sm shadow-inner transition-all duration-500 group-hover:from-gray-800/90 group-hover:to-gray-700/90 group-hover:border-gray-700/80">
              <div className="mb-10">
                <div className="flex items-center justify-center mb-6">
                  <CheckCircle className="w-16 h-16 text-green-400 drop-shadow-lg" />
                </div>
                <h3 className="text-4xl font-bold text-white mb-6 tracking-tight">
                  Ready to customize!
                </h3>
                <div className="w-32 h-px bg-gradient-to-r from-transparent via-gray-500 to-transparent mx-auto mb-8"></div>
                <p className="text-gray-300 text-xl max-w-3xl mx-auto leading-relaxed font-medium">
                  These smart folders will keep your inbox organized automatically.<br />
                  <span className="text-blue-400 font-semibold">You can customize them next to fit your workflow perfectly.</span>
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
                  <span>Customize My Folders</span>
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