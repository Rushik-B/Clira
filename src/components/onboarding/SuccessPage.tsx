'use client';

import React, { useEffect, useState } from 'react';
import { 
  CheckCircle2, 
  ArrowRight, 
  FolderOpen,
  Clock,
  Settings,
  Sparkles
} from 'lucide-react';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';

interface SuccessPageProps {
  onComplete: () => void;
}

export const SuccessPage: React.FC<SuccessPageProps> = ({ onComplete }) => {
  const [showAnimation, setShowAnimation] = useState(false);

  useEffect(() => {
    // Trigger animation after component mounts without setTimeout
    setShowAnimation(true);
  }, []);

  return (
    <div className="min-h-screen bg-black p-6 flex items-center justify-center">
      <div className="max-w-3xl mx-auto text-center">
        {/* Success Animation */}
        <div className={`mb-8 transition-all duration-1000 ${showAnimation ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}>
          <div className="w-24 h-24 bg-emerald-900/40 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-6 relative">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            <div className="absolute inset-0 border-2 border-emerald-500/20 rounded-full animate-ping"></div>
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">
            All set! 🎉
          </h1>
          <p className="text-xl text-gray-300 mb-2">
            Your inbox organization is now active
          </p>
          <p className="text-sm text-gray-400">
            Clira will start sorting your emails automatically
          </p>
        </div>

        {/* Progress indicator - completed */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-300">Setup Progress</span>
            <span className="text-sm font-medium text-emerald-400">Complete!</span>
          </div>
          <div className="w-full bg-gray-800 border border-gray-700/50 rounded-full h-2">
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 h-2 rounded-full w-full transition-all duration-1000"></div>
          </div>
        </div>

        {/* What Happens Next */}
        <div className="bg-emerald-900/20 border border-emerald-800 rounded-xl p-8 mb-8">
          <h2 className="text-2xl font-semibold text-emerald-400 mb-6">What happens next?</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="bg-gray-900/50 rounded-xl p-6">
              <div className="w-12 h-12 bg-emerald-900/40 border border-emerald-500/30 rounded-xl flex items-center justify-center mb-4">
                <Clock className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Automatic Sorting</h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                Every few hours, Clira will automatically sort your new emails into the right folders based on the rules you set up.
              </p>
            </div>

            <div className="bg-gray-900/50 rounded-xl p-6">
              <div className="w-12 h-12 bg-emerald-900/40 border border-emerald-500/30 rounded-xl flex items-center justify-center mb-4">
                <FolderOpen className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Review Folder</h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                Emails that can't be confidently sorted will go to your "Review" folder for you to check manually.
              </p>
            </div>

            <div className="bg-gray-900/50 rounded-xl p-6">
              <div className="w-12 h-12 bg-emerald-900/40 border border-emerald-500/30 rounded-xl flex items-center justify-center mb-4">
                <Settings className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Always Customizable</h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                You can adjust folder rules, add new folders, or change settings anytime in your dashboard.
              </p>
            </div>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8 text-left">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <Sparkles className="w-5 h-5 text-blue-400 mr-2" />
            Pro Tips
          </h3>
          <ul className="space-y-3 text-gray-300">
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1 text-xs">▸</span>
              <span className="text-sm">Check your "Review" folder occasionally to see if any emails need manual sorting</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1 text-xs">▸</span>
              <span className="text-sm">If emails are going to the wrong folder, you can easily adjust the rules in Settings</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1 text-xs">▸</span>
              <span className="text-sm">Your Gmail labels are now synced - you'll see the folders in Gmail too</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-blue-400 mt-1 text-xs">▸</span>
              <span className="text-sm">Clira learns from your corrections and gets better over time</span>
            </li>
          </ul>
        </div>

        {/* CTA */}
        <HoverBorderGradient
          containerClassName="rounded-full"
          as="button"
          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white flex items-center space-x-3 px-8 py-4 text-lg font-semibold transition-all duration-300 hover:scale-105 shadow-lg border border-emerald-400/20 backdrop-blur-sm mx-auto"
          onClick={onComplete}
        >
          <span>Go to Dashboard</span>
          <ArrowRight className="w-5 h-5" />
        </HoverBorderGradient>

        <p className="text-sm text-gray-400 mt-4">
          Welcome to smarter email management! 🚀
        </p>
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