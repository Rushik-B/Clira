import React from 'react';
import { useGmailScopes } from '@/hooks/useGmailScopes';

interface GmailScopeUpgradeProps {
  onUpgrade?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function GmailScopeUpgrade({ 
  onUpgrade, 
  onDismiss, 
  className = "" 
}: GmailScopeUpgradeProps) {
  const { scopes, recommendations, loading, upgradeScopes, needsUpgrade } = useGmailScopes();

  if (loading || !needsUpgrade) {
    return null;
  }

  const handleUpgrade = () => {
    onUpgrade?.();
    upgradeScopes();
  };

  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-blue-800">
            Enhanced Gmail Features Available
          </h3>
          <div className="mt-2 text-sm text-blue-700">
            <p>
              {recommendations?.upgradeReason || 'Grant additional permissions to unlock email organization features.'}
            </p>
          </div>
          <div className="mt-4 flex space-x-3">
            <button
              onClick={handleUpgrade}
              className="bg-blue-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Grant Permissions
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="bg-white text-blue-600 px-3 py-2 rounded-md text-sm font-medium border border-blue-300 hover:bg-blue-50 transition-colors"
              >
                Not Now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GmailScopeUpgradeBanner() {
  const [dismissed, setDismissed] = React.useState(false);
  
  if (dismissed) {
    return null;
  }

  return (
    <GmailScopeUpgrade 
      onDismiss={() => setDismissed(true)}
      className="mb-4"
    />
  );
}

export function GmailScopeUpgradeModal({ 
  isOpen, 
  onClose 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Update Gmail Permissions
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <GmailScopeUpgrade 
          onUpgrade={onClose}
        />
      </div>
    </div>
  );
}