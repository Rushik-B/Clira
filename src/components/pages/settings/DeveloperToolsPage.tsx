'use client';

import React, { useState } from 'react';
import { Settings, Mail, TestTube, Database, Zap, ArrowRight, Play, Bug, Code2, Terminal, Cpu, Server, Activity, Shield, GitBranch, Package } from 'lucide-react';
import { EmailSimulatorPage } from '../dev/EmailSimulatorPage';
import { PageHeader } from '@/components/ui/PageHeader';

export const DeveloperToolsPage: React.FC = () => {
  const [activeView, setActiveView] = useState<'main' | 'email-simulator'>('main');

  if (activeView === 'email-simulator') {
    return (
      <div className="min-h-screen bg-black">
        <div className="max-w-6xl mx-auto p-6">
          <div className="mb-6">
            <button
              onClick={() => setActiveView('main')}
              className="text-blue-400 hover:text-blue-300 flex items-center text-sm mb-4 transition-colors duration-200"
            >
              ← Back to Developer Tools
            </button>
          </div>
          <EmailSimulatorPage />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="max-w-6xl mx-auto">
        {/* Modern Page Header */}
        <PageHeader
          title="Developer Tools"
          subtitle="Advanced tools for developers, system administrators, and power users."
          icon={Code2}
          iconColor="text-purple-400"
        />

        {/* Tools Grid */}
        <div className="px-4 sm:px-6 lg:px-8 pb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Email Simulator */}
            <div 
              onClick={() => setActiveView('email-simulator')}
              className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02] cursor-pointer"
            >
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Mail className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Email Simulator</h3>
                  <p className="text-gray-400 text-sm">Test email processing</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Simulate incoming emails to test AI classification, filtering, and reply generation. 
                Perfect for testing new features and debugging issues.
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center text-blue-400 group-hover:text-blue-300 transition-colors">
                  <span className="text-sm font-medium">Launch simulator</span>
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </div>
                <div className="text-xs text-gray-500 bg-gray-800/50 px-2 py-1 rounded-full">
                  Active
                </div>
              </div>
            </div>

            {/* API Testing */}
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <TestTube className="h-6 w-6 text-green-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">API Testing</h3>
                  <p className="text-gray-400 text-sm">Test API endpoints</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Test all API endpoints with built-in request builder, response viewer, and 
                authentication testing. Includes rate limiting and error simulation.
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

            {/* Database Inspector */}
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Database className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Database Inspector</h3>
                  <p className="text-gray-400 text-sm">Browse and query data</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Browse database tables, run queries, and inspect data structures. 
                Includes schema visualization and data export capabilities.
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

            {/* Performance Monitor */}
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Activity className="h-6 w-6 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Performance Monitor</h3>
                  <p className="text-gray-400 text-sm">Real-time system metrics</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Monitor system performance, memory usage, CPU load, and response times. 
                Track API performance and identify bottlenecks.
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

            {/* Log Viewer */}
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02] opacity-80">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Terminal className="h-6 w-6 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Log Viewer</h3>
                  <p className="text-gray-400 text-sm">Browse application logs</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Browse and search through application logs with filtering and real-time updates. 
                Debug issues across all services with advanced search capabilities.
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

            {/* Configuration Editor */}
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02] opacity-80">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Settings className="h-6 w-6 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Config Editor</h3>
                  <p className="text-gray-400 text-sm">Edit system configuration</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Edit system configuration, feature flags, and environment variables. 
                Safely modify settings with validation and backup capabilities.
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

            {/* System Health */}
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Cpu className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">System Health</h3>
                  <p className="text-gray-400 text-sm">Monitor system status</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Check system health, service status, and connectivity. 
                Monitor external API health and internal service dependencies.
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

            {/* Deployment Tools */}
            <div className="group bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 shadow-xl hover:shadow-2xl hover:border-gray-700/60 transition-all duration-300 hover:scale-[1.02]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <GitBranch className="h-6 w-6 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white">Deployment Tools</h3>
                  <p className="text-gray-400 text-sm">Manage deployments</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                Manage deployments, rollbacks, and environment configurations. 
                Monitor deployment status and manage feature flags.
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
                  <Terminal className="w-5 h-5 text-blue-400" />
                  <span className="text-white text-sm">View logs</span>
                </button>
                
                <button className="flex items-center space-x-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/50 transition-all duration-200 text-left">
                  <Activity className="w-5 h-5 text-green-400" />
                  <span className="text-white text-sm">System status</span>
                </button>
                
                <button className="flex items-center space-x-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/50 transition-all duration-200 text-left">
                  <Database className="w-5 h-5 text-purple-400" />
                  <span className="text-white text-sm">Database info</span>
                </button>
                
                <button className="flex items-center space-x-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-gray-800/70 hover:border-gray-600/50 transition-all duration-200 text-left">
                  <Package className="w-5 h-5 text-orange-400" />
                  <span className="text-white text-sm">Package info</span>
                </button>
              </div>
            </div>
          </div>

          {/* System Info */}
          <div className="mt-8">
            <div className="bg-gray-900/40 border border-gray-800/40 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">System Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 bg-gray-800/50 border border-gray-700/50 rounded-xl">
                  <div className="flex items-center space-x-2 mb-2">
                    <Server className="w-4 h-4 text-blue-400" />
                    <span className="text-white text-sm font-medium">Environment</span>
                  </div>
                  <p className="text-gray-300 text-sm">Production</p>
                </div>
                
                <div className="p-4 bg-gray-800/50 border border-gray-700/50 rounded-xl">
                  <div className="flex items-center space-x-2 mb-2">
                    <GitBranch className="w-4 h-4 text-green-400" />
                    <span className="text-white text-sm font-medium">Version</span>
                  </div>
                  <p className="text-gray-300 text-sm">v2.1.0</p>
                </div>
                
                <div className="p-4 bg-gray-800/50 border border-gray-700/50 rounded-xl">
                  <div className="flex items-center space-x-2 mb-2">
                    <Shield className="w-4 h-4 text-purple-400" />
                    <span className="text-white text-sm font-medium">Security</span>
                  </div>
                  <p className="text-gray-300 text-sm">HTTPS Enabled</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};