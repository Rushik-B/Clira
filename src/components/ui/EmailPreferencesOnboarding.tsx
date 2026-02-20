'use client';

import React, { useState } from 'react';
import { 
  Mail, 
  Shield, 
  Users, 
  Plus, 
  X, 
  CheckCircle2, 
  ArrowRight,
  Settings
} from 'lucide-react';

interface EmailPreferencesOnboardingProps {
  onComplete: () => void;
}

interface EmailFilterSettings {
  replyScope: 'ALL_SENDERS' | 'CONTACTS_ONLY';
  blockedSenders: string[];
  allowedSenders: string[];
}

export const EmailPreferencesOnboarding: React.FC<EmailPreferencesOnboardingProps> = ({ onComplete }) => {
  const [settings, setSettings] = useState<EmailFilterSettings>({
    replyScope: 'CONTACTS_ONLY',
    blockedSenders: [],
    allowedSenders: []
  });
  
  const [newBlockedSender, setNewBlockedSender] = useState('');
  const [newAllowedSender, setNewAllowedSender] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      id: 'reply-scope', 
      title: 'Who can Clira reply to?',
      description: 'Choose who you want Clira to generate replies for',
      icon: Users
    },
    {
      id: 'blocked-senders',
      title: 'Block unwanted senders',
      description: 'Add email addresses or domains you never want replies to',
      icon: Shield
    },
    {
      id: 'priority-senders',
      title: 'Priority senders',
      description: 'Add important contacts who should always get replies',
      icon: Mail
    }
  ];

  const addBlockedSender = () => {
    if (newBlockedSender.trim() && !settings.blockedSenders.includes(newBlockedSender.trim())) {
      setSettings(prev => ({
        ...prev,
        blockedSenders: [...prev.blockedSenders, newBlockedSender.trim()]
      }));
      setNewBlockedSender('');
    }
  };

  const removeBlockedSender = (sender: string) => {
    setSettings(prev => ({
      ...prev,
      blockedSenders: prev.blockedSenders.filter(s => s !== sender)
    }));
  };

  const addAllowedSender = () => {
    if (newAllowedSender.trim() && !settings.allowedSenders.includes(newAllowedSender.trim())) {
      setSettings(prev => ({
        ...prev,
        allowedSenders: [...prev.allowedSenders, newAllowedSender.trim()]
      }));
      setNewAllowedSender('');
    }
  };

  const removeAllowedSender = (sender: string) => {
    setSettings(prev => ({
      ...prev,
      allowedSenders: prev.allowedSenders.filter(s => s !== sender)
    }));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    
    try {
      // Save the settings with push notifications enabled by default
      const response = await fetch('/api/settings/email-filters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...settings,
          enablePushNotifications: true // Default to enabled
        }),
      });
      
      if (response.ok) {
        // Remove automatic push notification setup here to prevent race condition
        // Push notifications will be set up after onboarding is complete
        console.log('✅ Email preferences saved successfully');
        
        onComplete();
      } else {
        console.error('Failed to save settings');
        // Still proceed to avoid blocking the user
        onComplete();
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      // Still proceed to avoid blocking the user
      onComplete();
    } finally {
      setSaving(false);
    }
  };

  const renderStepContent = () => {
    const step = steps[currentStep];
    
    switch (step.id) {
      case 'reply-scope':
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div 
                className={`p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                  settings.replyScope === 'CONTACTS_ONLY' 
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                onClick={() => setSettings(prev => ({ ...prev, replyScope: 'CONTACTS_ONLY' }))}
              >
                <div className="flex items-start space-x-4">
                  <div className={`w-5 h-5 rounded-full border-2 mt-1 ${
                    settings.replyScope === 'CONTACTS_ONLY' 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {settings.replyScope === 'CONTACTS_ONLY' && (
                      <div className="w-full h-full rounded-full bg-white scale-50"></div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      People I've contacted before (Recommended)
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Only generate replies for people you've previously emailed
                    </p>
                  </div>
                </div>
              </div>

              <div 
                className={`p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                  settings.replyScope === 'ALL_SENDERS' 
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                onClick={() => setSettings(prev => ({ ...prev, replyScope: 'ALL_SENDERS' }))}
              >
                <div className="flex items-start space-x-4">
                  <div className={`w-5 h-5 rounded-full border-2 mt-1 ${
                    settings.replyScope === 'ALL_SENDERS' 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {settings.replyScope === 'ALL_SENDERS' && (
                      <div className="w-full h-full rounded-full bg-white scale-50"></div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      Anyone who emails me
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Generate replies for all incoming emails
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'blocked-senders':
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex space-x-2">
                <input
                  type="email"
                  value={newBlockedSender}
                  onChange={(e) => setNewBlockedSender(e.target.value)}
                  placeholder="Enter email or domain (e.g., spam@example.com or @marketing.com)"
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  onKeyPress={(e) => e.key === 'Enter' && addBlockedSender()}
                />
                <button
                  onClick={addBlockedSender}
                  className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              {settings.blockedSenders.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900 dark:text-white">Blocked senders:</h4>
                  <div className="space-y-2">
                    {settings.blockedSenders.map((sender, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                        <span className="text-red-800 dark:text-red-200">{sender}</span>
                        <button
                          onClick={() => removeBlockedSender(sender)}
                          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settings.blockedSenders.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No blocked senders yet. You can skip this step.</p>
                </div>
              )}
            </div>
          </div>
        );

      case 'priority-senders':
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex space-x-2">
                <input
                  type="email"
                  value={newAllowedSender}
                  onChange={(e) => setNewAllowedSender(e.target.value)}
                  placeholder="Enter important contact email"
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  onKeyPress={(e) => e.key === 'Enter' && addAllowedSender()}
                />
                <button
                  onClick={addAllowedSender}
                  className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              {settings.allowedSenders.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900 dark:text-white">Priority senders:</h4>
                  <div className="space-y-2">
                    {settings.allowedSenders.map((sender, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                        <span className="text-green-800 dark:text-green-200">{sender}</span>
                        <button
                          onClick={() => removeAllowedSender(sender)}
                          className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settings.allowedSenders.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No priority senders yet. You can skip this step.</p>
                </div>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const currentStepData = steps[currentStep];
  const Icon = currentStepData.icon;

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 z-50 overflow-auto">
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="text-center mb-8 animate-slide-down">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Settings className="w-8 h-8 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full animate-ping"></div>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Set up your email preferences
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Let's customize how Clira handles your emails
            </p>
          </div>

          {/* Progress Bar */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Step {currentStep + 1} of {steps.length}
              </span>
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                {Math.round(((currentStep + 1) / steps.length) * 100)}% Complete
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Step Content */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-8 mb-8">
            <div className="flex items-center space-x-4 mb-6">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                <Icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {currentStepData.title}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {currentStepData.description}
                </p>
              </div>
            </div>

            {renderStepContent()}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleBack}
              disabled={currentStep === 0}
              className={`px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                currentStep === 0
                  ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Back
            </button>

            <div className="flex space-x-2">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={`w-2 h-2 rounded-full transition-all duration-200 ${
                    index <= currentStep
                      ? 'bg-blue-500'
                      : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              disabled={saving}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all duration-200 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Saving...</span>
                </>
              ) : currentStep === steps.length - 1 ? (
                <>
                  <span>Complete Setup</span>
                  <CheckCircle2 className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Next</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-slide-down {
          animation: slide-down 0.6s ease-out;
        }
      `}</style>
    </div>
  );
}; 