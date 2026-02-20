import { useState, useEffect } from 'react';

interface ScopeCheckResult {
  hasAllRequiredScopes: boolean;
  hasGmailModify: boolean;
  missingScopes: string[];
  currentScopes: string[];
}

interface ScopeRecommendations {
  shouldUpgrade: boolean;
  upgradeReason: string | null;
  reauthUrl: string | null;
}

interface GmailScopesState {
  scopes: ScopeCheckResult | null;
  recommendations: ScopeRecommendations | null;
  loading: boolean;
  error: string | null;
}

export function useGmailScopes() {
  const [state, setState] = useState<GmailScopesState>({
    scopes: null,
    recommendations: null,
    loading: true,
    error: null
  });

  const checkScopes = async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      const response = await fetch('/api/auth/check-scopes');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check scopes');
      }

      setState({
        scopes: data.scopes,
        recommendations: data.recommendations,
        loading: false,
        error: null
      });
    } catch (error) {
      setState({
        scopes: null,
        recommendations: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const upgradeScopes = () => {
    if (state.recommendations?.reauthUrl) {
      window.location.href = state.recommendations.reauthUrl;
    }
  };

  useEffect(() => {
    checkScopes();
  }, []);

  return {
    ...state,
    checkScopes,
    upgradeScopes,
    needsUpgrade: state.recommendations?.shouldUpgrade || false
  };
}