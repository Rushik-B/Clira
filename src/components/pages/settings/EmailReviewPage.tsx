'use client';

import React from 'react';
import { Eye, ChevronRight, BarChart3, CheckCircle, AlertTriangle, Clock, TrendingUp, Zap, Target, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';

export const EmailReviewPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-black">
      <div className="max-w-6xl mx-auto">
        {/* Modern Page Header */}
        <PageHeader
          title="Email Review"
          subtitle="Review and correct AI email classifications to improve future sorting accuracy and train the system."
          icon={Eye}
          iconColor="text-emerald-400"
        />

        {/* Quick Stats */}
        <div className="px-4 sm:px-6 lg:px-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Accuracy Rate</p>
                  <p className="text-2xl font-bold text-white">94.2%</p>
                  <div className="flex items-center space-x-1 text-xs text-green-400">
                    <TrendingUp className="w-3 h-3" />
                    <span>+2.1% this week</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Reviewed</p>
                  <p className="text-2xl font-bold text-white">1,247</p>
                  <div className="flex items-center space-x-1 text-xs text-blue-400">
                    <Clock className="w-3 h-3" />
                    <span>Last 30 days</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-orange-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <AlertTriangle className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Needs Review</p>
                  <p className="text-2xl font-bold text-white">23</p>
                  <div className="flex items-center space-x-1 text-xs text-orange-400">
                    <Target className="w-3 h-3" />
                    <span>High priority</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Zap className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">Learning Rate</p>
                  <p className="text-2xl font-bold text-white">87.5%</p>
                  <div className="flex items-center space-x-1 text-xs text-purple-400">
                    <RefreshCw className="w-3 h-3" />
                    <span>Active learning</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Review Tools */}
        <div className="px-4 sm:px-6 lg:px-8 pb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Link
              href="/settings/email-review"
              className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02] cursor-pointer"
            >
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Eye className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Email Review Tool</h3>
                  <p className="text-gray-400 text-sm">Review & correct classifications</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Review and correct AI email classifications to improve future sorting accuracy. 
                Your feedback helps train the system to better understand your preferences.
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center text-emerald-400 group-hover:text-emerald-300 transition-colors">
                  <span className="text-sm font-medium">Start reviewing</span>
                  <ChevronRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </div>
                <div className="text-xs text-gray-500 bg-gray-800/50 px-2 py-1 rounded-full">
                  Interactive
                </div>
              </div>
            </Link>

            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <BarChart3 className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Classification Analytics</h3>
                  <p className="text-gray-400 text-sm">View performance metrics</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Analyze AI classification performance and identify areas for improvement. 
                Track accuracy trends and see which types of emails need attention.
              </p>
              <div className="flex items-center justify-between">
                <div className="text-gray-500 text-sm">
                  Coming soon...
                </div>
                <div className="text-xs text-gray-500 bg-gray-800/50 px-2 py-1 rounded-full">
                  Beta
                </div>
              </div>
            </div>

            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Target className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Training Dashboard</h3>
                  <p className="text-gray-400 text-sm">Monitor learning progress</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Track how the AI system learns from your corrections and see improvements 
                in real-time. Monitor training data quality and model performance.
              </p>
              <div className="flex items-center justify-between">
                <div className="text-gray-500 text-sm">
                  Coming soon...
                </div>
                <div className="text-xs text-gray-500 bg-gray-800/50 px-2 py-1 rounded-full">
                  Beta
                </div>
              </div>
            </div>

            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <RefreshCw className="h-6 w-6 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Bulk Review</h3>
                  <p className="text-gray-400 text-sm">Process multiple emails at once</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Review and correct multiple email classifications in batch mode for 
                faster training. Perfect for catching up on large backlogs.
              </p>
              <div className="flex items-center justify-between">
                <div className="text-gray-500 text-sm">
                  Coming soon...
                </div>
                <div className="text-xs text-gray-500 bg-gray-800/50 px-2 py-1 rounded-full">
                  Beta
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-8">
            <div className="bg-gray-900/40 border border-gray-800/40 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <button className="flex items-center space-x-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/50 transition-all duration-200 text-left">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span className="text-white text-sm">Mark all as reviewed</span>
                </button>
                
                <button className="flex items-center space-x-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/50 transition-all duration-200 text-left">
                  <RefreshCw className="w-5 h-5 text-blue-400" />
                  <span className="text-white text-sm">Refresh data</span>
                </button>
                
                <button className="flex items-center space-x-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/50 transition-all duration-200 text-left">
                  <BarChart3 className="w-5 h-5 text-purple-400" />
                  <span className="text-white text-sm">Export report</span>
                </button>
                
                <button className="flex items-center space-x-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/50 transition-all duration-200 text-left">
                  <Target className="w-5 h-5 text-orange-400" />
                  <span className="text-white text-sm">Set priorities</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};