'use client';

import React, { useState } from 'react';
import { 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  Loader2, 
  FolderOpen,
  Settings,
  Clock
} from 'lucide-react';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';

interface ConfirmationPageProps {
  folders: any[];
  customFolders: any[];
  emailMappings?: any[];
  bulkMappings?: any[];
  onNext: (data: any) => void;
  onBack: () => void;
}

export const ConfirmationPage: React.FC<ConfirmationPageProps> = ({ 
  folders, 
  customFolders, 
  emailMappings = [],
  bulkMappings = [],
  onNext, 
  onBack 
}) => {
  const [finalizing, setFinalizing] = useState(false);

  const allFolders = [...folders, ...customFolders];

  const handleConfirm = async () => {
    try {
      setFinalizing(true);
      
      // Call the finalize API
      const response = await fetch('/api/onboarding/folders/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folders,
          customFolders,
          emailMappings,
          bulkMappings
        })
      });

      const data = await response.json();
      
      if (data.success) {
        onNext({ finalized: true });
      } else {
        console.error('Failed to finalize folders:', data.error);
        // Still proceed to show some progress
        onNext({ finalized: false, error: data.error });
      }
    } catch (error) {
      console.error('Error finalizing folders:', error);
      onNext({ finalized: false, error: 'Network error' });
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-blue-900/40 border border-blue-500/30 rounded-2xl flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-blue-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">
            Here's how your inbox will work
          </h1>
          <p className="text-gray-300 max-w-2xl mx-auto leading-relaxed">
            Review your folder setup before we activate automatic email sorting.
          </p>
        </div>

        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-300">Setup Progress</span>
            <span className="text-sm font-medium text-blue-400">Step 5 of 6</span>
          </div>
          <div className="w-full bg-gray-800 border border-gray-700/50 rounded-full h-2">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full w-5/6"></div>
          </div>
        </div>

        {/* Folder Summary */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-6">Your Email Organization</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {allFolders.map((folder, index) => (
              <div
                key={folder.id || `custom-${index}`}
                className="bg-gray-900 border border-gray-800 rounded-xl p-6"
              >
                <div className="flex items-center space-x-3 mb-3">
                  <div className="text-xl">{folder.icon || '📁'}</div>
                  <div className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: folder.color }}
                    />
                    <h3 className="text-lg font-semibold text-white">{folder.name}</h3>
                  </div>
                </div>
                
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {folder.metaPrompt && folder.metaPrompt.length > 150 
                      ? `${folder.metaPrompt.substring(0, 150)}...`
                      : folder.metaPrompt || `Emails related to ${folder.name}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Email Mappings Summary */}
        {(emailMappings.length > 0 || bulkMappings.length > 0) && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-6">Email Routing Rules</h2>
            <div className="bg-green-900/20 border border-green-800 rounded-xl p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-green-400 font-semibold text-2xl">{emailMappings.length}</div>
                  <div className="text-gray-300 text-sm">Individual Email Rules</div>
                </div>
                <div className="text-center">
                  <div className="text-blue-400 font-semibold text-2xl">{bulkMappings.length}</div>
                  <div className="text-gray-300 text-sm">Domain-wide Rules</div>
                </div>
                <div className="text-center">
                  <div className="text-purple-400 font-semibold text-2xl">
                    {emailMappings.length + bulkMappings.reduce((sum, bulk) => sum + bulk.affectedEmails.length, 0)}
                  </div>
                  <div className="text-gray-300 text-sm">Total Emails Mapped</div>
                </div>
              </div>
              <div className="mt-4 text-center">
                <p className="text-gray-300 text-sm">
                  These rules will automatically route emails to the correct folders, saving you time on manual sorting.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* How It Works */}
        <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-blue-400 mb-4 flex items-center">
            <Settings className="w-5 h-5 mr-2" />
            How Automatic Sorting Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-900/40 border border-blue-500/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Clock className="w-6 h-6 text-blue-400" />
              </div>
              <h4 className="text-white font-medium mb-2">Every Few Hours</h4>
              <p className="text-sm text-gray-300">
                Clira automatically checks for new emails and sorts them into your folders
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-900/40 border border-blue-500/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                <FolderOpen className="w-6 h-6 text-blue-400" />
              </div>
              <h4 className="text-white font-medium mb-2">Smart Routing</h4>
              <p className="text-sm text-gray-300">
                AI reads each email and decides which folder it belongs in based on your rules
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-900/40 border border-blue-500/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6 text-blue-400" />
              </div>
              <h4 className="text-white font-medium mb-2">Review Folder</h4>
              <p className="text-sm text-gray-300">
                Emails that don't clearly fit any rule go to "Review" for you to check
              </p>
            </div>
          </div>
        </div>

        {/* Important Notes */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-4">Good to know:</h3>
          <ul className="space-y-2 text-gray-300">
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1">•</span>
              <span>You can always edit these rules later in Settings</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1">•</span>
              <span>Gmail labels will be created for each folder automatically</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1">•</span>
              <span>Existing emails won't be moved - only new incoming emails are sorted</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1">•</span>
              <span>You can add, rename, or delete folders anytime</span>
            </li>
          </ul>
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center">
          <button
            onClick={onBack}
            disabled={finalizing}
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl transition-colors flex items-center space-x-2 disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Edit</span>
          </button>

          <div className="text-center">
            <p className="text-sm text-gray-400 mb-2">
              {finalizing ? 'Setting up your folders...' : 'Ready to activate sorting'}
            </p>
          </div>

          <HoverBorderGradient
            containerClassName="rounded-full"
            as="button"
            className={`bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white flex items-center space-x-2 px-6 py-3 font-semibold transition-all duration-300 hover:scale-105 shadow-lg border border-emerald-400/20 backdrop-blur-sm ${finalizing ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={finalizing ? undefined : handleConfirm}
          >
            {finalizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Setting Up...</span>
              </>
            ) : (
              <>
                <span>Confirm & Start Sorting</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </HoverBorderGradient>
        </div>
      </div>
    </div>
  );
};