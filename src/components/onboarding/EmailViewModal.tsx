'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Mail, 
  Clock, 
  Paperclip, 
  ChevronLeft,
  ChevronRight,
  User,
  Calendar,
  Tag,
  ExternalLink,
  Edit3,
  ArrowRight
} from 'lucide-react';
import { GlowingEffect } from '../ui/glowing-effect';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';

interface EmailViewModalProps {
  email: {
    id: string;
    from: string;
    subject: string;
    snippet: string;
    body?: string; // Full email body content
    date: string;
    priority?: 'high' | 'medium' | 'low';
    isRead?: boolean;
    hasAttachment?: boolean;
    gmailCategories?: string[];
    originalData?: any;
  };
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  onEditFolder?: () => void;
  onQuickAdjust?: () => void; // Add callback for quick adjust
}

export const EmailViewModal: React.FC<EmailViewModalProps> = ({
  email,
  onClose,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  onEditFolder,
  onQuickAdjust
}) => {
  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${Math.floor(diffInHours)}h ago`;
    if (diffInHours < 48) return 'Yesterday';
    return date.toLocaleDateString();
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'text-red-400 bg-red-900/20 border-red-700';
      case 'medium': return 'text-yellow-400 bg-yellow-900/20 border-yellow-700';
      case 'low': return 'text-gray-400 bg-gray-900/20 border-gray-600';
      default: return 'text-gray-400 bg-gray-900/20 border-gray-600';
    }
  };

  // Format email content with proper line breaks and spacing
  const formatEmailContent = (content: string) => {
    if (!content) return '';
    
    // Split by line breaks and preserve empty lines for proper spacing
    const lines = content.split(/\r?\n/);
    
    // Format each line as a paragraph or preserve spacing
    return lines.map((line, index) => {
      const trimmedLine = line.trim();
      
      // If line is empty, add spacing
      if (trimmedLine.length === 0) {
        return <div key={index} className="h-2"></div>;
      }
      
      // Check if this looks like a signature line
      const isSignature = /^(best regards|sincerely|thanks|thank you|cheers|regards|yours|yours truly|yours sincerely)/i.test(trimmedLine);
      
      // Check if this looks like a greeting
      const isGreeting = /^(hi|hello|hey|dear|good morning|good afternoon|good evening)/i.test(trimmedLine);
      
      // Check if this looks like a list item
      const isListItem = /^[-*•]\s/.test(trimmedLine);
      
      // Check if this looks like a header/title
      const isHeader = /^[A-Z][A-Z\s]+$/.test(trimmedLine) && trimmedLine.length < 50;
      
      if (isListItem) {
        return (
          <div key={index} className="flex items-start mb-2">
            <span className="text-blue-400 mr-2">•</span>
            <span className="text-white leading-relaxed">{trimmedLine.replace(/^[-*•]\s/, '')}</span>
          </div>
        );
      }
      
      if (isHeader) {
        return (
          <h3 key={index} className="text-lg font-semibold text-blue-300 mb-3 mt-4">
            {trimmedLine}
          </h3>
        );
      }
      
              return (
          <p 
            key={index} 
            className={`mb-3 leading-relaxed ${
              isSignature ? 'text-white mt-4' : 
              isGreeting ? 'text-white font-medium' : 'text-white'
            }`}
          >
            {trimmedLine}
          </p>
        );
    });
  };

  return (
    <div 
      className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[99999] p-4 transition-all duration-200 ease-out"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative group max-w-4xl w-full h-[85vh] transition-all duration-200 ease-out transform">
        {/* Enhanced glow for modal */}
        <div className="absolute -inset-6 bg-gradient-to-r from-blue-500/10 via-purple-400/15 to-cyan-500/10 rounded-3xl blur-3xl"></div>
        
        <div 
          className="relative bg-black border-2 border-gray-800/60 rounded-3xl backdrop-blur-xl shadow-2xl flex flex-col h-full transition-all duration-200 ease-out transform hover:scale-[1.02]"
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
          <div className="flex items-center justify-between p-6 border-b border-gray-800/50">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Mail className="w-5 h-5 text-blue-400" />
                <h3 className="text-xl font-bold text-white">Email Details</h3>
              </div>
              
              {/* Navigation */}
              {(hasPrevious || hasNext) && (
                <div className="flex items-center space-x-2 ml-4">
                  <LiquidButton
                    onClick={onPrevious}
                    disabled={!hasPrevious}
                    size="icon"
                    minWidth="none"
                    hdrHover
                    className={`${LIQUID_BUTTON_BASE_CLASS} size-9 hover:scale-100`}
                    type="button"
                    title="Previous email"
                    aria-label="Previous email"
                  >
                    <ChevronLeft className="w-4 h-4 text-white" />
                  </LiquidButton>
                  <LiquidButton
                    onClick={onNext}
                    disabled={!hasNext}
                    size="icon"
                    minWidth="none"
                    hdrHover
                    className={`${LIQUID_BUTTON_BASE_CLASS} size-9 hover:scale-100`}
                    type="button"
                    title="Next email"
                    aria-label="Next email"
                  >
                    <ChevronRight className="w-4 h-4 text-white" />
                  </LiquidButton>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          {/* Email Header Details */}
          <div className="px-6 py-4 border-b border-gray-800/30">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white mb-2 leading-tight">{email.subject}</h2>
                
                <div className="flex items-center space-x-4 text-sm text-white">
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-blue-400" />
                    <span className="font-medium text-blue-400">{email.from}</span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-4 h-4 text-white" />
                    <span className="text-white">{formatTime(email.date)}</span>
                    <span className="text-gray-300">({formatDate(email.date)})</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-3 ml-4">
                {email.priority && (
                  <span className={`text-xs px-3 py-1 rounded-full border font-medium ${getPriorityColor(email.priority)}`}>
                    {email.priority} priority
                  </span>
                )}
                
                {email.hasAttachment && (
                  <div className="flex items-center space-x-1 text-xs bg-green-900/20 border border-green-700 text-green-400 px-3 py-1 rounded-full">
                    <Paperclip className="w-3 h-3" />
                    <span>Attachment</span>
                  </div>
                )}
                
                {!email.isRead && (
                  <div className="w-3 h-3 bg-blue-400 rounded-full" title="Unread"></div>
                )}
              </div>
            </div>

            {/* Gmail Categories */}
            {email.gmailCategories && email.gmailCategories.length > 0 && (
              <div className="flex items-center space-x-2 mb-4">
                <Tag className="w-4 h-4 text-purple-400" />
                <div className="flex space-x-2">
                  {email.gmailCategories.map((category) => (
                    <span key={category} className="text-xs text-purple-300 bg-purple-900/30 px-2 py-1 rounded border border-purple-800">
                      {category}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Full Headers - Always Visible */}
            <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
              <div className="space-y-2 text-sm font-mono">
                <div><span className="text-gray-400">From:</span> <span className="text-white">{email.from}</span></div>
                <div><span className="text-gray-400">Subject:</span> <span className="text-white">{email.subject}</span></div>
                <div><span className="text-gray-400">Date:</span> <span className="text-white">{formatDate(email.date)}</span></div>
                <div><span className="text-gray-400">Message-ID:</span> <span className="text-white">&lt;{email.id}@example.com&gt;</span></div>
                {email.originalData && (
                  <div><span className="text-gray-400">Thread-ID:</span> <span className="text-white">{email.originalData.threadId || 'N/A'}</span></div>
                )}
              </div>
            </div>

            {/* Edit Folder Button */}
            {onQuickAdjust && (
              <div className="mt-6">
                <div className="relative group flex justify-center">
                  <div className="relative group">
                    <HoverBorderGradient
                      containerClassName="rounded-full"
                      as="button"
                      className="bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 hover:from-blue-600 hover:via-blue-700 hover:to-blue-800 text-white flex items-center space-x-3 px-8 py-4 text-lg font-bold transition-all duration-300 hover:scale-105 shadow-2xl border border-blue-400/20 backdrop-blur-sm cursor-pointer"
                      onClick={onQuickAdjust}
                    >
                      <Edit3 className="w-5 h-5" />
                      <span>Edit Folder Assignment</span>
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </HoverBorderGradient>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Email Body */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              <div 
                className="prose prose-invert max-w-none text-white"
                style={{ 
                  backgroundColor: '#111111',
                  borderRadius: '12px',
                  border: '1px solid rgba(55, 65, 81, 0.5)',
                  padding: '24px',
                  minHeight: '200px',
                  color: 'white'
                }}
              >
                {formatEmailContent(email.body || email.snippet)}
              </div>

              {/* Attachments Section */}
              {email.hasAttachment && (
                <div className="mt-6 p-4 bg-gray-900/50 border border-gray-800 rounded-lg">
                  <div className="flex items-center space-x-2 mb-3">
                    <Paperclip className="w-4 h-4 text-white" />
                    <span className="text-sm font-medium text-white">Attachments</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center p-3 bg-black/50 rounded-lg border border-gray-800/50">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                          <ExternalLink className="w-4 h-4 text-blue-400" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">document.pdf</div>
                          <div className="text-xs text-gray-400">2.4 MB</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};