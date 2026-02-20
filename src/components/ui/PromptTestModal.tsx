'use client';

import React, { useState } from 'react';
import { 
  X, 
  TestTube, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  CheckCircle, 
  AlertCircle,
  Brain
} from 'lucide-react';

interface PromptTestResult {
  emailId: string;
  from: string;
  subject: string;
  originalDecision: {
    confidence: number;
    reasoning: string;
    routingMethod: string;
  };
  newDecision: {
    confidence: number;
    reasoning: string;
    routingMethod: string;
  };
  confidenceChange: number;
  improved: boolean;
}

interface PromptTestResponse {
  success: boolean;
  results: PromptTestResult[];
  summary: {
    totalTested: number;
    averageOriginalConfidence: number;
    averageNewConfidence: number;
    averageConfidenceChange: number;
    improvedCount: number;
    degradedCount: number;
    unchangedCount: number;
  };
  recommendation: string;
}

interface PromptTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  folderId: string;
  folderName: string;
  currentPrompt: string;
  onPromptUpdate?: (newPrompt: string) => void;
}

export const PromptTestModal: React.FC<PromptTestModalProps> = ({
  isOpen,
  onClose,
  folderId,
  folderName,
  currentPrompt,
  onPromptUpdate
}) => {
  const [newPrompt, setNewPrompt] = useState(currentPrompt);
  const [emailCount, setEmailCount] = useState(10);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<PromptTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const testPrompt = async () => {
    try {
      setTesting(true);
      setError(null);
      setResults(null);

      const response = await fetch(`/api/folders/${folderId}/test-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPrompt,
          emailCount
        })
      });

      const data = await response.json();

      if (data.success) {
        setResults(data);
      } else {
        setError(data.error || 'Failed to test prompt');
      }
    } catch (error) {
      console.error('Error testing prompt:', error);
      setError('Failed to test prompt');
    } finally {
      setTesting(false);
    }
  };

  const applyPrompt = async () => {
    if (onPromptUpdate) {
      onPromptUpdate(newPrompt);
      onClose();
    }
  };

  const getChangeIcon = (change: number) => {
    if (change > 0.01) return <TrendingUp className="w-4 h-4 text-green-400" />;
    if (change < -0.01) return <TrendingDown className="w-4 h-4 text-red-400" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getChangeColor = (change: number) => {
    if (change > 0.01) return 'text-green-400';
    if (change < -0.01) return 'text-red-400';
    return 'text-gray-400';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg border border-gray-800 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <TestTube className="w-6 h-6 text-purple-400" />
              <div>
                <h2 className="text-xl font-semibold text-white">Test AI Prompt</h2>
                <p className="text-gray-400">Test how your prompt performs on recent emails for "{folderName}"</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Prompt Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              AI Prompt to Test
            </label>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="Enter the AI prompt to test..."
              className="w-full px-3 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              rows={4}
              maxLength={2000}
            />
            <div className="flex justify-between items-center mt-2">
              <p className="text-xs text-gray-500">
                {newPrompt.length}/2000 characters
              </p>
              <div className="flex items-center space-x-4">
                <label className="text-sm text-gray-400">
                  Test on:
                  <select
                    value={emailCount}
                    onChange={(e) => setEmailCount(parseInt(e.target.value))}
                    className="ml-2 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white"
                  >
                    <option value={5}>5 emails</option>
                    <option value={10}>10 emails</option>
                    <option value={20}>20 emails</option>
                    <option value={50}>50 emails</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          {/* Test Button */}
          <div className="flex justify-center">
            <button
              onClick={testPrompt}
              disabled={testing || !newPrompt.trim()}
              className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              <Brain className="w-4 h-4" />
              <span>{testing ? 'Testing...' : 'Test Prompt'}</span>
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center space-x-2 p-4 bg-red-900/20 rounded-lg border border-red-800">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <span className="text-red-300">{error}</span>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">Test Results Summary</h3>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">{results.summary.totalTested}</div>
                    <div className="text-sm text-gray-400">Emails Tested</div>
                  </div>
                  
                  <div className="text-center">
                    <div className={`text-2xl font-bold ${getChangeColor(results.summary.averageConfidenceChange)}`}>
                      {results.summary.averageConfidenceChange > 0 ? '+' : ''}{Math.round(results.summary.averageConfidenceChange * 100)}%
                    </div>
                    <div className="text-sm text-gray-400">Avg Change</div>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">{results.summary.improvedCount}</div>
                    <div className="text-sm text-gray-400">Improved</div>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-400">{results.summary.degradedCount}</div>
                    <div className="text-sm text-gray-400">Degraded</div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-300">
                    Original: {Math.round(results.summary.averageOriginalConfidence * 100)}% → 
                    New: {Math.round(results.summary.averageNewConfidence * 100)}%
                  </div>
                  
                  <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-purple-400 hover:text-purple-300 text-sm"
                  >
                    {showDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                </div>
              </div>

              {/* Recommendation */}
              <div className="p-4 bg-blue-900/20 rounded-lg border border-blue-800">
                <div className="flex items-start space-x-2">
                  <CheckCircle className="w-5 h-5 text-blue-400 mt-0.5" />
                  <div>
                    <p className="text-blue-300 font-medium">Recommendation</p>
                    <p className="text-blue-200 text-sm mt-1">{results.recommendation}</p>
                  </div>
                </div>
              </div>

              {/* Detailed Results */}
              {showDetails && results.results.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-lg font-semibold text-white">Detailed Results</h4>
                  {results.results.map((result, index) => (
                    <div key={result.emailId} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white truncate">{result.subject}</p>
                          <p className="text-sm text-gray-400">From: {result.from}</p>
                        </div>
                        <div className="flex items-center space-x-2 ml-4">
                          {getChangeIcon(result.confidenceChange)}
                          <span className={`font-medium ${getChangeColor(result.confidenceChange)}`}>
                            {result.confidenceChange > 0 ? '+' : ''}{Math.round(result.confidenceChange * 100)}%
                          </span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-400">Original Confidence</p>
                          <p className="text-white">{Math.round(result.originalDecision.confidence * 100)}%</p>
                        </div>
                        <div>
                          <p className="text-gray-400">New Confidence</p>
                          <p className="text-white">{Math.round(result.newDecision.confidence * 100)}%</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Apply Button */}
              {results.summary.averageConfidenceChange > 0.01 && onPromptUpdate && (
                <div className="flex justify-center">
                  <button
                    onClick={applyPrompt}
                    className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Apply This Prompt</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};